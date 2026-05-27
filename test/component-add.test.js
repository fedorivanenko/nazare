import { execFile } from "node:child_process";
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
const cliPath = new URL("../bin/nazare.js", import.meta.url);
const registryRoot = new URL("../", import.meta.url).pathname;
const tempRoots = [];

async function makeTempDir(prefix = "nazare-component-add-test-") {
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
			: `\n${dependencies.map((dependency) => `      - ${dependency}`).join("\n")}`;
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

describe("nazare add", () => {
	it("installs committed s-announcement from local registry", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["add", "s-announcement"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registryRoot },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote sections/s-announcement.liquid");
		expect(result.stdout).toContain("Installed components: s-announcement");
		expect(
			await readFile(join(cwd, "sections", "s-announcement.liquid"), "utf8"),
		).toContain("assign announcement_text = section.settings.text");
		const lock = await readLock(cwd);
		expect(lock).toContain("s-announcement:");
		expect(lock).toContain("path: sections/s-announcement.liquid");
	});

	it("installs committed c-button from local registry", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registryRoot },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote snippets/c-button.liquid");
		expect(result.stdout).toContain("Installed components: c-button");
		const source = await readFile(
			join(cwd, "snippets", "c-button.liquid"),
			"utf8",
		);
		expect(source).toContain(
			"assign button_scheme = scheme | default: 'solid'",
		);
		expect(source).toContain("button_scheme == 'outline'");
		expect(source).toContain("button_scheme == 'ghost'");
		const lock = await readLock(cwd);
		expect(lock).toContain("c-button:");
		expect(lock).toContain("path: snippets/c-button.liquid");
	});

	it("installs committed c-video from local registry", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["add", "c-video"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registryRoot },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote snippets/c-video.liquid");
		expect(result.stdout).toContain("Wrote scripts/snippets/c-video.js");
		expect(result.stdout).toContain("Installed components: c-video");
		const snippet = await readFile(
			join(cwd, "snippets", "c-video.liquid"),
			"utf8",
		);
		expect(snippet).toContain('data-nazare-use="snippets/c-video"');
		expect(snippet).toContain("data-c-video-play");
		expect(snippet).toContain("data-c-video-mute");
		expect(snippet).toContain("if video_media != blank");
		const script = await readFile(
			join(cwd, "scripts", "snippets", "c-video.js"),
			"utf8",
		);
		expect(script).toContain("window.NazareVideoStore");
		expect(script).toContain("muteOthers(activeInstance)");
		expect(script).toContain("export function destroy(root)");
		const lock = await readLock(cwd);
		expect(lock).toContain("c-video:");
		expect(lock).toContain("path: snippets/c-video.liquid");
		expect(lock).toContain("path: scripts/snippets/c-video.js");
	});

	it("installs a component file and lockfile metadata", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote snippets/c-button.liquid");
		expect(result.stdout).toContain("Installed components: c-button");
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("button\n");
		const lock = await readLock(cwd);
		expect(lock).toContain("c-button:");
		expect(lock).toContain("path: snippets/c-button.liquid");
		expect(lock).toContain(`value: ${sha256("button\n")}`);
	});

	it("installs dependencies before requested component", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource({ id: "core", type: "package", to: "snippets/core.liquid", content: "core\n" })}${componentSource({ id: "c-card", to: "snippets/c-card.liquid", content: "card\n", dependencies: ["core"] })}`,
			{
				"components/core/core.liquid": "core\n",
				"components/c-card/c-card.liquid": "card\n",
			},
		);

		const result = await runCli(["add", "c-card"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Installed components: core, c-card");
		const lock = await readLock(cwd);
		expect(lock.indexOf("  core:")).toBeLessThan(lock.indexOf("  c-card:"));
	});

	it("is a no-op for unchanged installed component", async () => {
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

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toBe("Component already installed: c-button\n");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails before mutation for missing component and invalid component ID", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(registry, " {}");

		const missing = await runCli(["add", "c-missing"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});
		const invalid = await runCli(["add", "C-button"], { cwd });

		expect(missing.code).not.toBe(0);
		expect(missing.stderr).toContain("Component not found in registry");
		expect(invalid.code).not.toBe(0);
		expect(invalid.stderr).toContain("Invalid component ID");
	});

	it("fails before mutation for invalid registry metadata", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			componentSource({ to: "layout/theme.liquid" }),
			{ "components/c-button/theme.liquid": "button\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Disallowed component file target path");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails before mutation for invalid metadata and checksum mismatch", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			componentSource({ checksum: sha256("expected\n") }),
			{ "components/c-button/c-button.liquid": "actual\n" },
		);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Component file checksum mismatch");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails before mutation for circular dependencies", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource({ id: "c-a", to: "snippets/c-a.liquid", content: "a\n", dependencies: ["c-b"] })}${componentSource({ id: "c-b", to: "snippets/c-b.liquid", content: "b\n", dependencies: ["c-a"] })}`,
			{
				"components/c-a/c-a.liquid": "a\n",
				"components/c-b/c-b.liquid": "b\n",
			},
		);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["add", "c-a"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Circular component dependency");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails before mutation for duplicate destinations", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await writeRegistry(
			registry,
			`${componentSource({ id: "c-a", to: "snippets/shared.liquid", content: "a\n" })}${componentSource({ id: "c-b", to: "snippets/shared.liquid", content: "b\n" })}`,
			{
				"components/c-a/shared.liquid": "a\n",
				"components/c-b/shared.liquid": "b\n",
			},
		);
		const lockBefore = await readLock(cwd);

		const result = await runCli(["add", "c-a"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Duplicate component file target path");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails before mutation for existing untracked target", async () => {
		const cwd = await makeTempDir();
		const registry = await makeTempDir("nazare-registry-test-");
		await initProject(cwd);
		await mkdir(join(cwd, "snippets"));
		await writeFile(join(cwd, "snippets", "c-button.liquid"), "local\n");
		await writeRegistry(registry, componentSource(), {
			"components/c-button/c-button.liquid": "button\n",
		});
		const lockBefore = await readLock(cwd);

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("exists untracked");
		expect(
			await readFile(join(cwd, "snippets", "c-button.liquid"), "utf8"),
		).toBe("local\n");
		expect(await readLock(cwd)).toBe(lockBefore);
	});

	it("fails when installed component file is modified", async () => {
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

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("modified");
	});

	it("fails when installed component file is missing", async () => {
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
		await unlink(join(cwd, "snippets", "c-button.liquid"));

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("missing");
	});

	it("fails when installed component needs update", async () => {
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
		await writeRegistry(registry, componentSource({ content: "new\n" }), {
			"components/c-button/c-button.liquid": "new\n",
		});

		const result = await runCli(["add", "c-button"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registry },
		});

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("requires update");
	});
});
