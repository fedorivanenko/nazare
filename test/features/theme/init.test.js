import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../../../bin/nazare.js", import.meta.url);
const tempRoots = [];

const defaultConfig = `schemaVersion: 1

registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: refs/heads/main
  manifest: nazare.registry.yml
`;

const defaultLock = `schemaVersion: 1

registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: refs/heads/main
  manifest: nazare.registry.yml

components: {}
`;

function configFor({
	repo = "github.com/fedorivanenko/nazare",
	ref = "refs/heads/main",
} = {}) {
	return `schemaVersion: 1

registry:
  name: nazare
  repo: ${repo}
  ref: ${ref}
  manifest: nazare.registry.yml
`;
}

function lockFor(registry) {
	return `${configFor(registry)}
components: {}
`;
}

async function makeTempDir() {
	const tempRoot = await mkdtemp(join(tmpdir(), "nazare-init-test-"));
	tempRoots.push(tempRoot);
	return tempRoot;
}

async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function runCli(args, options = {}) {
	try {
		const { stdout, stderr } = await execFileAsync(
			process.execPath,
			[cliPath.pathname, ...args],
			{
				cwd: options.cwd,
				encoding: "utf8",
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

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("nazare init", () => {
	it("creates config and lockfile in current directory with default registry metadata", async () => {
		const cwd = await makeTempDir();
		const result = await runCli(["init"], { cwd });

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("nazare.config.yml");
		expect(result.stdout).toContain("nazare.lock.yml");
		expect(await readFile(join(cwd, "nazare.config.yml"), "utf8")).toBe(
			defaultConfig,
		);
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toBe(
			defaultLock,
		);
	});

	it("writes custom registry repo and ref metadata", async () => {
		const cwd = await makeTempDir();
		const registry = {
			repo: "https://github.com/acme/theme-registry.git",
			ref: "v1.2.3",
		};
		const result = await runCli(
			["init", "--repo", registry.repo, "--ref", registry.ref],
			{ cwd },
		);

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(cwd, "nazare.config.yml"), "utf8")).toBe(
			configFor(registry),
		);
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toBe(
			lockFor(registry),
		);
	});

	it("creates a target directory and writes initial files there", async () => {
		const cwd = await makeTempDir();
		const result = await runCli(["init", "my-theme"], { cwd });
		const target = join(cwd, "my-theme");

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(target, "nazare.config.yml"), "utf8")).toBe(
			defaultConfig,
		);
		expect(await readFile(join(target, "nazare.lock.yml"), "utf8")).toBe(
			defaultLock,
		);
	});

	it.each([
		"nested/theme",
		"nested\\theme",
	])("rejects target directory with path separator: %s", async (directory) => {
		const cwd = await makeTempDir();
		const result = await runCli(["init", directory], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("directory");
		expect(await pathExists(join(cwd, "nazare.config.yml"))).toBe(false);
		expect(await pathExists(join(cwd, "nazare.lock.yml"))).toBe(false);
	});

	it.each([
		["missing repo", ["--repo"], "--repo"],
		["invalid repo", ["--repo", "not-github/repo"], "repo"],
		["missing ref", ["--ref"], "--ref"],
		["empty ref", ["--ref", ""], "--ref"],
	])("rejects %s", async (_label, args, message) => {
		const cwd = await makeTempDir();
		const result = await runCli(["init", ...args], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(message);
		expect(await pathExists(join(cwd, "nazare.config.yml"))).toBe(false);
		expect(await pathExists(join(cwd, "nazare.lock.yml"))).toBe(false);
	});

	it("fails when lockfile exists and preserves existing files", async () => {
		const cwd = await makeTempDir();
		await writeFile(join(cwd, "nazare.lock.yml"), "existing lock\n");
		await writeFile(join(cwd, "theme.liquid"), "existing theme\n");
		const result = await runCli(["init"], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("nazare.lock.yml");
		expect(await readFile(join(cwd, "nazare.lock.yml"), "utf8")).toBe(
			"existing lock\n",
		);
		expect(await readFile(join(cwd, "theme.liquid"), "utf8")).toBe(
			"existing theme\n",
		);
		expect(await pathExists(join(cwd, "nazare.config.yml"))).toBe(false);
	});

	it("fails when config exists without lockfile and preserves existing files", async () => {
		const cwd = await makeTempDir();
		await writeFile(join(cwd, "nazare.config.yml"), "existing config\n");
		await mkdir(join(cwd, "sections"));
		await writeFile(join(cwd, "sections", "hero.liquid"), "existing section\n");
		const result = await runCli(["init"], { cwd });

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("nazare.config.yml");
		expect(await readFile(join(cwd, "nazare.config.yml"), "utf8")).toBe(
			"existing config\n",
		);
		expect(await readFile(join(cwd, "sections", "hero.liquid"), "utf8")).toBe(
			"existing section\n",
		);
		expect(await pathExists(join(cwd, "nazare.lock.yml"))).toBe(false);
	});
});
