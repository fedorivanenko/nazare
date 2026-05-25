import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../bin/nazare.js", import.meta.url);
const tempRoots = [];

async function makeTempDir(prefix = "nazare-theme-update-test-") {
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
			`    - from: theme/default/${filePath}\n      to: ${filePath}`,
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

describe("nazare theme update", () => {
	it("updates unmodified tracked files and stores checksums", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "old layout\n" });
		await initAndPull(cwd, registry);
		await writeRegistry(registry, { "layout/theme.liquid": "new layout\n" });

		const result = await runCli(["theme", "update"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote layout/theme.liquid");
		expect(await readFile(join(cwd, "layout", "theme.liquid"), "utf8")).toBe(
			"new layout\n",
		);
		const lockfile = await readFile(join(cwd, "nazare.lock.yml"), "utf8");
		expect(lockfile).toContain("checksum:");
		expect(lockfile).toContain("updatedAt:");
	});

	it("bootstraps missing checksum metadata when local file matches registry", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });
		await initAndPull(cwd, registry);
		const lockPath = join(cwd, "nazare.lock.yml");
		await writeFile(
			lockPath,
			(await readFile(lockPath, "utf8")).replace(
				/\n {6}checksum:\n {8}algorithm: sha256\n {8}value: [0-9a-f]{64}/,
				"",
			),
		);

		const result = await runCli(["theme", "update", "--check"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain(
			"Would update metadata layout/theme.liquid",
		);

		const update = await runCli(["theme", "update"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(update).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(lockPath, "utf8")).toContain("checksum:");
	});

	it("untracks obsolete missing files without checksum metadata", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, {
			"layout/theme.liquid": "layout\n",
			"templates/old.json": "old\n",
		});
		await initAndPull(cwd, registry);
		await rm(join(cwd, "templates", "old.json"));
		const lockPath = join(cwd, "nazare.lock.yml");
		await writeFile(
			lockPath,
			(await readFile(lockPath, "utf8")).replace(
				/ {4}- path: templates\/old\.json\n {6}source: theme\/default\/templates\/old\.json\n {6}checksum:\n {8}algorithm: sha256\n {8}value: [0-9a-f]{64}\n/,
				"    - path: templates/old.json\n      source: theme/default/templates/old.json\n",
			),
		);
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });

		const result = await runCli(["theme", "update"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(lockPath, "utf8")).not.toContain(
			"templates/old.json",
		);
	});

	it("fails before mutation when tracked file is modified", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, {
			"layout/theme.liquid": "old layout\n",
			"templates/index.json": "old index\n",
		});
		await initAndPull(cwd, registry);
		await writeFile(join(cwd, "layout", "theme.liquid"), "user edit\n");
		await writeRegistry(registry, {
			"layout/theme.liquid": "new layout\n",
			"templates/index.json": "new index\n",
		});

		const result = await runCli(["theme", "update"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Modified installed theme file");
		expect(await readFile(join(cwd, "layout", "theme.liquid"), "utf8")).toBe(
			"user edit\n",
		);
		expect(await readFile(join(cwd, "templates", "index.json"), "utf8")).toBe(
			"old index\n",
		);
	});

	it("force overwrites modified tracked files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "old layout\n" });
		await initAndPull(cwd, registry);
		await writeFile(join(cwd, "layout", "theme.liquid"), "user edit\n");
		await writeRegistry(registry, { "layout/theme.liquid": "new layout\n" });

		const result = await runCli(["theme", "update", "--force"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(cwd, "layout", "theme.liquid"), "utf8")).toBe(
			"new layout\n",
		);
	});

	it("force restores missing current tracked files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });
		await initAndPull(cwd, registry);
		await rm(join(cwd, "layout", "theme.liquid"));

		const result = await runCli(["theme", "update", "--force"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(cwd, "layout", "theme.liquid"), "utf8")).toBe(
			"layout\n",
		);
	});

	it("deletes obsolete unmodified tracked files", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, {
			"layout/theme.liquid": "layout\n",
			"templates/old.json": "old\n",
		});
		await initAndPull(cwd, registry);
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });

		const result = await runCli(["theme", "update"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Deleted templates/old.json");
		await expect(
			readFile(join(cwd, "templates", "old.json"), "utf8"),
		).rejects.toThrow();
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).not.toContain(
			"templates/old.json",
		);
	});

	it("fails before mutation when obsolete tracked file is modified", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, {
			"layout/theme.liquid": "layout\n",
			"templates/old.json": "old\n",
		});
		await initAndPull(cwd, registry);
		await writeFile(join(cwd, "templates", "old.json"), "user edit\n");
		await writeRegistry(registry, { "layout/theme.liquid": "new layout\n" });

		const result = await runCli(["theme", "update"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Modified obsolete theme file");
		expect(await readFile(join(cwd, "templates", "old.json"), "utf8")).toBe(
			"user edit\n",
		);
		expect(await readFile(join(cwd, "layout", "theme.liquid"), "utf8")).toBe(
			"layout\n",
		);
	});

	it("fails on untracked existing new manifest target unless forced", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "layout\n" });
		await initAndPull(cwd, registry);
		await mkdir(join(cwd, "sections"));
		await writeFile(join(cwd, "sections", "new.liquid"), "user file\n");
		await writeRegistry(registry, {
			"layout/theme.liquid": "layout\n",
			"sections/new.liquid": "registry file\n",
		});

		const result = await runCli(["theme", "update"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Untracked theme file target exists");
		expect(await readFile(join(cwd, "sections", "new.liquid"), "utf8")).toBe(
			"user file\n",
		);

		const forced = await runCli(["theme", "update", "--force"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(forced).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(cwd, "sections", "new.liquid"), "utf8")).toBe(
			"registry file\n",
		);
	});

	it("check reports plan without mutation", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await writeRegistry(registry, { "layout/theme.liquid": "old layout\n" });
		await initAndPull(cwd, registry);
		const beforeLock = await readFile(join(cwd, "nazare.lock.yml"), "utf8");
		await writeRegistry(registry, { "layout/theme.liquid": "new layout\n" });

		const result = await runCli(["theme", "update", "--check"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Would write layout/theme.liquid");
		expect(await readFile(join(cwd, "layout", "theme.liquid"), "utf8")).toBe(
			"old layout\n",
		);
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toBe(
			beforeLock,
		);
	});
});
