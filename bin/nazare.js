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
  nazare self update [latest|--source <ref>]

Commands:
  init [directory]    Initialize Nazare relationship in a theme repo
  self update         Update the Nazare CLI install from its original source, latest release, or --source override

Options:
  -h, --help          Show this help
  -v, --version       Show CLI version
  --repo <repo>       Registry GitHub repo for init
  --ref <ref>         Registry ref for init
  --source <ref>      Update from a branch, tag, full ref, or commit SHA
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
