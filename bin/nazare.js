#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HELP = `Nazare CLI

Usage:
  nazare --help
  nazare --version
  nazare init [name]
  nazare self update

Commands:
  init [name]    Initialize Nazare relationship in a theme repo (not implemented yet)
  self update    Update the Nazare CLI install from its original source

Options:
  -h, --help     Show this help
  -v, --version  Show CLI version
`;

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

function selfUpdate() {
	let metadata;
	try {
		metadata = readInstallMetadata();
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

function main(argv) {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(HELP);
		return 0;
	}

	if (argv.includes("--version") || argv.includes("-v")) {
		return printVersion();
	}

	const [command, subcommand] = argv;

	if (command === "self" && subcommand === "update") {
		return selfUpdate();
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

process.exitCode = main(process.argv.slice(2));
