import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../../../bin/nazare.js", import.meta.url);
const tempRoots = [];

async function makeTempDir(prefix = "nazare-component-update-test-") {
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

async function runCliInteractive(args, input, options = {}) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [cliPath.pathname, ...args], {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(input);
	});
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
	version = "1.0.0",
	type = "snippet",
	to = "snippets/c-button.liquid",
	content = "button\n",
	dependencies = [],
	checksum = sha256(content),
} = {}) {
	const renderedDependencies =
		dependencies.length === 0
			? "[]"
			: `\n${dependencies.map((dependency) => `      - ${dependency}`).join("\n")}`;
	return `
  ${id}:
    version: ${version}
    type: ${type}
    dependencies: ${renderedDependencies}
    files:
      - from: components/${id}/${to.split("/").at(-1)}
        to: ${to}
        checksum:
          algorithm: sha256
          value: ${checksum}`;
}

async function installComponent(
	cwd,
	registry,
	source = componentSource(),
	content = "button\n",
) {
	await writeRegistry(registry, source, {
		"components/c-button/c-button.liquid": content,
	});
	const result = await runCli(["add", "c-button"], {
		cwd,
		env: { NAZARE_REGISTRY_DIR: registry },
	});
	expect(result).toMatchObject({ code: 0, stderr: "" });
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

describe("nazare update", () => {
	it("prompts before overwriting existing installed component files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeRegistry(
			registry,
			componentSource({ version: "1.1.0", content: "new\n" }),
			{ "components/c-button/c-button.liquid": "new\n" },
		);

		const result = await runCliInteractive(["update", "c-button"], "y\n", {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry, NAZARE_TEST_INTERACTIVE: "1" },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("c-button 1.0.0 -> 1.1.0");
		expect(result.stdout).toContain("snippets/c-button.liquid exists locally.");
		expect(result.stdout).toContain("Overwrite with registry version? [y/N/m]");
		expect(result.stdout).toContain("Wrote snippets/c-button.liquid");
		expect(result.stdout).toContain("Done.");
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("new\n");
		const lock = await readLock(cwd);
		expect(lock).toContain("version: 1.1.0");
		expect(lock).toContain(`value: ${sha256("new\n")}`);
	});

	it("updates stale dependencies before requested component", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource({ id: "c-core", to: "snippets/c-core.liquid", content: "core old\n" })}${componentSource({ id: "c-card", to: "snippets/c-card.liquid", content: "card\n", dependencies: ["c-core"] })}`,
			{
				"components/c-core/c-core.liquid": "core old\n",
				"components/c-card/c-card.liquid": "card\n",
			},
		);
		await expect(
			runCli(["add", "c-card"], {
				cwd,
				env: { NAZARE_REGISTRY_DIR: registry },
			}),
		).resolves.toMatchObject({ code: 0, stderr: "" });
		await writeRegistry(
			registry,
			`${componentSource({ id: "c-core", version: "1.1.0", to: "snippets/c-core.liquid", content: "core new\n" })}${componentSource({ id: "c-card", to: "snippets/c-card.liquid", content: "card\n", dependencies: ["c-core"] })}`,
			{
				"components/c-core/c-core.liquid": "core new\n",
				"components/c-card/c-card.liquid": "card\n",
			},
		);

		const result = await runCliInteractive(["update", "c-card"], "y\n", {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry, NAZARE_TEST_INTERACTIVE: "1" },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("c-core 1.0.0 -> 1.1.0");
		expect(result.stdout).toContain("snippets/c-core.liquid exists locally.");
		expect(result.stdout).toContain("Overwrite with registry version? [y/N/m]");
		expect(result.stdout).toContain("Wrote snippets/c-core.liquid");
		expect(result.stdout).toContain("Done.");
		expect(await readFile(join(cwd, "snippets", "c-core.liquid"), "utf8")).toBe(
			"core new\n",
		);
		const lock = await readLock(cwd);
		expect(lock).toMatch(/c-core:\n {4}version: 1\.1\.0/);
		expect(lock).toMatch(/c-card:\n {4}version: 1\.0\.0/);
	});

	it("is a no-op for current untouched component", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["update", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toBe("Component already up to date: c-button\n");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("prints dry-run plan without mutating files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeRegistry(
			registry,
			componentSource({ version: "1.1.0", content: "new\n" }),
			{ "components/c-button/c-button.liquid": "new\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["update", "c-button", "--dry-run"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain(
			"Would prompt write snippets/c-button.liquid",
		);
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("button\n");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails in non-interactive mode before overwriting existing files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeRegistry(
			registry,
			componentSource({ version: "1.1.0", content: "new\n" }),
			{ "components/c-button/c-button.liquid": "new\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["update", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("interactive terminal or --force");
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("button\n");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("manual prompt writes conflict markers and leaves lockfile unchanged", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeFile(join(cwd, "snippets", "c-button.liquid"), "local\n");
		await writeRegistry(
			registry,
			componentSource({ version: "1.1.0", content: "new\n" }),
			{ "components/c-button/c-button.liquid": "new\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCliInteractive(["update", "c-button"], "m\n", {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry, NAZARE_TEST_INTERACTIVE: "1" },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain(
			"Wrote manual conflict markers to snippets/c-button.liquid.",
		);
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe(`<<<<<<< local
local
=======
new
>>>>>>> registry c-button@1.1.0
`);
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("manual prompt writes conflict markers only around changed lines", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeFile(
			join(cwd, "snippets", "c-button.liquid"),
			"before\nlocal\nafter\n",
		);
		await writeRegistry(
			registry,
			componentSource({
				version: "1.1.0",
				content: "before\nincoming\nafter\n",
			}),
			{ "components/c-button/c-button.liquid": "before\nincoming\nafter\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCliInteractive(["update", "c-button"], "m\n", {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry, NAZARE_TEST_INTERACTIVE: "1" },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe(
			[
				"before",
				"<<<<<<< local",
				"local",
				"=======",
				"incoming",
				">>>>>>> registry c-button@1.1.0",
				"after",
				"",
			].join("\n"),
		);
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("skip prompt leaves file and lockfile unchanged", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeFile(join(cwd, "snippets", "c-button.liquid"), "local\n");
		await writeRegistry(
			registry,
			componentSource({ version: "1.1.0", content: "new\n" }),
			{ "components/c-button/c-button.liquid": "new\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCliInteractive(["update", "c-button"], "n\n", {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry, NAZARE_TEST_INTERACTIVE: "1" },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain(
			"Skipped snippets/c-button.liquid; component not fully updated.",
		);
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("local\n");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("force overwrites touched files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeFile(join(cwd, "snippets", "c-button.liquid"), "local\n");
		await writeRegistry(
			registry,
			componentSource({ version: "1.1.0", content: "new\n" }),
			{ "components/c-button/c-button.liquid": "new\n" },
		);

		const result = await runCli(["update", "c-button", "--force"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("new\n");
		expect(await readLock(cwd)).toContain("version: 1.1.0");
	});

	it("force recreates missing installed files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await unlink(join(cwd, "snippets", "c-button.liquid"));
		await writeRegistry(
			registry,
			componentSource({ version: "1.1.0", content: "new\n" }),
			{ "components/c-button/c-button.liquid": "new\n" },
		);

		const result = await runCli(["update", "c-button", "--force"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("new\n");
	});

	it("deletes untouched files removed from registry", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeRegistry(
			registry,
			componentSource({
				version: "1.1.0",
				to: "snippets/c-button-new.liquid",
				content: "new\n",
			}),
			{ "components/c-button/c-button-new.liquid": "new\n" },
		);

		const result = await runCli(["update", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Deleted snippets/c-button.liquid");
		expect(result.stdout).toContain("Wrote snippets/c-button-new.liquid");
		expect(
			await readFile(join(cwd, "snippets", "c-button-new.liquid"), "utf8"),
		).toBe("new\n");
	});

	it("fails for untracked target path", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await installComponent(cwd, registry);
		await writeFile(join(cwd, "snippets", "c-button-new.liquid"), "local\n");
		await writeRegistry(
			registry,
			componentSource({
				version: "1.1.0",
				to: "snippets/c-button-new.liquid",
				content: "new\n",
			}),
			{ "components/c-button/c-button-new.liquid": "new\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["update", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("exists untracked");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails for component that is not installed", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});

		const result = await runCli(["update", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Component not installed");
		expect(result.stderr).toContain("run nazare add c-button");
	});
});
