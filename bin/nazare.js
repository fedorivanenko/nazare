#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const HELP = `Nazare CLI

Usage:
  nazare --help
  nazare --version
  nazare init [directory] [--repo <repo>] [--ref <ref>]
  nazare theme pull [--yes]
  nazare self update [latest|--source <ref>]

Commands:
  init [directory]    Initialize Nazare relationship in a theme repo
  theme pull          Pull registry theme scaffold into an initialized theme repo
  self update         Update the Nazare CLI install from its original source, latest release, or --source override

Options:
  -h, --help          Show this help
  -v, --version       Show CLI version
  --repo <repo>       Registry GitHub repo for init
  --ref <ref>         Registry ref for init
  --source <ref>      Update from a branch, tag, full ref, or commit SHA
  --yes               Overwrite theme file conflicts without prompting
`;

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const TAG_PATTERN =
	/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
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
		const request = https.get(
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

async function resolveLatestReleaseRef() {
	const release = await fetchJson(
		"https://api.github.com/repos/fedorivanenko/nazare/releases/latest",
	);

	if (
		typeof release.tag_name !== "string" ||
		!TAG_PATTERN.test(release.tag_name)
	) {
		throw new Error("GitHub latest release has no valid SemVer tag");
	}

	return release.tag_name;
}

async function parseSelfUpdateArgs(args) {
	const options = { source: undefined };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (arg === "latest") {
			if (options.source) {
				throw new Error("Use either latest or --source, not both");
			}
			options.source = await resolveLatestReleaseRef();
			continue;
		}

		if (arg === "--source") {
			if (options.source) {
				throw new Error("Use either latest or --source, not both");
			}
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("Missing value for --source");
			}
			options.source = normalizeSourceRef(value);
			index += 1;
			continue;
		}

		throw new Error(`Unknown self update option: ${arg}`);
	}

	return options;
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

function sourceMetadata(metadata, installedRef) {
	if (!installedRef) {
		return metadata;
	}

	return {
		...metadata,
		installedRef,
		installScriptUrl: `https://raw.githubusercontent.com/fedorivanenko/nazare/${installedRef}/install.sh`,
		cliUrl: `https://raw.githubusercontent.com/fedorivanenko/nazare/${installedRef}/bin/nazare.js`,
		packageUrl: `https://raw.githubusercontent.com/fedorivanenko/nazare/${installedRef}/package.json`,
	};
}

function isValidRegistryRepo(repo) {
	return typeof repo === "string" && GITHUB_REPO_PATTERN.test(repo);
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

function ensureSafeThemeFiles(theme) {
	const seenTargets = new Set();

	for (const file of theme.files) {
		if (!isSafeRelativePath(file.from)) {
			throw new Error(`Unsafe theme file source path: ${file.from}`);
		}
		if (!isSafeRelativePath(file.to)) {
			throw new Error(`Unsafe theme file target path: ${file.to}`);
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

function registryRawUrl(registry, filePath) {
	return `https://raw.githubusercontent.com/${githubRepoSlug(registry.repo)}/${registry.ref}/${filePath}`;
}

function resolveRegistryRoot() {
	if (process.env.NAZARE_REGISTRY_DIR) {
		return path.resolve(process.env.NAZARE_REGISTRY_DIR);
	}

	return getInstallDir();
}

async function readRegistryFile(registry, registryRoot, filePath) {
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

function existingLockThemeFiles(lockSource) {
	const files = [];
	const themeFilesMatch = lockSource.match(
		/\ntheme:\n[\s\S]*?\n\s+files:\n([\s\S]*?)(?:\n\S|$)/,
	);
	if (!themeFilesMatch) return files;

	let current;
	for (const line of themeFilesMatch[1].split("\n")) {
		const pathMatch = line.match(/^\s*-\s+path:\s*(.+)$/);
		const sourceMatch = line.match(/^\s+source:\s*(.+)$/);
		if (pathMatch) {
			current = { path: pathMatch[1].trim() };
			files.push(current);
			continue;
		}
		if (sourceMatch && current) {
			current.source = sourceMatch[1].trim();
		}
	}

	return files.filter((file) => file.path && file.source);
}

function renderThemeLockYaml(registry, theme, writtenFiles, existingFiles) {
	const merged = new Map(existingFiles.map((file) => [file.path, file]));
	for (const file of writtenFiles) {
		merged.set(file.to, { path: file.to, source: file.from });
	}

	const renderedFiles = [...merged.values()]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((file) => `    - path: ${file.path}\n      source: ${file.source}`)
		.join("\n");

	return `${renderRegistryYaml(registry)}
components: {}

theme:
  version: ${theme.version}
  source: ${theme.source}
  installedAt: "${new Date().toISOString()}"
  files:
${renderedFiles}
`;
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
		const registryRoot = resolveRegistryRoot();
		const manifest = await readRegistryFile(
			registry,
			registryRoot,
			registry.manifest,
		);
		const theme = parseThemeManifest(manifest.toString("utf8"));
		ensureSafeThemeFiles(theme);

		const conflicts = theme.files.filter((file) =>
			fs.existsSync(path.join(cwd, file.to)),
		);
		if (conflicts.length > 0 && !options.yes) {
			throw new Error(
				`Theme file conflicts require --yes: ${conflicts.map((file) => file.to).join(", ")}`,
			);
		}

		const sources = new Map();
		for (const file of theme.files) {
			try {
				sources.set(
					file.from,
					await readRegistryFile(registry, registryRoot, file.from),
				);
			} catch {
				throw new Error(`Missing theme file source: ${file.from}`);
			}
		}

		const writtenFiles = [];
		for (const file of theme.files) {
			const targetPath = path.join(cwd, file.to);
			if (fs.existsSync(targetPath) && !options.yes) continue;
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.writeFileSync(targetPath, sources.get(file.from));
			writtenFiles.push(file);
			process.stdout.write(`Wrote ${file.to}\n`);
		}

		if (writtenFiles.length > 0) {
			fs.writeFileSync(
				lockPath,
				renderThemeLockYaml(
					registry,
					theme,
					writtenFiles,
					existingLockThemeFiles(lockSource),
				),
			);
		}

		return 0;
	} catch (error) {
		process.stderr.write(`nazare theme pull error: ${error.message}\n`);
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

async function selfUpdate(args) {
	let options;
	let metadata;
	try {
		options = await parseSelfUpdateArgs(args);
		metadata = sourceMetadata(readInstallMetadata(), options.source);
	} catch (error) {
		process.stderr.write(`nazare self update error: ${error.message}\n`);
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
		process.stderr.write(`nazare self update error: ${result.error.message}\n`);
		return 1;
	}

	return result.status === null ? 1 : result.status;
}

async function main(argv) {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(HELP);
		return 0;
	}

	if (argv.includes("--version") || argv.includes("-v")) {
		return printVersion();
	}

	const [command, subcommand, ...rest] = argv;

	if (command === "self" && subcommand === "update") {
		return selfUpdate(rest);
	}

	if (command === "init") {
		return initTheme(argv.slice(1));
	}

	if (command === "theme" && subcommand === "pull") {
		return themePull(rest);
	}

	process.stderr.write(
		`Unknown command: ${command}\nRun \`nazare --help\` for usage.\n`,
	);
	return 1;
}

main(process.argv.slice(2))
	.then((exitCode) => {
		process.exitCode = exitCode;
	})
	.catch((error) => {
		process.stderr.write(`nazare error: ${error.message}\n`);
		process.exitCode = 1;
	});
