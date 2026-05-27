import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../../../bin/nazare.js", import.meta.url);
const tempRoots = [];
const checksum = "a".repeat(64);

async function makeTempDir(prefix = "nazare-component-list-test-") {
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

async function writeRegistry(root, componentsSource) {
	await writeFile(
		join(root, "nazare.registry.yml"),
		`schemaVersion: 1

registry:
  name: nazare

components:${componentsSource}
`,
	);
}

function componentSource(id, type, to, dependencies = "[]") {
	return `
  ${id}:
    version: 1.0.0
    type: ${type}
    dependencies: ${dependencies}
    files:
      - from: components/${id}/${to.split("/").at(-1)}
        to: ${to}
        checksum:
          algorithm: sha256
          value: ${checksum}`;
}

async function initProject(cwd) {
	const result = await runCli(["init"], { cwd });
	expect(result).toMatchObject({ code: 0, stderr: "" });
}

async function writeLock(cwd, componentsSource) {
	await writeFile(
		join(cwd, "nazare.lock.yml"),
		`schemaVersion: 1

registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: refs/heads/main
  manifest: nazare.registry.yml

components:${componentsSource}
`,
	);
}

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("nazare list", () => {
	it("prints registry components in stable table order with installed status", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource("s-hero", "section", "sections/s-hero.liquid")}${componentSource("c-button", "snippet", "snippets/c-button.liquid")}`,
		);
		await writeLock(
			cwd,
			`
  s-hero:
    version: 1.0.0
    type: section
    installedAt: "2026-05-26T00:00:00.000Z"
    updatedAt: "2026-05-26T00:00:00.000Z"
    dependencies: []
    files:
      - path: sections/s-hero.liquid
        source: components/s-hero/s-hero.liquid
        checksum:
          algorithm: sha256
          value: ${checksum}`,
		);

		const result = await runCli(["list"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toBe(`Available components:

ID        Type     Version  Status
c-button  snippet  1.0.0    not installed
s-hero    section  1.0.0    installed
`);
	});

	it("prints no-components message for empty registry", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, " {}");

		const result = await runCli(["list"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({
			code: 0,
			stderr: "",
			stdout: "No components available in registry.\n",
		});
	});

	it("lists only lockfile components with --installed and does not fetch registry", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);
		await writeLock(
			cwd,
			`
  s-hero:
    version: 1.0.0
    type: section
    dependencies: []`,
		);

		const result = await runCli(["list", "--installed"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: join(cwd, "missing-registry") },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toBe(`Installed components:

ID      Type     Version
s-hero  section  1.0.0
`);
	});

	it("prints no-installed message for empty lockfile", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["list", "--installed"], { cwd });

		expect(result).toMatchObject({
			code: 0,
			stderr: "",
			stdout: "No components installed.\n",
		});
	});

	it("fails before output for invalid registry metadata", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`
  button:
    version: no
    type: snippet
    dependencies: []
    files: []`,
		);

		const result = await runCli(["list"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("nazare list error");
	});

	it("fails before output when repo is not initialized", async () => {
		const cwd = await makeTempDir();
		const result = await runCli(["list"], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("nazare.config.yml");
	});

	it("fails clearly for unknown args", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["list", "--available"], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("Unknown list option: --available");
	});

	it("does not mutate files or lockfile", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			componentSource("c-button", "snippet", "snippets/c-button.liquid"),
		);
		await writeFile(join(cwd, "local.txt"), "keep\n");
		const lockBefore = await readFile(join(cwd, "nazare.lock.yml"), "utf8");

		const result = await runCli(["list"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).toBe(0);
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toBe(
			lockBefore,
		);
		expect(await readFile(join(cwd, "local.txt"), "utf8")).toBe("keep\n");
	});
});
