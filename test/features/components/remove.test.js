import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
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

async function makeTempDir(prefix = "nazare-remove-test-") {
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

async function initProject(cwd) {
	const result = await runCli(["init"], { cwd });
	expect(result).toMatchObject({ code: 0, stderr: "" });
}

async function writeRegistry(root, componentsSource, files = {}) {
	await writeFile(
		join(root, "nazare.registry.yml"),
		`schemaVersion: 1

registry:
  name: nazare

components:${componentsSource}
`,
	);
	for (const [filePath, content] of Object.entries(files)) {
		const fullPath = join(root, filePath);
		await mkdir(join(fullPath, ".."), { recursive: true });
		await writeFile(fullPath, content);
	}
}

function componentSource({
	id = "c-button",
	type = "snippet",
	to = "snippets/c-button.liquid",
	content = "button\n",
	dependencies = [],
	checksum = sha256(content),
} = {}) {
	const renderedDependencies =
		dependencies.length === 0
			? "[]"
			: `\n${dependencies.map((d) => `      - ${d}`).join("\n")}`;
	return `
  ${id}:
    version: 1.0.0
    type: ${type}
    dependencies: ${renderedDependencies}
    files:
      - from: components/${id}/${to.split("/").at(-1)}
        to: ${to}
        checksum:
          algorithm: sha256
          value: ${checksum}`;
}

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readLock(cwd) {
	return readFile(join(cwd, "nazare.lock.yml"), "utf8");
}

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("nazare remove", () => {
	it("deletes unmodified files and removes lockfile entry", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		const result = await runCli(["remove", "c-button"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Deleted snippets/c-button.liquid");
		expect(result.stdout).toContain("Removed component: c-button");
		expect(await fileExists(join(cwd, "snippets", "c-button.liquid"))).toBe(false);
		const lock = await readLock(cwd);
		expect(lock).not.toContain("c-button:");
	});

	it("silently skips missing files and still removes lockfile entry", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		await rm(join(cwd, "snippets", "c-button.liquid"));

		const result = await runCli(["remove", "c-button"], { cwd });

		expect(result).toMatchObject({ code: 0 });
		expect(result.stdout).toContain("Removed component: c-button");
		const lock = await readLock(cwd);
		expect(lock).not.toContain("c-button:");
	});

	it("skips modified files with warning and still removes lockfile entry", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		await writeFile(join(cwd, "snippets", "c-button.liquid"), "edited\n");

		const result = await runCli(["remove", "c-button"], { cwd });

		expect(result).toMatchObject({ code: 0 });
		expect(result.stderr).toContain("Skipped snippets/c-button.liquid");
		expect(result.stdout).toContain("Removed component: c-button");
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("edited\n");
		const lock = await readLock(cwd);
		expect(lock).not.toContain("c-button:");
	});

	it("--force deletes modified files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		await writeFile(join(cwd, "snippets", "c-button.liquid"), "edited\n");

		const result = await runCli(["remove", "--force", "c-button"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Deleted snippets/c-button.liquid");
		expect(await fileExists(join(cwd, "snippets", "c-button.liquid"))).toBe(false);
		const lock = await readLock(cwd);
		expect(lock).not.toContain("c-button:");
	});

	it("--dry-run prints plan without mutating files or lockfile", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		const lockBefore = await readLock(cwd);

		const result = await runCli(["remove", "--dry-run", "c-button"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Would delete  snippets/c-button.liquid");
		expect(result.stdout).toContain("Would remove component: c-button");
		expect(await fileExists(join(cwd, "snippets", "c-button.liquid"))).toBe(true);
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("--dry-run reports modified files as skipped", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		await writeFile(join(cwd, "snippets", "c-button.liquid"), "edited\n");

		const result = await runCli(["remove", "--dry-run", "c-button"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Would skip    snippets/c-button.liquid (modified)");
	});

	it("--dry-run reports missing files as already gone", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		await rm(join(cwd, "snippets", "c-button.liquid"));

		const result = await runCli(["remove", "--dry-run", "c-button"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Already gone  snippets/c-button.liquid");
	});

	it("fails before mutation when component is not installed", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["remove", "c-missing"], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Component not installed");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails before mutation for invalid component ID", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["remove", "C-button"], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Invalid component ID");
	});

	it("fails in non-TTY when a dependent is installed", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource({ id: "c-base", to: "snippets/c-base.liquid", content: "base\n" })}${componentSource({ id: "c-card", to: "snippets/c-card.liquid", content: "card\n", dependencies: ["c-base"] })}`,
			{
				"components/c-base/c-base.liquid": "base\n",
				"components/c-card/c-card.liquid": "card\n",
			},
		);
		await runCli(["add", "c-card"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		const lockBefore = await readLock(cwd);

		const result = await runCli(["remove", "c-base"], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("c-card");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("--force removes component despite installed dependent", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource({ id: "c-base", to: "snippets/c-base.liquid", content: "base\n" })}${componentSource({ id: "c-card", to: "snippets/c-card.liquid", content: "card\n", dependencies: ["c-base"] })}`,
			{
				"components/c-base/c-base.liquid": "base\n",
				"components/c-card/c-card.liquid": "card\n",
			},
		);
		await runCli(["add", "c-card"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		const result = await runCli(["remove", "--force", "c-base"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Removed component: c-base");
		const lock = await readLock(cwd);
		expect(lock).not.toContain("  c-base:");
		expect(lock).toContain("c-card:");
	});

	it("only removes the target component's lockfile entry", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource({ id: "c-alpha", to: "snippets/c-alpha.liquid", content: "alpha\n" })}${componentSource({ id: "c-beta", to: "snippets/c-beta.liquid", content: "beta\n" })}`,
			{
				"components/c-alpha/c-alpha.liquid": "alpha\n",
				"components/c-beta/c-beta.liquid": "beta\n",
			},
		);
		await runCli(["add", "c-alpha"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		await runCli(["add", "c-beta"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		const result = await runCli(["remove", "c-alpha"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		const lock = await readLock(cwd);
		expect(lock).not.toContain("  c-alpha:");
		expect(lock).toContain("c-beta:");
		expect(await fileExists(join(cwd, "snippets", "c-beta.liquid"))).toBe(true);
	});
});
