#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const readline = require("node:readline/promises");

const HELP = `Nazare CLI

Usage:
  nazare --help
  nazare --version
  nazare init [directory] [--repo <repo>] [--ref <ref>]
  nazare list [--installed]
  nazare add <component>
  nazare remove <component> [--force] [--dry-run]
  nazare update self [--latest [--dev] | --version <version> | --ref <ref>]
  nazare update theme [--latest [--dev] | --version <version> | --ref <ref>] [--force] [--check] [--skip-conflicts]
  nazare update <component> [--latest [--dev] | --version <version> | --ref <ref>] [--dry-run] [--force]
  nazare theme pull [--yes]

Commands:
  init [directory]    Initialize Nazare relationship in a theme repo
  list                List registry components or installed components
  add <component>     Install a registry component and its dependencies
  remove <component>  Uninstall an installed component and remove its owned files
  update self         Update the Nazare CLI install from its original source, latest release, or explicit ref
  update theme        Safely update installed theme scaffold files
  update <component>  Update an installed registry component
  theme pull          Pull registry theme scaffold into an initialized theme repo

Options:
  -h, --help                 Show this help
  -v, --version              Show CLI version
  --repo <repo>              Registry GitHub repo for init
  --ref <ref>                Registry ref for init or update from explicit ref, tag, branch, or commit SHA
  --installed                Show installed components from nazare.lock.yml
  --latest                   Resolve latest stable (or dev with --dev) registry tag
  --version <version>        Update from tag v<version>
  --dev                      Select latest dev prerelease tag with --latest
  --dry-run                  Print component update or remove plan without changing files
  --yes                      Overwrite theme file conflicts without prompting
  --force                    Overwrite modified theme update files; delete modified component files on remove
  --check                    Print theme update plan without changing files
  --skip-conflicts           Skip modified or conflicting theme files during update
`;

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const TAG_PATTERN =
	/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DEV_TAG_PATTERN =
	/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-dev\.(0|[1-9]\d*)$/;
const GITHUB_REPO_PATTERN =
	/^(?:https:\/\/github\.com\/|git@github\.com:|github\.com\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const DEFAULT_REGISTRY = {
	name: "nazare",
	repo: "github.com/fedorivanenko/nazare",
	ref: "refs/heads/main",
	manifest: "nazare.registry.yml",
};

function getInstallDir() {
	return process.env.NAZARE_INSTALL_DIR || path.resolve(__dirname, "..");
}

function readJson(filePath, label) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		throw new Error(`Cannot read ${label}: ${filePath}`);
	}
}

function readPackageMetadata() {
	const packagePath = path.join(getInstallDir(), "package.json");
	const packageMetadata = readJson(packagePath, "package metadata");

	if (
		typeof packageMetadata.version !== "string" ||
		!SEMVER_PATTERN.test(packageMetadata.version)
	) {
		throw new Error("Missing or invalid package.json version metadata");
	}

	return packageMetadata;
}

function printVersion() {
	try {
		process.stdout.write(`${readPackageMetadata().version}\n`);
		return 0;
	} catch (error) {
		process.stderr.write(`nazare error: ${error.message}\n`);
		return 1;
	}
}

function readInstallMetadata() {
	const metadataPath = path.join(getInstallDir(), "nazare.install.json");
	const metadata = readJson(metadataPath, "install metadata");
	const requiredStrings = [
		"version",
		"installedRef",
		"cliUrl",
		"packageUrl",
		"installScriptUrl",
	];

	for (const key of requiredStrings) {
		if (typeof metadata[key] !== "string" || metadata[key].length === 0) {
			throw new Error(`Invalid install metadata: missing ${key}`);
		}
	}

	if (!SEMVER_PATTERN.test(metadata.version)) {
		throw new Error("Invalid install metadata: version must be SemVer");
	}

	return metadata;
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function fetchUrlBuffer(url) {
	return new Promise((resolve, reject) => {
		const client = url.startsWith("http://") ? http : https;
		const request = client.get(
			url,
			{
				headers: {
					"User-Agent": "nazare-cli",
				},
			},
			(response) => {
				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					if (response.statusCode < 200 || response.statusCode >= 300) {
						reject(
							new Error(
								`Request failed with status ${response.statusCode}: ${url}`,
							),
						);
						return;
					}
					resolve(Buffer.concat(chunks));
				});
			},
		);

		request.on("error", (error) => reject(error));
		request.setTimeout(15000, () => {
			request.destroy(new Error(`Request timed out: ${url}`));
		});
	});
}

function fetchJson(url) {
	return new Promise((resolve, reject) => {
		const request = https.get(
			url,
			{
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "nazare-cli",
				},
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					body += chunk;
				});
				response.on("end", () => {
					if (response.statusCode < 200 || response.statusCode >= 300) {
						reject(
							new Error(
								`GitHub latest release request failed with status ${response.statusCode}`,
							),
						);
						return;
					}

					try {
						resolve(JSON.parse(body));
					} catch {
						reject(
							new Error("GitHub latest release response was not valid JSON"),
						);
					}
				});
			},
		);

		request.on("error", (error) => reject(error));
		request.setTimeout(15000, () => {
			request.destroy(new Error("GitHub latest release request timed out"));
		});
	});
}

async function listGitHubTags(repoSlug = "fedorivanenko/nazare") {
	if (process.env.NAZARE_GITHUB_TAGS_JSON) {
		const parsed = JSON.parse(process.env.NAZARE_GITHUB_TAGS_JSON);
		if (!Array.isArray(parsed))
			throw new Error("Invalid NAZARE_GITHUB_TAGS_JSON");
		return parsed.map((tag) => (typeof tag === "string" ? tag : tag.name));
	}

	const tags = await fetchJson(
		`https://api.github.com/repos/${repoSlug}/tags?per_page=100`,
	);
	if (!Array.isArray(tags)) {
		throw new Error("GitHub tags response was not an array");
	}
	return tags.map((tag) => tag.name);
}

function compareTagVersions(left, right) {
	const leftMatch =
		left.match(DEV_TAG_PATTERN) ?? left.match(STABLE_TAG_PATTERN);
	const rightMatch =
		right.match(DEV_TAG_PATTERN) ?? right.match(STABLE_TAG_PATTERN);
	for (let index = 1; index <= 3; index += 1) {
		const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
		if (difference !== 0) return difference;
	}
	const leftDev = left.match(DEV_TAG_PATTERN);
	const rightDev = right.match(DEV_TAG_PATTERN);
	if (leftDev && rightDev) return Number(leftDev[4]) - Number(rightDev[4]);
	return 0;
}

async function resolveLatestTagRef({ dev = false, repoSlug } = {}) {
	const tags = (await listGitHubTags(repoSlug)).filter((tag) =>
		dev ? DEV_TAG_PATTERN.test(tag) : STABLE_TAG_PATTERN.test(tag),
	);
	if (tags.length === 0) {
		throw new Error(
			dev ? "No dev release tags found" : "No stable release tags found",
		);
	}
	return tags.sort(compareTagVersions).at(-1);
}

async function resolveLatestTagRefHttp(registryRepo, dev = false) {
	const tagsUrl = `${registryRepo.replace(/\/$/, "")}/tags`;
	const buffer = await fetchUrlBuffer(tagsUrl);
	const tags = JSON.parse(buffer.toString("utf8"));
	if (!Array.isArray(tags)) {
		throw new Error("HTTP registry /tags response was not an array");
	}
	const filtered = tags.filter((tag) =>
		dev ? DEV_TAG_PATTERN.test(tag) : STABLE_TAG_PATTERN.test(tag),
	);
	if (filtered.length === 0) {
		throw new Error(
			dev ? "No dev release tags found" : "No stable release tags found",
		);
	}
	return filtered.sort(compareTagVersions).at(-1);
}

function normalizeSourceRef(source) {
	if (typeof source !== "string" || source.length === 0) {
		throw new Error("Missing value for --source");
	}

	if (/^https?:\/\//.test(source)) {
		throw new Error("--source expects a ref selector, not a URL");
	}

	if (source.startsWith("refs/")) {
		return source;
	}

	if (COMMIT_SHA_PATTERN.test(source) || TAG_PATTERN.test(source)) {
		return source;
	}

	return `refs/heads/${source}`;
}

function sourceMetadata(metadata, installedRef, registryRepo) {
	if (!installedRef) {
		return metadata;
	}

	if (registryRepo !== undefined && isHttpRegistryRepo(registryRepo)) {
		const base = registryRepo.replace(/\/$/, "");
		const ref = encodeURIComponent(installedRef);
		return {
			...metadata,
			installedRef,
			installScriptUrl: `${base}/raw/install.sh?ref=${ref}`,
			cliUrl: `${base}/raw/packages/nazare/bin/nazare.js?ref=${ref}`,
			packageUrl: `${base}/raw/packages/nazare/package.json?ref=${ref}`,
		};
	}

	return {
		...metadata,
		installedRef,
		installScriptUrl: `https://raw.githubusercontent.com/fedorivanenko/nazare/${installedRef}/install.sh`,
		cliUrl: `https://raw.githubusercontent.com/fedorivanenko/nazare/${installedRef}/packages/nazare/bin/nazare.js`,
		packageUrl: `https://raw.githubusercontent.com/fedorivanenko/nazare/${installedRef}/packages/nazare/package.json`,
	};
}

async function verifyPackageVersionForTag(metadata) {
	const tagMatch = String(metadata.installedRef).match(TAG_PATTERN);
	if (!tagMatch) return;
	if (isHttpRegistryRepo(new URL(metadata.packageUrl).origin)) return;
	const expectedVersion = metadata.installedRef.replace(/^v/, "");
	let packageMetadata;
	if (process.env.NAZARE_TAG_PACKAGE_VERSIONS_JSON) {
		const versions = JSON.parse(process.env.NAZARE_TAG_PACKAGE_VERSIONS_JSON);
		packageMetadata = { version: versions[metadata.installedRef] };
	} else {
		packageMetadata = JSON.parse(
			(await fetchUrlBuffer(metadata.packageUrl)).toString("utf8"),
		);
	}
	if (packageMetadata.version !== expectedVersion) {
		throw new Error(
			`Tag/package version mismatch: ${metadata.installedRef} expects ${expectedVersion}, package has ${packageMetadata.version}`,
		);
	}
}

function isHttpRegistryRepo(repo) {
	if (typeof repo !== "string") return false;
	try {
		const url = new URL(repo);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.username === "" &&
			url.password === "" &&
			url.search === "" &&
			url.hash === "" &&
			url.pathname.replace(/\/$/, "") === ""
		);
	} catch {
		return false;
	}
}

function isValidRegistryRepo(repo) {
	return (
		typeof repo === "string" &&
		(GITHUB_REPO_PATTERN.test(repo) || isHttpRegistryRepo(repo))
	);
}

function parseInitArgs(args) {
	const options = {
		directory: undefined,
		registry: { ...DEFAULT_REGISTRY },
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (arg === "--repo") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("Missing value for --repo");
			}
			if (!isValidRegistryRepo(value)) {
				throw new Error("Invalid registry repo for --repo");
			}
			options.registry.repo = value;
			index += 1;
			continue;
		}

		if (arg === "--ref") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("Missing value for --ref");
			}
			options.registry.ref = value;
			index += 1;
			continue;
		}

		if (arg.startsWith("--")) {
			throw new Error(`Unknown init option: ${arg}`);
		}

		if (options.directory !== undefined) {
			throw new Error("nazare init accepts only one directory argument");
		}

		if (arg.length === 0) {
			throw new Error("Init directory must not be empty");
		}

		if (arg.includes("/") || arg.includes("\\")) {
			throw new Error("Init directory must not contain path separators");
		}

		options.directory = arg;
	}

	if (!isValidRegistryRepo(options.registry.repo)) {
		throw new Error("Invalid registry repo");
	}

	return options;
}

function renderRegistryYaml(registry) {
	return `schemaVersion: 1

registry:
  name: ${registry.name}
  repo: ${registry.repo}
  ref: ${registry.ref}
  manifest: ${registry.manifest}
`;
}

function renderLockYaml(registry) {
	return `${renderRegistryYaml(registry)}
components: {}
`;
}

function replaceRegistryYaml(source, registry, label) {
	parseRegistryYaml(source, label);
	const nextBlock = renderRegistryYaml(registry).trimEnd();
	const replaced = source.replace(
		/^schemaVersion:\s*1\n\nregistry:\n\s+name:\s*.+\n\s+repo:\s*.+\n\s+ref:\s*.+\n\s+manifest:\s*.+/,
		nextBlock,
	);
	if (replaced === source) {
		throw new Error(`Invalid ${label}: cannot replace registry metadata`);
	}
	return replaced;
}

function parseRegistryYaml(source, label) {
	const registryMatch = source.match(
		/registry:\n\s+name:\s*(.+)\n\s+repo:\s*(.+)\n\s+ref:\s*(.+)\n\s+manifest:\s*(.+)/,
	);

	if (!registryMatch) {
		throw new Error(`Invalid ${label}: missing registry metadata`);
	}

	return {
		name: registryMatch[1].trim(),
		repo: registryMatch[2].trim(),
		ref: registryMatch[3].trim(),
		manifest: registryMatch[4].trim(),
	};
}

function parseComponentListValue(value, label) {
	const trimmed = value.trim();
	if (trimmed === "[]") return [];
	throw new Error(`Invalid ${label}: expected array`);
}

function parseComponentManifest(source) {
	const lines = source.split("\n");
	const componentsLineIndex = lines.findIndex((line) =>
		/^components:\s*/.test(line),
	);

	if (componentsLineIndex === -1) {
		throw new Error("Registry manifest has no components block");
	}

	const componentsLine = lines[componentsLineIndex];
	const inlineValue = componentsLine.replace(/^components:\s*/, "").trim();
	if (inlineValue === "{}") return {};
	if (inlineValue !== "") {
		throw new Error("Invalid components block in registry manifest");
	}

	const components = {};
	let currentId;
	let inDependencies = false;
	let inFiles = false;
	let inChecksum = false;
	let currentFile;

	for (let index = componentsLineIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim() === "") continue;
		if (/^\S/.test(line)) break;

		const componentMatch = line.match(/^ {2}([a-z0-9]+(?:-[a-z0-9]+)*):\s*$/);
		if (componentMatch) {
			currentId = componentMatch[1];
			components[currentId] = {};
			inDependencies = false;
			inFiles = false;
			inChecksum = false;
			currentFile = undefined;
			continue;
		}

		if (!currentId) {
			throw new Error("Invalid components block in registry manifest");
		}

		const component = components[currentId];
		const versionMatch = line.match(/^ {4}version:\s*(.+)$/);
		const typeMatch = line.match(/^ {4}type:\s*(.+)$/);
		const dependenciesInlineMatch = line.match(/^ {4}dependencies:\s*(\S.*)$/);
		const dependenciesBlockMatch = line.match(/^ {4}dependencies:\s*$/);
		const dependencyMatch = line.match(/^ {6}-\s+(.+)$/);
		const filesMatch = line.match(/^ {4}files:\s*$/);
		const fromMatch = line.match(/^ {6}-\s+from:\s*(.+)$/);
		const toMatch = line.match(/^ {8}to:\s*(.+)$/);
		const checksumMatch = line.match(/^ {8}checksum:\s*$/);
		const algorithmMatch = line.match(/^ {10}algorithm:\s*(.+)$/);
		const valueMatch = line.match(/^ {10}value:\s*(.+)$/);

		if (versionMatch) {
			component.version = versionMatch[1].trim();
			continue;
		}
		if (typeMatch) {
			component.type = typeMatch[1].trim();
			continue;
		}
		if (dependenciesInlineMatch) {
			component.dependencies = parseComponentListValue(
				dependenciesInlineMatch[1],
				`components.${currentId}.dependencies`,
			);
			inDependencies = false;
			inFiles = false;
			continue;
		}
		if (dependenciesBlockMatch) {
			component.dependencies = [];
			inDependencies = true;
			inFiles = false;
			continue;
		}
		if (inDependencies && dependencyMatch) {
			component.dependencies.push(dependencyMatch[1].trim());
			continue;
		}
		if (filesMatch) {
			component.files = [];
			inDependencies = false;
			inFiles = true;
			continue;
		}
		if (inFiles && fromMatch) {
			currentFile = { from: fromMatch[1].trim() };
			component.files.push(currentFile);
			inChecksum = false;
			continue;
		}
		if (inFiles && toMatch && currentFile) {
			currentFile.to = toMatch[1].trim();
			continue;
		}
		if (inFiles && checksumMatch && currentFile) {
			currentFile.checksum = {};
			inChecksum = true;
			continue;
		}
		if (inFiles && inChecksum && algorithmMatch && currentFile?.checksum) {
			currentFile.checksum.algorithm = algorithmMatch[1].trim();
			continue;
		}
		if (inFiles && inChecksum && valueMatch && currentFile?.checksum) {
			currentFile.checksum.value = valueMatch[1].trim();
			continue;
		}

		throw new Error(`Invalid components metadata near line ${index + 1}`);
	}

	validateComponentMetadata(components);
	return components;
}

const COMPONENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPONENT_TYPES = new Set(["section", "snippet", "package"]);
const COMPONENT_DESTINATION_ROOTS = [
	"sections/",
	"snippets/",
	"templates/",
	"assets/",
	"styles/",
	"config/",
	"scripts/sections/",
	"scripts/snippets/",
	"scripts/behaviors/",
];

function isValidComponentId(value) {
	return typeof value === "string" && COMPONENT_ID_PATTERN.test(value);
}

function isAllowedComponentDestination(value) {
	return COMPONENT_DESTINATION_ROOTS.some((root) => value.startsWith(root));
}

function validateComponentMetadata(components) {
	if (
		!components ||
		typeof components !== "object" ||
		Array.isArray(components)
	) {
		throw new Error("Invalid components block in registry manifest");
	}

	const seenDestinations = new Set();
	const ids = Object.keys(components);

	for (const id of ids) {
		if (!isValidComponentId(id)) {
			throw new Error(`Invalid component ID: ${id}`);
		}

		const component = components[id];
		if (
			!component ||
			typeof component !== "object" ||
			Array.isArray(component)
		) {
			throw new Error(`Invalid component metadata: ${id}`);
		}
		if (
			typeof component.version !== "string" ||
			!SEMVER_PATTERN.test(component.version)
		) {
			throw new Error(`Invalid component version: ${id}`);
		}
		if (!COMPONENT_TYPES.has(component.type)) {
			throw new Error(`Invalid component type: ${id}`);
		}
		if (component.type === "section" && !id.startsWith("s-")) {
			throw new Error(`Invalid section component ID: ${id}`);
		}
		if (component.type === "snippet" && !id.startsWith("c-")) {
			throw new Error(`Invalid snippet component ID: ${id}`);
		}
		if (!Array.isArray(component.dependencies)) {
			throw new Error(`Invalid component dependencies: ${id}`);
		}
		const seenDependencies = new Set();
		for (const dependency of component.dependencies) {
			if (!isValidComponentId(dependency)) {
				throw new Error(`Invalid component dependency: ${id}`);
			}
			if (dependency === id) {
				throw new Error(`Component cannot depend on itself: ${id}`);
			}
			if (seenDependencies.has(dependency)) {
				throw new Error(`Duplicate component dependency: ${id}`);
			}
			if (!components[dependency]) {
				throw new Error(`Missing component dependency: ${dependency}`);
			}
			seenDependencies.add(dependency);
		}
		if (!Array.isArray(component.files) || component.files.length === 0) {
			throw new Error(`Invalid component files: ${id}`);
		}
		for (const file of component.files) {
			if (!isSafeRelativePath(file.from)) {
				throw new Error(`Unsafe component file source path: ${id}`);
			}
			if (!file.from.startsWith(`components/${id}/`)) {
				throw new Error(
					`Component source path must be under components/${id}/: ${file.from}`,
				);
			}
			if (!isSafeRelativePath(file.to)) {
				throw new Error(`Unsafe component file target path: ${id}`);
			}
			if (!isAllowedComponentDestination(file.to)) {
				throw new Error(`Disallowed component file target path: ${file.to}`);
			}
			if (seenDestinations.has(file.to)) {
				throw new Error(`Duplicate component file target path: ${file.to}`);
			}
			seenDestinations.add(file.to);
			if (
				file.checksum?.algorithm !== "sha256" ||
				typeof file.checksum.value !== "string" ||
				!/^[0-9a-f]{64}$/.test(file.checksum.value)
			) {
				throw new Error(
					`Invalid component file checksum metadata: ${file.from}`,
				);
			}
		}
	}

	const visiting = new Set();
	const visited = new Set();
	function visit(id, trail = []) {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			throw new Error(
				`Circular component dependency: ${[...trail, id].join(" -> ")}`,
			);
		}
		visiting.add(id);
		for (const dependency of components[id].dependencies) {
			visit(dependency, [...trail, id]);
		}
		visiting.delete(id);
		visited.add(id);
	}
	for (const id of ids) visit(id);
}

function parseInstalledComponents(source) {
	const lines = source.split("\n");
	const componentsLineIndex = lines.findIndex((line) =>
		/^components:\s*/.test(line),
	);

	if (componentsLineIndex === -1) {
		throw new Error("Invalid nazare.lock.yml: missing components block");
	}

	const componentsLine = lines[componentsLineIndex];
	const inlineValue = componentsLine.replace(/^components:\s*/, "").trim();
	if (inlineValue === "{}") return {};
	if (inlineValue !== "") {
		throw new Error("Invalid components block in nazare.lock.yml");
	}

	const components = {};
	let currentId;
	let inDependencies = false;
	let inFiles = false;
	let inChecksum = false;
	let currentFile;

	for (let index = componentsLineIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim() === "") continue;
		if (/^\S/.test(line)) break;

		const componentMatch = line.match(/^ {2}([a-z0-9]+(?:-[a-z0-9]+)*):\s*$/);
		if (componentMatch) {
			currentId = componentMatch[1];
			components[currentId] = {};
			inDependencies = false;
			inFiles = false;
			inChecksum = false;
			currentFile = undefined;
			continue;
		}

		if (!currentId) {
			throw new Error("Invalid components block in nazare.lock.yml");
		}

		const component = components[currentId];
		const versionMatch = line.match(/^ {4}version:\s*(.+)$/);
		const typeMatch = line.match(/^ {4}type:\s*(.+)$/);
		const dependenciesInlineMatch = line.match(/^ {4}dependencies:\s*(\S.*)$/);
		const dependenciesBlockMatch = line.match(/^ {4}dependencies:\s*$/);
		const dependencyMatch = line.match(/^ {6}-\s+(.+)$/);
		const timestampMatch = line.match(/^ {4}(installedAt|updatedAt):\s*(.*)$/);
		const filesMatch = line.match(/^ {4}files:\s*(.*)$/);
		const pathMatch = line.match(/^ {6}-\s+path:\s*(.+)$/);
		const sourceMatch = line.match(/^ {8}source:\s*(.+)$/);
		const checksumMatch = line.match(/^ {8}checksum:\s*$/);
		const algorithmMatch = line.match(/^ {10}algorithm:\s*(.+)$/);
		const valueMatch = line.match(/^ {10}value:\s*(.+)$/);

		if (versionMatch) {
			component.version = versionMatch[1].trim();
			continue;
		}
		if (typeMatch) {
			component.type = typeMatch[1].trim();
			continue;
		}
		if (dependenciesInlineMatch) {
			component.dependencies = parseComponentListValue(
				dependenciesInlineMatch[1],
				`components.${currentId}.dependencies`,
			);
			inDependencies = false;
			inFiles = false;
			continue;
		}
		if (dependenciesBlockMatch) {
			component.dependencies = [];
			inDependencies = true;
			inFiles = false;
			continue;
		}
		if (inDependencies && dependencyMatch) {
			component.dependencies.push(dependencyMatch[1].trim());
			continue;
		}
		if (filesMatch) {
			component.files = [];
			inDependencies = false;
			inFiles = filesMatch[1].trim() === "";
			inChecksum = false;
			continue;
		}
		if (inFiles && pathMatch) {
			currentFile = { path: pathMatch[1].trim() };
			component.files.push(currentFile);
			inChecksum = false;
			continue;
		}
		if (inFiles && sourceMatch && currentFile && !inChecksum) {
			currentFile.source = sourceMatch[1].trim();
			continue;
		}
		if (inFiles && checksumMatch && currentFile) {
			currentFile.checksum = {};
			inChecksum = true;
			continue;
		}
		if (inFiles && inChecksum && algorithmMatch && currentFile?.checksum) {
			currentFile.checksum.algorithm = algorithmMatch[1].trim();
			continue;
		}
		if (inFiles && inChecksum && valueMatch && currentFile?.checksum) {
			currentFile.checksum.value = valueMatch[1].trim();
			continue;
		}
		if (timestampMatch) {
			inDependencies = false;
			continue;
		}

		throw new Error(
			`Invalid installed component metadata near line ${index + 1}`,
		);
	}

	validateInstalledComponentMetadata(components);
	return components;
}

function validateInstalledComponentMetadata(components) {
	if (
		!components ||
		typeof components !== "object" ||
		Array.isArray(components)
	) {
		throw new Error("Invalid components block in nazare.lock.yml");
	}

	for (const [id, component] of Object.entries(components)) {
		if (!isValidComponentId(id)) {
			throw new Error(`Invalid installed component ID: ${id}`);
		}
		if (
			!component ||
			typeof component !== "object" ||
			Array.isArray(component)
		) {
			throw new Error(`Invalid installed component metadata: ${id}`);
		}
		if (
			typeof component.version !== "string" ||
			!SEMVER_PATTERN.test(component.version)
		) {
			throw new Error(`Invalid installed component version: ${id}`);
		}
		if (!COMPONENT_TYPES.has(component.type)) {
			throw new Error(`Invalid installed component type: ${id}`);
		}
		if (component.type === "section" && !id.startsWith("s-")) {
			throw new Error(`Invalid installed section component ID: ${id}`);
		}
		if (component.type === "snippet" && !id.startsWith("c-")) {
			throw new Error(`Invalid installed snippet component ID: ${id}`);
		}
		if (!Array.isArray(component.dependencies)) {
			throw new Error(`Invalid installed component dependencies: ${id}`);
		}
		if (component.files !== undefined) {
			if (!Array.isArray(component.files)) {
				throw new Error(`Invalid installed component files: ${id}`);
			}
			for (const file of component.files) {
				if (!isSafeRelativePath(file.path)) {
					throw new Error(`Unsafe installed component file path: ${id}`);
				}
				if (!isSafeRelativePath(file.source)) {
					throw new Error(`Unsafe installed component file source: ${id}`);
				}
				if (!hasValidChecksum(file)) {
					throw new Error(
						`Invalid installed component file checksum metadata: ${id}`,
					);
				}
			}
		}
		const seenDependencies = new Set();
		for (const dependency of component.dependencies) {
			if (!isValidComponentId(dependency)) {
				throw new Error(`Invalid installed component dependency: ${id}`);
			}
			if (dependency === id) {
				throw new Error(`Installed component cannot depend on itself: ${id}`);
			}
			if (seenDependencies.has(dependency)) {
				throw new Error(`Duplicate installed component dependency: ${id}`);
			}
			if (!components[dependency]) {
				throw new Error(
					`Missing installed component dependency: ${dependency}`,
				);
			}
			seenDependencies.add(dependency);
		}
	}

	const visiting = new Set();
	const visited = new Set();
	function visit(id, trail = []) {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			throw new Error(
				`Circular installed component dependency: ${[...trail, id].join(" -> ")}`,
			);
		}
		visiting.add(id);
		for (const dependency of components[id].dependencies) {
			visit(dependency, [...trail, id]);
		}
		visiting.delete(id);
		visited.add(id);
	}
	for (const id of Object.keys(components)) visit(id);
}

function renderTable(headers, rows) {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => row[index].length)),
	);
	return [headers, ...rows]
		.map((row) =>
			row
				.map((cell, index) => cell.padEnd(widths[index]))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

function renderAvailableComponents(components, installedComponents) {
	const ids = Object.keys(components).sort((a, b) => a.localeCompare(b));
	if (ids.length === 0) {
		return "No components available in registry.\n";
	}

	const rows = ids.map((id) => [
		id,
		components[id].type,
		components[id].version,
		installedComponents[id] ? "installed" : "not installed",
	]);

	return `Available components:\n\n${renderTable(["ID", "Type", "Version", "Status"], rows)}\n`;
}

function renderInstalledComponents(components) {
	const ids = Object.keys(components).sort((a, b) => a.localeCompare(b));
	if (ids.length === 0) {
		return "No components installed.\n";
	}

	const rows = ids.map((id) => [
		id,
		components[id].type,
		components[id].version,
	]);

	return `Installed components:\n\n${renderTable(["ID", "Type", "Version"], rows)}\n`;
}

function parseListArgs(args) {
	const options = { installed: false };
	for (const arg of args) {
		if (arg === "--installed") {
			if (options.installed) {
				throw new Error("Duplicate list option: --installed");
			}
			options.installed = true;
			continue;
		}
		throw new Error(`Unknown list option: ${arg}`);
	}
	return options;
}

async function readCurrentComponents(registry) {
	const registryRoot = resolveRegistryRoot();
	const manifest = await readRegistryFile(
		registry,
		registryRoot,
		registry.manifest,
	);
	return parseComponentManifest(manifest.toString("utf8"));
}

async function listComponents(args) {
	try {
		const options = parseListArgs(args);
		const { lockSource, registry } = readProjectState(process.cwd());
		const installedComponents = parseInstalledComponents(lockSource);

		if (options.installed) {
			process.stdout.write(renderInstalledComponents(installedComponents));
			return 0;
		}

		const components = await readCurrentComponents(registry);
		process.stdout.write(
			renderAvailableComponents(components, installedComponents),
		);
		return 0;
	} catch (error) {
		process.stderr.write(`nazare list error: ${error.message}\n`);
		return 1;
	}
}

function parseAddArgs(args) {
	if (args.length !== 1) {
		throw new Error("Usage: nazare add <component>");
	}
	const id = args[0];
	if (!isValidComponentId(id)) {
		throw new Error(`Invalid component ID: ${id}`);
	}
	return id;
}

function componentInstallOrder(components, requestedId) {
	if (!components[requestedId]) {
		throw new Error(`Component not found in registry: ${requestedId}`);
	}
	const order = [];
	const seen = new Set();
	function visit(id) {
		if (seen.has(id)) return;
		const component = components[id];
		if (!component) {
			throw new Error(`Missing component dependency: ${id}`);
		}
		for (const dependency of component.dependencies) visit(dependency);
		seen.add(id);
		order.push(id);
	}
	visit(requestedId);
	return order;
}

function componentFilesFromManifest(component) {
	return component.files.map((file) => ({
		path: file.to,
		source: file.from,
		checksum: file.checksum,
	}));
}

function componentMatchesLock(manifestComponent, lockComponent) {
	if (!lockComponent) return false;
	if (manifestComponent.version !== lockComponent.version) return false;
	if (manifestComponent.type !== lockComponent.type) return false;
	if (
		JSON.stringify(manifestComponent.dependencies) !==
		JSON.stringify(lockComponent.dependencies)
	) {
		return false;
	}
	const manifestFiles = componentFilesFromManifest(manifestComponent).sort(
		(a, b) => a.path.localeCompare(b.path),
	);
	const lockFiles = [...(lockComponent.files ?? [])].sort((a, b) =>
		a.path.localeCompare(b.path),
	);
	return JSON.stringify(manifestFiles) === JSON.stringify(lockFiles);
}

function assertInstalledFilesUnmodified(cwd, id, component) {
	if (!Array.isArray(component.files)) {
		throw new Error(`Invalid installed component files: ${id}`);
	}
	for (const file of component.files) {
		const targetPath = path.join(cwd, file.path);
		if (!fs.existsSync(targetPath)) {
			throw new Error(`Installed component file is missing: ${file.path}`);
		}
		if (sha256(fs.readFileSync(targetPath)) !== file.checksum.value) {
			throw new Error(`Installed component file is modified: ${file.path}`);
		}
	}
}

function componentLockEntry(manifestComponent, timestamp) {
	return {
		version: manifestComponent.version,
		type: manifestComponent.type,
		installedAt: timestamp,
		updatedAt: timestamp,
		dependencies: [...manifestComponent.dependencies],
		files: componentFilesFromManifest(manifestComponent),
	};
}

function renderDependencyList(dependencies) {
	if (dependencies.length === 0) return "[]";
	return `\n${dependencies.map((dependency) => `      - ${dependency}`).join("\n")}`;
}

function renderComponentLockEntry(id, component) {
	const files = component.files
		.map(
			(file) =>
				`      - path: ${file.path}\n        source: ${file.source}\n        checksum:\n          algorithm: sha256\n          value: ${file.checksum.value}`,
		)
		.join("\n");
	return `  ${id}:\n    version: ${component.version}\n    type: ${component.type}\n    installedAt: "${component.installedAt}"\n    updatedAt: "${component.updatedAt}"\n    dependencies: ${renderDependencyList(component.dependencies)}\n    files:\n${files}`;
}

function extractThemeBlock(lockSource) {
	const match = lockSource.match(/(?:^|\n)(theme:\n[\s\S]*)$/);
	return match ? match[1].trimEnd() : "";
}

function renderComponentLockYaml(registry, components, themeBlock = "") {
	const ids = Object.keys(components);
	const renderedComponents =
		ids.length === 0
			? "components: {}"
			: `components:\n${ids.map((id) => renderComponentLockEntry(id, components[id])).join("\n")}`;
	const renderedTheme = themeBlock ? `\n\n${themeBlock}\n` : "";
	return `${renderRegistryYaml(registry)}\n${renderedComponents}\n${renderedTheme}`;
}

async function readCurrentComponentsWithSources(registry, ids) {
	const registryRoot = resolveRegistryRoot();
	const manifest = await readRegistryFile(
		registry,
		registryRoot,
		registry.manifest,
	);
	const components = parseComponentManifest(manifest.toString("utf8"));
	const sources = new Map();

	for (const id of ids) {
		const component = components[id];
		if (!component) continue;
		for (const file of component.files) {
			let content;
			try {
				content = await readRegistryFile(registry, registryRoot, file.from);
			} catch {
				throw new Error(`Missing component file source: ${file.from}`);
			}
			if (sha256(content) !== file.checksum.value) {
				throw new Error(`Component file checksum mismatch: ${file.from}`);
			}
			sources.set(file.from, content);
		}
	}

	return { components, sources };
}

function parseUpdateArgs(args) {
	const options = {
		target: undefined,
		latest: false,
		dev: false,
		version: undefined,
		ref: undefined,
		force: false,
		check: false,
		skipConflicts: false,
		dryRun: false,
	};

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (options.target === undefined) {
			if (arg === "self" || arg === "theme" || isValidComponentId(arg)) {
				options.target = arg;
				continue;
			}
			throw new Error(
				`Invalid update target: ${arg}; expected self, theme, or a component ID`,
			);
		}
		if (arg === "--latest") {
			options.latest = true;
			continue;
		}
		if (arg === "--dev") {
			options.dev = true;
			continue;
		}
		if (arg === "--version") {
			const val = args[i + 1];
			if (!val || val.startsWith("--"))
				throw new Error("Missing value for --version");
			options.version = val;
			i += 1;
			continue;
		}
		if (arg === "--ref") {
			const val = args[i + 1];
			if (!val || val.startsWith("--"))
				throw new Error("Missing value for --ref");
			options.ref = val;
			i += 1;
			continue;
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		if (arg === "--check") {
			options.check = true;
			continue;
		}
		if (arg === "--skip-conflicts") {
			options.skipConflicts = true;
			continue;
		}
		if (arg === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		throw new Error(`Unknown update option: ${arg}`);
	}

	if (!options.target) {
		throw new Error("Usage: nazare update self|theme|<component>");
	}

	const selectorCount = [
		options.latest,
		options.version !== undefined,
		options.ref !== undefined,
	].filter(Boolean).length;
	if (selectorCount > 1)
		throw new Error("--latest, --version, and --ref are mutually exclusive");
	if (options.dev && !options.latest)
		throw new Error("--dev requires --latest");
	if (options.version !== undefined && !SEMVER_PATTERN.test(options.version)) {
		throw new Error(`Invalid SemVer for --version: ${options.version}`);
	}

	if (options.target === "self") {
		if (
			options.force ||
			options.check ||
			options.skipConflicts ||
			options.dryRun
		) {
			throw new Error(
				"--force, --check, --skip-conflicts, and --dry-run are not valid for update self",
			);
		}
	} else if (options.target === "theme") {
		if (options.dryRun)
			throw new Error("--dry-run is not valid for update theme; use --check");
	} else {
		// component
		if (options.check || options.skipConflicts) {
			throw new Error(
				"--check and --skip-conflicts are only valid for update theme",
			);
		}
	}

	return options;
}

async function resolveUpdateRef(options, registryRepo) {
	if (options.latest) {
		if (registryRepo !== undefined && isHttpRegistryRepo(registryRepo)) {
			return resolveLatestTagRefHttp(registryRepo, options.dev);
		}
		const repoSlug =
			registryRepo !== undefined ? githubRepoSlug(registryRepo) : undefined;
		return resolveLatestTagRef({ dev: options.dev, repoSlug });
	}
	if (options.version !== undefined) {
		return `v${options.version}`;
	}
	if (options.ref !== undefined) {
		return normalizeSourceRef(options.ref);
	}
	return undefined;
}

async function addComponent(args) {
	try {
		const requestedId = parseAddArgs(args);
		const cwd = process.cwd();
		const { lockPath, lockSource, registry } = readProjectState(cwd);
		const installedComponents = parseInstalledComponents(lockSource);
		const registryComponents = await readCurrentComponents(registry);
		const order = componentInstallOrder(registryComponents, requestedId);
		const { components, sources } = await readCurrentComponentsWithSources(
			registry,
			order,
		);
		const plannedWrites = [];
		const nextComponents = { ...installedComponents };
		const ownership = new Map();

		for (const [id, component] of Object.entries(installedComponents)) {
			for (const file of component.files ?? []) {
				if (ownership.has(file.path) && ownership.get(file.path).id !== id) {
					throw new Error(
						`Component file target has multiple owners: ${file.path}`,
					);
				}
				ownership.set(file.path, { id, file });
			}
		}

		for (const id of order) {
			const manifestComponent = components[id];
			const installedComponent = installedComponents[id];

			if (installedComponent) {
				if (!componentMatchesLock(manifestComponent, installedComponent)) {
					throw new Error(`Installed component requires update: ${id}`);
				}
				assertInstalledFilesUnmodified(cwd, id, installedComponent);
				continue;
			}

			for (const file of manifestComponent.files) {
				const targetPath = path.join(cwd, file.to);
				const owner = ownership.get(file.to);
				if (owner) {
					throw new Error(`Component file target already owned: ${file.to}`);
				}
				if (fs.existsSync(targetPath)) {
					throw new Error(`Component file target exists untracked: ${file.to}`);
				}
				plannedWrites.push({ file, targetPath });
			}
		}

		if (plannedWrites.length === 0) {
			process.stdout.write(`Component already installed: ${requestedId}\n`);
			return 0;
		}

		const timestamp = new Date().toISOString();
		for (const id of order) {
			if (!installedComponents[id]) {
				nextComponents[id] = componentLockEntry(components[id], timestamp);
			}
		}

		for (const write of plannedWrites) {
			fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
			fs.writeFileSync(write.targetPath, sources.get(write.file.from));
			process.stdout.write(`Wrote ${write.file.to}\n`);
		}

		fs.writeFileSync(
			lockPath,
			renderComponentLockYaml(
				registry,
				nextComponents,
				extractThemeBlock(lockSource),
			),
		);
		process.stdout.write(`Installed components: ${order.join(", ")}\n`);
		return 0;
	} catch (error) {
		process.stderr.write(`nazare add error: ${error.message}\n`);
		return 1;
	}
}

function parseRemoveArgs(args) {
	const options = { id: undefined, force: false, dryRun: false };
	let idSet = false;
	for (const arg of args) {
		if (arg === "--force") {
			if (options.force) throw new Error("Duplicate remove option: --force");
			options.force = true;
			continue;
		}
		if (arg === "--dry-run") {
			if (options.dryRun) throw new Error("Duplicate remove option: --dry-run");
			options.dryRun = true;
			continue;
		}
		if (!idSet) {
			if (!isValidComponentId(arg)) throw new Error(`Invalid component ID: ${arg}`);
			options.id = arg;
			idSet = true;
			continue;
		}
		throw new Error(`Unknown remove option: ${arg}`);
	}
	if (!options.id) throw new Error("Usage: nazare remove <component>");
	return options;
}

async function removeComponent(args) {
	let options;
	try {
		options = parseRemoveArgs(args);
	} catch (error) {
		process.stderr.write(`nazare remove error: ${error.message}\n`);
		return 1;
	}

	const cwd = process.cwd();
	let lockPath, lockSource, registry;
	try {
		({ lockPath, lockSource, registry } = readProjectState(cwd));
	} catch (error) {
		process.stderr.write(`nazare remove error: ${error.message}\n`);
		return 1;
	}

	try {
		const installedComponents = parseInstalledComponents(lockSource);
		const { id, force, dryRun } = options;

		if (!installedComponents[id]) {
			throw new Error(`Component not installed: ${id}`);
		}

		const component = installedComponents[id];

		const dependents = Object.entries(installedComponents)
			.filter(([otherId, other]) => otherId !== id && other.dependencies.includes(id))
			.map(([otherId]) => otherId)
			.sort();

		if (dependents.length > 0 && !force) {
			if (!process.stdin.isTTY || !process.stdout.isTTY) {
				throw new Error(
					`Cannot remove ${id}: ${dependents.join(", ")} depend${dependents.length === 1 ? "s" : ""} on it. Remove dependents first or pass --force.`,
				);
			}
			process.stdout.write(
				`Warning: the following installed components depend on ${id}:\n${dependents.map((d) => `  - ${d}`).join("\n")}\n`,
			);
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			let answer;
			try {
				answer = (await rl.question(`Remove ${id} anyway? [y/N] `)).trim().toLowerCase();
			} finally {
				rl.close();
			}
			if (answer !== "y" && answer !== "yes") {
				process.stdout.write("Aborted.\n");
				return 0;
			}
		}

		const files = component.files ?? [];
		const toDelete = [];
		const modifiedFiles = [];

		for (const file of files) {
			const targetPath = path.join(cwd, file.path);
			if (!fs.existsSync(targetPath)) {
				if (dryRun) process.stdout.write(`Already gone  ${file.path}\n`);
			} else if (sha256(fs.readFileSync(targetPath)) === file.checksum.value) {
				toDelete.push({ file, targetPath });
			} else {
				modifiedFiles.push({ file, targetPath });
			}
		}

		if (dryRun) {
			for (const { file } of toDelete) {
				process.stdout.write(`Would delete  ${file.path}\n`);
			}
			for (const { file } of modifiedFiles) {
				process.stdout.write(`Would skip    ${file.path} (modified)\n`);
			}
			process.stdout.write(`Would remove component: ${id}\n`);
			return 0;
		}

		for (const { file, targetPath } of toDelete) {
			fs.rmSync(targetPath);
			process.stdout.write(`Deleted ${file.path}\n`);
		}

		if (force) {
			for (const { file, targetPath } of modifiedFiles) {
				fs.rmSync(targetPath);
				process.stdout.write(`Deleted ${file.path} (modified)\n`);
			}
		} else {
			for (const { file } of modifiedFiles) {
				process.stderr.write(`Skipped ${file.path} (modified; pass --force to delete)\n`);
			}
		}

		const nextComponents = { ...installedComponents };
		delete nextComponents[id];

		fs.writeFileSync(
			lockPath,
			renderComponentLockYaml(registry, nextComponents, extractThemeBlock(lockSource)),
		);

		process.stdout.write(`Removed component: ${id}\n`);
		return 0;
	} catch (error) {
		process.stderr.write(`nazare remove error: ${error.message}\n`);
		return 1;
	}
}

function componentUpdatedLockEntry(
	manifestComponent,
	installedComponent,
	timestamp,
) {
	return {
		version: manifestComponent.version,
		type: manifestComponent.type,
		installedAt: installedComponent.installedAt ?? timestamp,
		updatedAt: timestamp,
		dependencies: [...manifestComponent.dependencies],
		files: componentFilesFromManifest(manifestComponent),
	};
}

function buildComponentOwnership(installedComponents) {
	const ownership = new Map();
	for (const [id, component] of Object.entries(installedComponents)) {
		for (const file of component.files ?? []) {
			if (ownership.has(file.path) && ownership.get(file.path).id !== id) {
				throw new Error(
					`Component file target has multiple owners: ${file.path}`,
				);
			}
			ownership.set(file.path, { id, file });
		}
	}
	return ownership;
}

function splitPreservingNewlines(source) {
	return source.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function diffChunks(localLines, incomingLines) {
	const table = Array.from({ length: localLines.length + 1 }, () =>
		Array(incomingLines.length + 1).fill(0),
	);
	for (let localIndex = localLines.length - 1; localIndex >= 0; localIndex--) {
		for (
			let incomingIndex = incomingLines.length - 1;
			incomingIndex >= 0;
			incomingIndex--
		) {
			table[localIndex][incomingIndex] =
				localLines[localIndex] === incomingLines[incomingIndex]
					? table[localIndex + 1][incomingIndex + 1] + 1
					: Math.max(
							table[localIndex + 1][incomingIndex],
							table[localIndex][incomingIndex + 1],
						);
		}
	}

	const chunks = [];
	let localIndex = 0;
	let incomingIndex = 0;
	let pending = null;
	function flushPending() {
		if (!pending) return;
		chunks.push(pending);
		pending = null;
	}
	function pushChanged(side, line) {
		pending ??= { type: "change", local: [], incoming: [] };
		pending[side].push(line);
	}

	while (
		localIndex < localLines.length &&
		incomingIndex < incomingLines.length
	) {
		if (localLines[localIndex] === incomingLines[incomingIndex]) {
			flushPending();
			chunks.push({ type: "equal", lines: [localLines[localIndex]] });
			localIndex++;
			incomingIndex++;
		} else if (
			table[localIndex + 1][incomingIndex] >=
			table[localIndex][incomingIndex + 1]
		) {
			pushChanged("local", localLines[localIndex]);
			localIndex++;
		} else {
			pushChanged("incoming", incomingLines[incomingIndex]);
			incomingIndex++;
		}
	}
	while (localIndex < localLines.length) {
		pushChanged("local", localLines[localIndex]);
		localIndex++;
	}
	while (incomingIndex < incomingLines.length) {
		pushChanged("incoming", incomingLines[incomingIndex]);
		incomingIndex++;
	}
	flushPending();

	return chunks;
}

function ensureTrailingNewline(source) {
	return source.endsWith("\n") || source.length === 0 ? source : `${source}\n`;
}

function markerContent(
	localContent,
	registryContent,
	id,
	version,
	removed = false,
) {
	const local = Buffer.isBuffer(localContent)
		? localContent.toString("utf8")
		: String(localContent ?? "");
	const incoming = Buffer.isBuffer(registryContent)
		? registryContent.toString("utf8")
		: String(registryContent ?? "");
	const markerLabel = `registry ${id}@${version}${removed ? " (removed)" : ""}`;
	return diffChunks(
		splitPreservingNewlines(local),
		splitPreservingNewlines(incoming),
	)
		.map((chunk) => {
			if (chunk.type === "equal") return chunk.lines.join("");
			const localSide = ensureTrailingNewline(chunk.local.join(""));
			const incomingSide = ensureTrailingNewline(chunk.incoming.join(""));
			return `<<<<<<< local\n${localSide}=======\n${incomingSide}>>>>>>> ${markerLabel}\n`;
		})
		.join("");
}

async function promptComponentUpdate(operation, rl) {
	const action =
		operation.kind === "delete"
			? "Delete local file?"
			: "Overwrite with registry version?";
	if (operation.kind === "delete") {
		process.stdout.write(
			`${operation.path} modified locally and no longer exists in registry component.\n`,
		);
	} else if (operation.localChecksum !== operation.installedChecksum) {
		process.stdout.write(`${operation.path} modified locally.\n`);
	} else {
		process.stdout.write(`${operation.path} exists locally.\n`);
	}
	while (true) {
		const answer = (await rl.question(`${action} [y/N/m] `))
			.trim()
			.toLowerCase();
		if (answer === "y" || answer === "yes") return "yes";
		if (answer === "m" || answer === "manual") return "manual";
		if (answer === "" || answer === "n" || answer === "no") return "no";
	}
}

async function promptComponentRecreate(operation, rl) {
	process.stdout.write(`${operation.path} is missing locally.\n`);
	while (true) {
		const answer = (await rl.question("Recreate from registry version? [y/N] "))
			.trim()
			.toLowerCase();
		if (answer === "y" || answer === "yes") return "yes";
		if (answer === "" || answer === "n" || answer === "no") return "no";
	}
}

function renderUpdateHeader(id, installedComponent, manifestComponent) {
	return `${id} ${installedComponent.version} -> ${manifestComponent.version}\n`;
}

async function updateComponent(options, selectedRef) {
	try {
		const cwd = process.cwd();
		const { configPath, lockPath, configSource, lockSource, registry } =
			readProjectState(cwd);
		const effectiveRegistry = selectedRef
			? { ...registry, ref: selectedRef }
			: registry;
		const installedComponents = parseInstalledComponents(lockSource);
		const installedComponent = installedComponents[options.target];
		if (!installedComponent) {
			throw new Error(
				`Component not installed: ${options.target}; run nazare add ${options.target}`,
			);
		}

		const registryComponents = await readCurrentComponents(effectiveRegistry);
		const updateOrder = componentInstallOrder(
			registryComponents,
			options.target,
		);
		for (const id of updateOrder) {
			if (!installedComponents[id]) {
				throw new Error(
					`Missing installed component dependency: ${id}; run nazare add ${id}`,
				);
			}
		}
		const { components, sources } = await readCurrentComponentsWithSources(
			effectiveRegistry,
			updateOrder,
		);
		const ownership = buildComponentOwnership(installedComponents);
		const writes = [];
		const deletes = [];
		const prompts = [];
		const manualWrites = [];
		const touchedComponents = new Set();

		for (const id of updateOrder) {
			const manifestComponent = components[id];
			const installed = installedComponents[id];
			const installedByPath = new Map(
				(installed.files ?? []).map((file) => [file.path, file]),
			);
			const manifestByPath = new Map(
				manifestComponent.files.map((file) => [file.to, file]),
			);

			for (const manifestFile of manifestComponent.files) {
				const targetPath = path.join(cwd, manifestFile.to);
				const owner = ownership.get(manifestFile.to);
				if (owner && owner.id !== id) {
					throw new Error(
						`Component file target already owned: ${manifestFile.to}`,
					);
				}
				const installedFile = installedByPath.get(manifestFile.to);
				const registryContent = sources.get(manifestFile.from);
				const write = {
					id,
					kind: "write",
					path: manifestFile.to,
					targetPath,
					source: manifestFile.from,
					content: registryContent,
					checksum: manifestFile.checksum,
				};

				if (!installedFile) {
					if (fs.existsSync(targetPath)) {
						throw new Error(
							`Component file target exists untracked: ${manifestFile.to}`,
						);
					}
					writes.push(write);
					touchedComponents.add(id);
					continue;
				}

				if (!fs.existsSync(targetPath)) {
					prompts.push({ kind: "recreate", ...write });
					touchedComponents.add(id);
					continue;
				}

				const localContent = fs.readFileSync(targetPath);
				const localChecksum = sha256(localContent);
				if (localChecksum !== manifestFile.checksum.value) {
					touchedComponents.add(id);
					if (options.force) {
						writes.push(write);
					} else {
						prompts.push({
							kind: "write",
							localContent,
							localChecksum,
							installedChecksum: installedFile.checksum.value,
							...write,
						});
					}
				}
			}

			for (const installedFile of installed.files ?? []) {
				if (manifestByPath.has(installedFile.path)) continue;
				const targetPath = path.join(cwd, installedFile.path);
				touchedComponents.add(id);
				if (!fs.existsSync(targetPath)) {
					deletes.push({
						id,
						kind: "untrack",
						path: installedFile.path,
						targetPath,
					});
					continue;
				}
				const localContent = fs.readFileSync(targetPath);
				const localChecksum = sha256(localContent);
				const operation = {
					id,
					kind: "delete",
					path: installedFile.path,
					targetPath,
					localContent,
					content: Buffer.alloc(0),
				};
				if (localChecksum !== installedFile.checksum.value && !options.force) {
					prompts.push(operation);
					continue;
				}
				deletes.push(operation);
			}
		}

		const plannedCount = writes.length + deletes.length + prompts.length;
		const componentsToUpdate = updateOrder.filter(
			(id) =>
				touchedComponents.has(id) ||
				!componentMatchesLock(components[id], installedComponents[id]),
		);
		if (plannedCount === 0 && componentsToUpdate.length === 0) {
			process.stdout.write(`Component already up to date: ${options.target}\n`);
			return 0;
		}

		for (const id of componentsToUpdate) {
			process.stdout.write(
				renderUpdateHeader(id, installedComponents[id], components[id]),
			);
		}
		if (options.dryRun) {
			for (const write of writes)
				process.stdout.write(`Would write ${write.path}\n`);
			for (const file of deletes) {
				process.stdout.write(
					`${file.kind === "untrack" ? "Would untrack" : "Would delete"} ${file.path}\n`,
				);
			}
			for (const prompt of prompts) {
				process.stdout.write(`Would prompt ${prompt.kind} ${prompt.path}\n`);
			}
			return 0;
		}

		if (prompts.length > 0 && options.force) {
			for (const prompt of prompts) {
				if (prompt.kind === "delete") deletes.push(prompt);
				else writes.push(prompt);
			}
		} else if (prompts.length > 0) {
			if (
				(!process.stdin.isTTY || !process.stdout.isTTY) &&
				process.env.NAZARE_TEST_INTERACTIVE !== "1"
			) {
				throw new Error(
					"Component update requires an interactive terminal or --force",
				);
			}
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				for (const prompt of prompts) {
					const answer =
						prompt.kind === "recreate"
							? await promptComponentRecreate(prompt, rl)
							: await promptComponentUpdate(prompt, rl);
					if (answer === "no") {
						process.stdout.write(
							`Skipped ${prompt.path}; component not fully updated.\n`,
						);
						return 0;
					}
					if (answer === "manual") {
						manualWrites.push(prompt);
						continue;
					}
					if (prompt.kind === "delete") deletes.push(prompt);
					else writes.push(prompt);
				}
			} finally {
				rl.close();
			}
		}

		if (manualWrites.length > 0) {
			for (const file of manualWrites) {
				fs.writeFileSync(
					file.targetPath,
					markerContent(
						file.localContent,
						file.content,
						file.id,
						components[file.id].version,
						file.kind === "delete",
					),
				);
				process.stdout.write(
					`Wrote manual conflict markers to ${file.path}.\n`,
				);
			}
			process.stdout.write(
				`Resolve markers manually. nazare.lock.yml was not updated.\nRun nazare update ${options.target} again after resolving if you want to accept the registry update.\n`,
			);
			return 0;
		}

		for (const write of writes) {
			fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
			fs.writeFileSync(write.targetPath, write.content);
			process.stdout.write(`Wrote ${write.path}\n`);
		}
		for (const file of deletes) {
			if (file.kind === "untrack") {
				process.stdout.write(`Untracked ${file.path}\n`);
				continue;
			}
			fs.rmSync(file.targetPath);
			process.stdout.write(`Deleted ${file.path}\n`);
		}

		const nextComponents = { ...installedComponents };
		const timestamp = new Date().toISOString();
		for (const id of componentsToUpdate) {
			nextComponents[id] = componentUpdatedLockEntry(
				components[id],
				installedComponents[id],
				timestamp,
			);
		}
		fs.writeFileSync(
			lockPath,
			renderComponentLockYaml(
				effectiveRegistry,
				nextComponents,
				extractThemeBlock(lockSource),
			),
		);
		if (selectedRef) {
			fs.writeFileSync(
				configPath,
				replaceRegistryYaml(
					configSource,
					effectiveRegistry,
					"nazare.config.yml",
				),
			);
		}
		process.stdout.write("Done.\n");
		return 0;
	} catch (error) {
		process.stderr.write(`nazare update error: ${error.message}\n`);
		return 1;
	}
}

function parseThemeManifest(source) {
	const lines = source.split("\n");
	const theme = { files: [] };
	let inTheme = false;
	let inFiles = false;
	let current;

	for (const line of lines) {
		if (line === "theme:") {
			inTheme = true;
			inFiles = false;
			continue;
		}

		if (inTheme && /^\S/.test(line) && line !== "theme:") {
			break;
		}

		if (!inTheme) continue;

		const versionMatch = line.match(/^\s+version:\s*(.+)$/);
		const sourceMatch = line.match(/^\s+source:\s*(.+)$/);
		const filesMatch = line.match(/^\s+files:\s*$/);
		const fromMatch = line.match(/^\s*-\s+from:\s*(.+)$/);
		const toMatch = line.match(/^\s+to:\s*(.+)$/);
		const checksumMatch = line.match(/^\s+checksum:\s*$/);
		const algorithmMatch = line.match(/^\s+algorithm:\s*(.+)$/);
		const valueMatch = line.match(/^\s+value:\s*(.+)$/);

		if (versionMatch) theme.version = versionMatch[1].trim();
		if (sourceMatch) theme.source = sourceMatch[1].trim();
		if (filesMatch) inFiles = true;
		if (inFiles && fromMatch) {
			current = { from: fromMatch[1].trim() };
			theme.files.push(current);
		}
		if (inFiles && toMatch && current) {
			current.to = toMatch[1].trim();
		}
		if (inFiles && checksumMatch && current) {
			current.checksum = {};
		}
		if (inFiles && algorithmMatch && current?.checksum) {
			current.checksum.algorithm = algorithmMatch[1].trim();
		}
		if (inFiles && valueMatch && current?.checksum) {
			current.checksum.value = valueMatch[1].trim();
		}
	}

	if (!inTheme) {
		throw new Error("Registry manifest has no theme block");
	}
	if (!theme.version || !SEMVER_PATTERN.test(theme.version)) {
		throw new Error("Invalid theme.version in registry manifest");
	}
	if (!theme.source) {
		throw new Error("Invalid theme.source in registry manifest");
	}
	if (
		theme.files.length === 0 ||
		theme.files.some((file) => !file.from || !file.to)
	) {
		throw new Error("Invalid theme.files in registry manifest");
	}

	return theme;
}

function isSafeRelativePath(value) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		!value.split("/").includes("..")
	);
}

function hasValidRegistryChecksum(file) {
	return (
		file.checksum?.algorithm === "sha256" &&
		typeof file.checksum.value === "string" &&
		/^[0-9a-f]{64}$/.test(file.checksum.value)
	);
}

function ensureSafeThemeFiles(theme) {
	const seenTargets = new Set();

	for (const file of theme.files) {
		if (!isSafeRelativePath(file.from)) {
			throw new Error(`Unsafe theme file source path: ${file.from}`);
		}
		if (!isSafeRelativePath(file.to)) {
			throw new Error(`Unsafe theme file target path: ${file.to}`);
		}
		if (!hasValidRegistryChecksum(file)) {
			throw new Error(`Invalid theme file checksum metadata: ${file.from}`);
		}
		if (seenTargets.has(file.to)) {
			throw new Error(`Duplicate theme file target path: ${file.to}`);
		}
		seenTargets.add(file.to);
	}
}

function githubRepoSlug(repo) {
	const match = repo.match(
		/^(?:https:\/\/github\.com\/|git@github\.com:|github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
	);
	if (!match) {
		throw new Error(`Cannot resolve registry repo: ${repo}`);
	}
	return match[1];
}

function encodeRegistryPath(filePath) {
	return filePath.split("/").map(encodeURIComponent).join("/");
}

function registryRawUrl(registry, filePath) {
	if (isHttpRegistryRepo(registry.repo)) {
		return `${registry.repo.replace(/\/$/, "")}/raw/${encodeRegistryPath(filePath)}?ref=${encodeURIComponent(registry.ref)}`;
	}

	return `https://raw.githubusercontent.com/${githubRepoSlug(registry.repo)}/${registry.ref}/${filePath}`;
}

function resolveRegistryRoot() {
	if (process.env.NAZARE_REGISTRY_DIR) {
		return path.resolve(process.env.NAZARE_REGISTRY_DIR);
	}

	return getInstallDir();
}

async function readRegistryFile(registry, registryRoot, filePath) {
	if (isHttpRegistryRepo(registry.repo)) {
		return fetchUrlBuffer(registryRawUrl(registry, filePath));
	}

	const localPath = path.join(registryRoot, filePath);
	if (fs.existsSync(localPath)) {
		return fs.readFileSync(localPath);
	}

	return fetchUrlBuffer(registryRawUrl(registry, filePath));
}

function parseThemePullArgs(args) {
	const options = { yes: false };

	for (const arg of args) {
		if (arg === "--yes") {
			options.yes = true;
			continue;
		}
		throw new Error(`Unknown theme pull option: ${arg}`);
	}

	return options;
}

async function promptThemePullConflict(file, rl) {
	while (true) {
		const answer = (
			await rl.question(
				`Theme file exists: ${file.to}. Choose skip, overwrite, all, or none [skip]: `,
			)
		)
			.trim()
			.toLowerCase();
		const choice = answer || "skip";
		if (["skip", "overwrite", "all", "none"].includes(choice)) {
			return choice;
		}
		process.stdout.write("Choose skip, overwrite, all, or none.\n");
	}
}

function canPromptThemePull() {
	return (
		process.stdin.isTTY || process.env.NAZARE_THEME_PULL_INTERACTIVE === "1"
	);
}

function sha256(buffer) {
	return crypto.createHash("sha256").update(buffer).digest("hex");
}

function themeBlockExists(lockSource) {
	return /(?:^|\n)theme:\n/.test(lockSource);
}

function parseThemeLockMetadata(lockSource) {
	const themeMatch = lockSource.match(/(?:^|\n)theme:\n([\s\S]*?)(?:\n\S|$)/);
	if (!themeMatch) return undefined;

	const theme = { files: [] };
	let current;
	let inChecksum = false;

	for (const line of themeMatch[1].split("\n")) {
		const versionMatch = line.match(/^\s+version:\s*(.+)$/);
		const sourceMatch = line.match(/^\s+source:\s*(.+)$/);
		const installedAtMatch = line.match(/^\s+installedAt:\s*"?(.+?)"?\s*$/);
		const updatedAtMatch = line.match(/^\s+updatedAt:\s*"?(.+?)"?\s*$/);
		const pathMatch = line.match(/^\s*-\s+path:\s*(.+)$/);
		const fileSourceMatch = line.match(/^\s+source:\s*(.+)$/);
		const checksumMatch = line.match(/^\s+checksum:\s*$/);
		const algorithmMatch = line.match(/^\s+algorithm:\s*(.+)$/);
		const valueMatch = line.match(/^\s+value:\s*(.+)$/);

		if (versionMatch) theme.version = versionMatch[1].trim();
		if (sourceMatch && !current) theme.source = sourceMatch[1].trim();
		if (installedAtMatch) theme.installedAt = installedAtMatch[1].trim();
		if (updatedAtMatch) theme.updatedAt = updatedAtMatch[1].trim();
		if (pathMatch) {
			current = { path: pathMatch[1].trim() };
			theme.files.push(current);
			inChecksum = false;
			continue;
		}
		if (fileSourceMatch && current && !inChecksum) {
			current.source = fileSourceMatch[1].trim();
			continue;
		}
		if (checksumMatch && current) {
			current.checksum = {};
			inChecksum = true;
			continue;
		}
		if (algorithmMatch && current?.checksum) {
			current.checksum.algorithm = algorithmMatch[1].trim();
			continue;
		}
		if (valueMatch && current?.checksum) {
			current.checksum.value = valueMatch[1].trim();
		}
	}

	return theme;
}

function existingLockThemeFiles(lockSource) {
	return parseThemeLockMetadata(lockSource)?.files ?? [];
}

function hasValidChecksum(file) {
	return (
		file.checksum?.algorithm === "sha256" &&
		typeof file.checksum.value === "string" &&
		/^[0-9a-f]{64}$/i.test(file.checksum.value)
	);
}

function renderThemeFileEntry(file) {
	const checksum = hasValidChecksum(file)
		? `\n      checksum:\n        algorithm: sha256\n        value: ${file.checksum.value}`
		: "";
	return `    - path: ${file.path}\n      source: ${file.source}${checksum}`;
}

function extractComponentsBlock(lockSource) {
	const match = lockSource.match(
		/(?:^|\n)(components:[\s\S]*?)(?=\n[a-zA-Z][\w-]*:|$)/,
	);
	return match ? match[1].trimEnd() : "components: {}";
}

function renderThemeLockYaml(
	registry,
	theme,
	files,
	timestamps = {},
	componentsBlock = "components: {}",
) {
	const renderedFiles = [...files]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map(renderThemeFileEntry)
		.join("\n");
	const updatedAt = timestamps.updatedAt
		? `  updatedAt: "${timestamps.updatedAt}"\n`
		: "";

	return `${renderRegistryYaml(registry)}
${componentsBlock}

theme:
  version: ${theme.version}
  source: ${theme.source}
  installedAt: "${timestamps.installedAt ?? new Date().toISOString()}"
${updatedAt}  files:
${renderedFiles}
`;
}

function readProjectState(cwd) {
	const configPath = path.join(cwd, "nazare.config.yml");
	const lockPath = path.join(cwd, "nazare.lock.yml");

	if (!fs.existsSync(configPath)) {
		throw new Error("Missing nazare.config.yml; run nazare init first");
	}
	if (!fs.existsSync(lockPath)) {
		throw new Error("Missing nazare.lock.yml; run nazare init first");
	}

	const configSource = fs.readFileSync(configPath, "utf8");
	const lockSource = fs.readFileSync(lockPath, "utf8");
	const registry = parseRegistryYaml(configSource, "nazare.config.yml");
	const lockRegistry = parseRegistryYaml(lockSource, "nazare.lock.yml");

	if (
		registry.repo !== lockRegistry.repo ||
		registry.ref !== lockRegistry.ref
	) {
		throw new Error(
			"Registry metadata mismatch between nazare.config.yml and nazare.lock.yml; run nazare init to reinitialize or repair the metadata",
		);
	}

	return { configPath, lockPath, configSource, lockSource, registry };
}

async function readCurrentTheme(registry) {
	const registryRoot = resolveRegistryRoot();
	const manifest = await readRegistryFile(
		registry,
		registryRoot,
		registry.manifest,
	);
	const theme = parseThemeManifest(manifest.toString("utf8"));
	ensureSafeThemeFiles(theme);

	const sources = new Map();
	for (const file of theme.files) {
		let content;
		try {
			content = await readRegistryFile(registry, registryRoot, file.from);
		} catch {
			throw new Error(`Missing theme file source: ${file.from}`);
		}
		const actualChecksum = sha256(content);
		if (actualChecksum !== file.checksum.value) {
			throw new Error(`Theme file checksum mismatch: ${file.from}`);
		}
		sources.set(file.from, content);
	}

	return { theme, sources };
}

async function themePull(args) {
	let options;
	try {
		options = parseThemePullArgs(args);
	} catch (error) {
		process.stderr.write(`nazare theme pull error: ${error.message}\n`);
		return 1;
	}

	const cwd = process.cwd();
	const configPath = path.join(cwd, "nazare.config.yml");
	const lockPath = path.join(cwd, "nazare.lock.yml");

	try {
		if (!fs.existsSync(configPath)) {
			throw new Error("Missing nazare.config.yml; run nazare init first");
		}
		if (!fs.existsSync(lockPath)) {
			throw new Error("Missing nazare.lock.yml; run nazare init first");
		}

		const configSource = fs.readFileSync(configPath, "utf8");
		const lockSource = fs.readFileSync(lockPath, "utf8");
		const registry = parseRegistryYaml(configSource, "nazare.config.yml");
		parseRegistryYaml(lockSource, "nazare.lock.yml");
		const { theme, sources } = await readCurrentTheme(registry);

		const conflicts = theme.files.filter((file) =>
			fs.existsSync(path.join(cwd, file.to)),
		);
		if (conflicts.length > 0 && !options.yes && !canPromptThemePull()) {
			throw new Error(
				`Theme file conflicts require --yes: ${conflicts.map((file) => file.to).join(", ")}`,
			);
		}

		const writtenFiles = [];
		let conflictMode;
		let rl;
		try {
			if (conflicts.length > 0 && !options.yes) {
				rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});
			}

			for (const file of theme.files) {
				const targetPath = path.join(cwd, file.to);
				const exists = fs.existsSync(targetPath);
				if (exists && !options.yes) {
					let choice = conflictMode;
					if (!choice) {
						choice = await promptThemePullConflict(file, rl);
						if (choice === "all") conflictMode = "overwrite";
						if (choice === "none") conflictMode = "skip";
					}
					if (choice === "skip" || choice === "none") {
						process.stdout.write(`Skipped ${file.to}\n`);
						continue;
					}
				}

				const content = sources.get(file.from);
				fs.mkdirSync(path.dirname(targetPath), { recursive: true });
				fs.writeFileSync(targetPath, content);
				writtenFiles.push({
					path: file.to,
					source: file.from,
					checksum: file.checksum,
				});
				process.stdout.write(`Wrote ${file.to}\n`);
			}
		} finally {
			if (rl) rl.close();
		}

		if (writtenFiles.length > 0) {
			const merged = new Map(
				existingLockThemeFiles(lockSource).map((file) => [file.path, file]),
			);
			for (const file of writtenFiles) {
				merged.set(file.path, file);
			}
			fs.writeFileSync(
				lockPath,
				renderThemeLockYaml(
					registry,
					theme,
					[...merged.values()],
					{},
					extractComponentsBlock(lockSource),
				),
			);
		}

		return 0;
	} catch (error) {
		process.stderr.write(`nazare theme pull error: ${error.message}\n`);
		return 1;
	}
}

async function themeUpdate(options, selectedRef) {
	const cwd = process.cwd();

	try {
		const { configPath, lockPath, configSource, lockSource, registry } =
			readProjectState(cwd);
		const effectiveRegistry = selectedRef
			? { ...registry, ref: selectedRef }
			: registry;
		if (!themeBlockExists(lockSource)) {
			throw new Error("Missing theme metadata; run nazare theme pull first");
		}

		const lockTheme = parseThemeLockMetadata(lockSource);
		if (!lockTheme || !Array.isArray(lockTheme.files)) {
			throw new Error("Invalid theme metadata in nazare.lock.yml");
		}

		for (const file of lockTheme.files) {
			if (!isSafeRelativePath(file.path)) {
				throw new Error(`Unsafe tracked theme file path: ${file.path}`);
			}
			if (!isSafeRelativePath(file.source)) {
				throw new Error(
					`Unsafe tracked theme file source path: ${file.source}`,
				);
			}
		}

		const { theme, sources } = await readCurrentTheme(effectiveRegistry);
		const manifestByPath = new Map(theme.files.map((file) => [file.to, file]));
		const trackedByPath = new Map(
			lockTheme.files.map((file) => [file.path, { ...file }]),
		);
		const errors = [];
		const writes = [];
		const deletes = [];
		const untracks = [];
		const metadataUpdates = [];
		const skipped = [];
		const skipConflict = (message, file) => {
			if (options.skipConflicts && !options.force) {
				skipped.push({ path: file.path, message });
				return true;
			}
			return false;
		};

		for (const tracked of trackedByPath.values()) {
			const manifestFile = manifestByPath.get(tracked.path);
			const targetPath = path.join(cwd, tracked.path);
			const exists = fs.existsSync(targetPath);
			const localContent = exists ? fs.readFileSync(targetPath) : undefined;
			const localChecksum = exists ? sha256(localContent) : undefined;
			const hasChecksum = hasValidChecksum(tracked);
			const modified =
				exists && hasChecksum && localChecksum !== tracked.checksum.value;

			if (!manifestFile) {
				if (!exists) {
					untracks.push(tracked);
					continue;
				}
				if (!hasChecksum) {
					if (!options.force) {
						if (
							skipConflict(
								`Missing checksum metadata for obsolete theme file: ${tracked.path}`,
								tracked,
							)
						) {
							continue;
						}
						errors.push(
							`Missing checksum metadata for obsolete theme file: ${tracked.path}`,
						);
						continue;
					}
					deletes.push(tracked);
					continue;
				}
				if (modified && !options.force) {
					if (
						skipConflict(
							`Modified obsolete theme file: ${tracked.path}`,
							tracked,
						)
					) {
						continue;
					}
					errors.push(`Modified obsolete theme file: ${tracked.path}`);
					continue;
				}
				deletes.push(tracked);
				continue;
			}

			const registryContent = sources.get(manifestFile.from);
			const registryChecksum = manifestFile.checksum.value;
			const registryFile = {
				path: manifestFile.to,
				source: manifestFile.from,
				content: registryContent,
				checksum: manifestFile.checksum,
			};

			if (!hasChecksum) {
				if (!exists) {
					if (!options.force) {
						if (
							skipConflict(
								`Missing installed theme file without checksum metadata: ${tracked.path}`,
								tracked,
							)
						) {
							continue;
						}
						errors.push(
							`Missing installed theme file without checksum metadata: ${tracked.path}`,
						);
						continue;
					}
					writes.push(registryFile);
					continue;
				}
				if (localChecksum === registryChecksum) {
					metadataUpdates.push({
						path: manifestFile.to,
						source: manifestFile.from,
						checksum: registryFile.checksum,
					});
					continue;
				}
				if (!options.force) {
					if (
						skipConflict(
							`Missing checksum metadata for tracked theme file with local changes: ${tracked.path}`,
							tracked,
						)
					) {
						continue;
					}
					errors.push(
						`Missing checksum metadata for tracked theme file with local changes: ${tracked.path}`,
					);
					continue;
				}
				writes.push(registryFile);
				continue;
			}

			if (!exists && !options.force) {
				if (
					skipConflict(`Missing installed theme file: ${tracked.path}`, tracked)
				) {
					continue;
				}
				errors.push(`Missing installed theme file: ${tracked.path}`);
				continue;
			}
			if (modified && !options.force) {
				if (
					skipConflict(
						`Modified installed theme file: ${tracked.path}`,
						tracked,
					)
				) {
					continue;
				}
				errors.push(`Modified installed theme file: ${tracked.path}`);
				continue;
			}

			if (exists && localChecksum === registryChecksum) {
				if (
					tracked.checksum.value !== registryChecksum ||
					tracked.source !== manifestFile.from
				) {
					metadataUpdates.push({
						path: manifestFile.to,
						source: manifestFile.from,
						checksum: registryFile.checksum,
					});
				}
				continue;
			}

			writes.push(registryFile);
		}

		for (const manifestFile of theme.files) {
			if (trackedByPath.has(manifestFile.to)) continue;
			const targetPath = path.join(cwd, manifestFile.to);
			const exists = fs.existsSync(targetPath);
			if (exists && !options.force) {
				if (
					skipConflict(
						`Untracked theme file target exists: ${manifestFile.to}`,
						{
							path: manifestFile.to,
						},
					)
				) {
					continue;
				}
				errors.push(`Untracked theme file target exists: ${manifestFile.to}`);
				continue;
			}
			const content = sources.get(manifestFile.from);
			writes.push({
				path: manifestFile.to,
				source: manifestFile.from,
				content,
				checksum: manifestFile.checksum,
			});
		}

		if (errors.length > 0) {
			throw new Error(errors.join("; "));
		}

		const mutationOperations =
			writes.length + deletes.length + untracks.length + metadataUpdates.length;
		const reportableOperations = mutationOperations + skipped.length;
		if (options.check) {
			if (reportableOperations === 0) {
				process.stdout.write("Theme already up to date\n");
				return 0;
			}
			for (const file of writes)
				process.stdout.write(`Would write ${file.path}\n`);
			for (const file of deletes)
				process.stdout.write(`Would delete ${file.path}\n`);
			for (const file of untracks)
				process.stdout.write(`Would untrack ${file.path}\n`);
			for (const file of metadataUpdates)
				process.stdout.write(`Would update metadata ${file.path}\n`);
			for (const file of skipped)
				process.stdout.write(`Would skip ${file.path}: ${file.message}\n`);
			return 0;
		}

		if (reportableOperations === 0) {
			process.stdout.write("Theme already up to date\n");
			if (selectedRef) {
				fs.writeFileSync(
					configPath,
					replaceRegistryYaml(
						configSource,
						effectiveRegistry,
						"nazare.config.yml",
					),
				);
				fs.writeFileSync(
					lockPath,
					replaceRegistryYaml(lockSource, effectiveRegistry, "nazare.lock.yml"),
				);
			}
			return 0;
		}

		for (const file of writes) {
			const targetPath = path.join(cwd, file.path);
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.writeFileSync(targetPath, file.content);
			process.stdout.write(`Wrote ${file.path}\n`);
		}
		for (const file of deletes) {
			fs.rmSync(path.join(cwd, file.path));
			process.stdout.write(`Deleted ${file.path}\n`);
		}
		for (const file of untracks) {
			process.stdout.write(`Untracked ${file.path}\n`);
		}
		for (const file of metadataUpdates) {
			process.stdout.write(`Updated metadata ${file.path}\n`);
		}
		for (const file of skipped) {
			process.stdout.write(`Skipped ${file.path}: ${file.message}\n`);
		}

		if (mutationOperations === 0) {
			return 0;
		}

		const nextFiles = new Map(
			lockTheme.files.map((file) => [file.path, { ...file }]),
		);
		for (const file of deletes) nextFiles.delete(file.path);
		for (const file of untracks) nextFiles.delete(file.path);
		for (const file of writes) {
			nextFiles.set(file.path, {
				path: file.path,
				source: file.source,
				checksum: file.checksum,
			});
		}
		for (const file of metadataUpdates) {
			nextFiles.set(file.path, file);
		}

		const isFullSuccess = mutationOperations > 0 && skipped.length === 0;
		const lockRegistry =
			isFullSuccess && selectedRef ? effectiveRegistry : registry;
		fs.writeFileSync(
			lockPath,
			renderThemeLockYaml(
				lockRegistry,
				theme,
				[...nextFiles.values()],
				{
					installedAt: lockTheme.installedAt ?? new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
				extractComponentsBlock(lockSource),
			),
		);
		if (isFullSuccess && selectedRef) {
			fs.writeFileSync(
				configPath,
				replaceRegistryYaml(
					configSource,
					effectiveRegistry,
					"nazare.config.yml",
				),
			);
		}

		return 0;
	} catch (error) {
		process.stderr.write(`nazare update error: ${error.message}\n`);
		return 1;
	}
}

function initTheme(args) {
	let options;
	try {
		options = parseInitArgs(args);
	} catch (error) {
		process.stderr.write(`nazare init error: ${error.message}\n`);
		return 1;
	}

	const targetDir = options.directory
		? path.resolve(process.cwd(), options.directory)
		: process.cwd();
	const configPath = path.join(targetDir, "nazare.config.yml");
	const lockPath = path.join(targetDir, "nazare.lock.yml");
	let createdConfig = false;

	try {
		fs.mkdirSync(targetDir, { recursive: true });

		if (fs.existsSync(lockPath)) {
			throw new Error(`Target already has nazare.lock.yml: ${lockPath}`);
		}

		if (fs.existsSync(configPath)) {
			throw new Error(
				`Target has nazare.config.yml without nazare.lock.yml: ${configPath}`,
			);
		}

		fs.writeFileSync(configPath, renderRegistryYaml(options.registry), {
			flag: "wx",
		});
		createdConfig = true;
		fs.writeFileSync(lockPath, renderLockYaml(options.registry), {
			flag: "wx",
		});
	} catch (error) {
		if (createdConfig) {
			try {
				fs.rmSync(configPath);
			} catch {
				// Keep original write failure visible.
			}
		}
		process.stderr.write(`nazare init error: ${error.message}\n`);
		return 1;
	}

	process.stdout.write(`Created ${configPath}\nCreated ${lockPath}\n`);
	return 0;
}

async function selfUpdate(_options, selectedRef, registryRepo) {
	let metadata;
	try {
		metadata = sourceMetadata(readInstallMetadata(), selectedRef, registryRepo);
		await verifyPackageVersionForTag(metadata);
	} catch (error) {
		process.stderr.write(`nazare update error: ${error.message}\n`);
		return 1;
	}

	const envPrefix = [
		["NAZARE_INSTALL_DIR", getInstallDir()],
		["NAZARE_CLI_URL", metadata.cliUrl],
		["NAZARE_PACKAGE_URL", metadata.packageUrl],
		["NAZARE_INSTALL_REF", metadata.installedRef],
		["NAZARE_INSTALL_SCRIPT_URL", metadata.installScriptUrl],
	]
		.map(([key, value]) => `${key}=${shellQuote(value)}`)
		.join(" ");
	const command = `curl -fsSL ${shellQuote(metadata.installScriptUrl)} | ${envPrefix} sh`;
	const result = spawnSync("sh", ["-c", command], {
		stdio: "inherit",
		env: process.env,
	});

	if (result.error) {
		process.stderr.write(`nazare update error: ${result.error.message}\n`);
		return 1;
	}

	return result.status === null ? 1 : result.status;
}

async function update(args) {
	let options;
	try {
		options = parseUpdateArgs(args);
	} catch (error) {
		process.stderr.write(`nazare update error: ${error.message}\n`);
		return 1;
	}

	let selectedRef;
	let registryRepo;
	try {
		if (options.latest) {
			const configPath = path.join(process.cwd(), "nazare.config.yml");
			if (fs.existsSync(configPath)) {
				const { registry } = readProjectState(process.cwd());
				registryRepo = registry.repo;
			}
		}
		selectedRef = await resolveUpdateRef(options, registryRepo);
	} catch (error) {
		process.stderr.write(`nazare update error: ${error.message}\n`);
		return 1;
	}

	if (options.target === "self") return selfUpdate(options, selectedRef, registryRepo);
	if (options.target === "theme") return themeUpdate(options, selectedRef);
	return updateComponent(options, selectedRef);
}

async function main(argv) {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(HELP);
		return 0;
	}

	if (argv[0] === "--version" || argv[0] === "-v") {
		return printVersion();
	}

	const [command, subcommand, ...rest] = argv;

	if (command === "init") {
		return initTheme(argv.slice(1));
	}

	if (command === "list") {
		return listComponents(argv.slice(1));
	}

	if (command === "add") {
		return addComponent(argv.slice(1));
	}

	if (command === "remove") {
		return removeComponent(argv.slice(1));
	}

	if (command === "update") {
		return update(argv.slice(1));
	}

	if (command === "theme" && subcommand === "pull") {
		return themePull(rest);
	}

	process.stderr.write(
		`Unknown command: ${command}\nRun \`nazare --help\` for usage.\n`,
	);
	return 1;
}

if (require.main === module) {
	main(process.argv.slice(2))
		.then((exitCode) => {
			process.exitCode = exitCode;
		})
		.catch((error) => {
			process.stderr.write(`nazare error: ${error.message}\n`);
			process.exitCode = 1;
		});
}

module.exports = {
	isValidComponentId,
	parseComponentManifest,
	parseInstalledComponents,
	validateComponentMetadata,
	validateInstalledComponentMetadata,
	parseRemoveArgs,
	removeComponent,
};
