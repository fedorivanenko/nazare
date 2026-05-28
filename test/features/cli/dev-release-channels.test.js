import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL(
	"../../../packages/nazare/bin/nazare.js",
	import.meta.url,
);
const tempRoots = [];

async function makeTempDir(prefix = "nazare-dev-release-test-") {
	const root = await mkdtemp(join(tmpdir(), prefix));
	tempRoots.push(root);
	return root;
}

async function runCli(args, options = {}) {
	try {
		const { stdout, stderr } = await execFileAsync(
			process.execPath,
			[cliPath.pathname, ...args],
			{
				cwd: options.cwd,
				encoding: "utf8",
				env: { ...process.env, ...options.env },
			},
		);
		return { code: 0, stdout, stderr };
	} catch (error) {
		return {
			code: error.code,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
		};
	}
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

async function writeFakeInstall(root) {
	const installDir = join(root, "install");
	const binDir = join(root, "bin");
	await mkdir(installDir, { recursive: true });
	await mkdir(binDir, { recursive: true });
	await writeFile(
		join(installDir, "package.json"),
		JSON.stringify({ version: "0.14.0" }),
	);
	await writeFile(
		join(installDir, "nazare.install.json"),
		JSON.stringify({
			version: "0.14.0",
			installedRef: "v0.14.0",
			cliUrl:
				"https://raw.githubusercontent.com/fedorivanenko/nazare/v0.14.0/packages/nazare/bin/nazare.js",
			packageUrl:
				"https://raw.githubusercontent.com/fedorivanenko/nazare/v0.14.0/packages/nazare/package.json",
			installScriptUrl:
				"https://raw.githubusercontent.com/fedorivanenko/nazare/v0.14.0/install.sh",
		}),
	);
	await writeFile(
		join(binDir, "curl"),
		`#!/bin/sh
cat <<'SH'
cat > "$NAZARE_INSTALL_DIR/nazare.install.json" <<EOF
{"version":"\${NAZARE_INSTALL_REF#v}","installedRef":"$NAZARE_INSTALL_REF","cliUrl":"$NAZARE_CLI_URL","packageUrl":"$NAZARE_PACKAGE_URL","installScriptUrl":"$NAZARE_INSTALL_SCRIPT_URL"}
EOF
SH
`,
	);
	await chmod(join(binDir, "curl"), 0o755);
	return { installDir, binDir };
}

async function writeRegistry(root, files) {
	const entries = [];
	for (const [filePath, content] of Object.entries(files)) {
		await mkdir(
			join(
				root,
				"theme",
				"default",
				filePath.split("/").slice(0, -1).join("/"),
			),
			{
				recursive: true,
			},
		);
		await writeFile(join(root, "theme", "default", filePath), content);
		entries.push(
			`    - from: theme/default/${filePath}\n      to: ${filePath}\n      checksum:\n        algorithm: sha256\n        value: ${sha256(content)}`,
		);
	}

	await writeFile(
		join(root, "nazare.registry.yml"),
		`schemaVersion: 1

registry:
  name: nazare

theme:
  version: 1.0.0
  source: theme/default
  files:
${entries.join("\n")}

components: {}
`,
	);
}

async function initAndPull(cwd, registry) {
	await runCli(["init"], { cwd });
	return runCli(["theme", "pull", "--yes"], {
		cwd,
		env: { NAZARE_REGISTRY_DIR: registry },
	});
}

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("dev release channels", () => {
	it("self update latest stores a stable resolved tag", async () => {
		const root = await makeTempDir();
		const { installDir, binDir } = await writeFakeInstall(root);

		const result = await runCli(["update", "self", "--latest"], {
			env: {
				NAZARE_INSTALL_DIR: installDir,
				NAZARE_GITHUB_TAGS_JSON: JSON.stringify(["v0.14.1-dev.3", "v0.14.0"]),
				NAZARE_TAG_PACKAGE_VERSIONS_JSON: JSON.stringify({
					"v0.14.0": "0.14.0",
				}),
				PATH: `${binDir}:${process.env.PATH}`,
			},
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(installDir, "nazare.install.json"), "utf8"),
		).toContain('"installedRef":"v0.14.0"');
	}, 10000);

	it("self update latest --dev stores a dev resolved tag", async () => {
		const root = await makeTempDir();
		const { installDir, binDir } = await writeFakeInstall(root);

		const result = await runCli(["update", "self", "--latest", "--dev"], {
			env: {
				NAZARE_INSTALL_DIR: installDir,
				NAZARE_GITHUB_TAGS_JSON: JSON.stringify([
					"v0.14.1-dev.3",
					"v0.15.0-dev.0",
					"v0.14.0",
				]),
				NAZARE_TAG_PACKAGE_VERSIONS_JSON: JSON.stringify({
					"v0.15.0-dev.0": "0.15.0-dev.0",
				}),
				PATH: `${binDir}:${process.env.PATH}`,
			},
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(installDir, "nazare.install.json"), "utf8"),
		).toContain('"installedRef":"v0.15.0-dev.0"');
	}, 10000);

	it("self update rejects a tag whose package version differs", async () => {
		const root = await makeTempDir();
		const { installDir, binDir } = await writeFakeInstall(root);

		const result = await runCli(["update", "self", "--latest", "--dev"], {
			env: {
				NAZARE_INSTALL_DIR: installDir,
				NAZARE_GITHUB_TAGS_JSON: JSON.stringify(["v0.15.0-dev.0"]),
				NAZARE_TAG_PACKAGE_VERSIONS_JSON: JSON.stringify({
					"v0.15.0-dev.0": "0.14.0",
				}),
				PATH: `${binDir}:${process.env.PATH}`,
			},
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Tag/package version mismatch");
		expect(
			await readFile(join(installDir, "nazare.install.json"), "utf8"),
		).toContain('"installedRef":"v0.14.0"');
	}, 10000);

	it("update theme --latest advances registry ref to stable tag", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });
		await initAndPull(cwd, registry);

		const result = await runCli(["update", "theme", "--latest"], {
			cwd,
			env: {
				NAZARE_REGISTRY_DIR: registry,
				NAZARE_GITHUB_TAGS_JSON: JSON.stringify([
					"v0.14.1-dev.3",
					"v0.14.0",
					"v0.13.9",
				]),
			},
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(cwd, "nazare.config.yml"), "utf8")).toContain(
			"ref: v0.14.0",
		);
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toContain(
			"ref: v0.14.0",
		);
	}, 10000);

	it("update theme --latest --dev advances registry ref to dev tag", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });
		await initAndPull(cwd, registry);

		const result = await runCli(["update", "theme", "--latest", "--dev"], {
			cwd,
			env: {
				NAZARE_REGISTRY_DIR: registry,
				NAZARE_GITHUB_TAGS_JSON: JSON.stringify([
					"v0.14.1-dev.3",
					"v0.15.0-dev.0",
					"v0.14.0",
				]),
			},
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(cwd, "nazare.config.yml"), "utf8")).toContain(
			"ref: v0.15.0-dev.0",
		);
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toContain(
			"ref: v0.15.0-dev.0",
		);
	}, 10000);

	it("update theme --ref preserves component lockfile metadata", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });
		await initAndPull(cwd, registry);
		const lockPath = join(cwd, "nazare.lock.yml");
		const componentBlock = `components:
  c-button:
    version: 1.0.0
    type: snippet
    installedAt: "2026-05-26T00:00:00.000Z"
    updatedAt: "2026-05-26T00:00:00.000Z"
    dependencies: []
    files: []`;
		await writeFile(
			lockPath,
			(await readFile(lockPath, "utf8")).replace(
				"components: {}",
				componentBlock,
			),
		);

		const result = await runCli(["update", "theme", "--ref", "v0.14.1-dev.3"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(cwd, "nazare.config.yml"), "utf8")).toContain(
			"ref: v0.14.1-dev.3",
		);
		expect(await readFile(lockPath, "utf8")).toContain("ref: v0.14.1-dev.3");
		expect(await readFile(lockPath, "utf8")).toContain("c-button:");
	}, 10000);

	it("failed update theme --latest leaves files unchanged", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });
		await initAndPull(cwd, registry);
		const configBefore = await readFile(join(cwd, "nazare.config.yml"), "utf8");
		const lockBefore = await readFile(join(cwd, "nazare.lock.yml"), "utf8");

		const result = await runCli(["update", "theme", "--latest", "--dev"], {
			cwd,
			env: {
				NAZARE_REGISTRY_DIR: registry,
				NAZARE_GITHUB_TAGS_JSON: JSON.stringify(["v0.14.0"]),
			},
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("No dev release tags found");
		expect(await readFile(join(cwd, "nazare.config.yml"), "utf8")).toBe(
			configBefore,
		);
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toBe(
			lockBefore,
		);
	}, 10000);
});
