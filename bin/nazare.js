#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const HELP = `Nazare CLI

Usage:
  nazare --help
  nazare --version
  nazare init [name]
  nazare self update [latest|--source <ref>]

Commands:
  init [name]    Initialize Nazare relationship in a theme repo (not implemented yet)
  self update    Update the Nazare CLI install from its original source, latest release, or --source override

Options:
  -h, --help          Show this help
  -v, --version       Show CLI version
  --source <ref>      Update from a branch, tag, full ref, or commit SHA
`;

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const TAG_PATTERN =
	/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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
		process.stderr.write(
			"nazare init is not implemented yet. Run `nazare --help` for available commands.\n",
		);
		return 1;
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
