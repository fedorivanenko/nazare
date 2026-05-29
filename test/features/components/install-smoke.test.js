import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL(
	"../../../packages/nazare/bin/nazare.js",
	import.meta.url,
);
const registryRoot = new URL("../../../", import.meta.url).pathname;
const tempRoots = [];

async function makeTempDir(prefix = "nazare-component-install-smoke-test-") {
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

async function initProject(cwd) {
	const result = await runCli(["init"], { cwd });
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

describe("committed component install smoke", () => {
	it("installs s-announcement from local registry", async () => {
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

	it("installs c-button from local registry", async () => {
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

	it("installs c-video from local registry", async () => {
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

	it("installs c-carousel from local registry", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["add", "c-carousel"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registryRoot },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote snippets/c-carousel.liquid");
		expect(result.stdout).toContain("Wrote scripts/snippets/c-carousel.js");
		expect(result.stdout).toContain("Installed components: c-carousel");
		const snippet = await readFile(
			join(cwd, "snippets", "c-carousel.liquid"),
			"utf8",
		);
		expect(snippet).toContain('data-nazare-use="snippets/c-carousel"');
		expect(snippet).toContain("data-c-carousel-track");
		const script = await readFile(
			join(cwd, "scripts", "snippets", "c-carousel.js"),
			"utf8",
		);
		expect(script).toContain("requestAnimationFrame");
		expect(script).not.toContain("cloneNode");
		const lock = await readLock(cwd);
		expect(lock).toContain("c-carousel:");
		expect(lock).toContain("path: snippets/c-carousel.liquid");
		expect(lock).toContain("path: scripts/snippets/c-carousel.js");
	});

	it("installs s-statistics and c-stat dependency from local registry", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["add", "s-statistics"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registryRoot },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote snippets/c-stat.liquid");
		expect(result.stdout).toContain("Wrote scripts/snippets/c-stat.js");
		expect(result.stdout).toContain("Wrote sections/s-statistics.liquid");
		expect(result.stdout).toContain("s-statistics");
		const section = await readFile(
			join(cwd, "sections", "s-statistics.liquid"),
			"utf8",
		);
		expect(section).toContain(
			"{% render 'section-css', section_name: 's-statistics' %}",
		);
		expect(section).toContain("{% render 'c-stat'");
		expect(section).toContain("section.blocks.size > 0");
		const lock = await readLock(cwd);
		expect(lock).toContain("c-stat:");
		expect(lock).toContain("s-statistics:");
		expect(lock).toContain("    dependencies: \n      - c-stat");
		expect(lock).toContain("path: sections/s-statistics.liquid");
	});

	it("installs s-video-gallery and dependencies from local registry", async () => {
		const cwd = await makeTempDir();
		await initProject(cwd);

		const result = await runCli(["add", "s-video-gallery"], {
			cwd,
			env: { NAZARE_REGISTRY_DIR: registryRoot },
		});

		expect(result).toMatchObject({ code: 0, stderr: "" });
		expect(result.stdout).toContain("Wrote snippets/c-video.liquid");
		expect(result.stdout).toContain("Wrote scripts/snippets/c-video.js");
		expect(result.stdout).toContain("Wrote snippets/c-button.liquid");
		expect(result.stdout).toContain("Wrote snippets/c-carousel.liquid");
		expect(result.stdout).toContain("Wrote scripts/snippets/c-carousel.js");
		expect(result.stdout).toContain("Wrote sections/s-video-gallery.liquid");
		expect(result.stdout).toContain("s-video-gallery");
		const section = await readFile(
			join(cwd, "sections", "s-video-gallery.liquid"),
			"utf8",
		);
		expect(section).toContain(
			"{% render 'section-css', section_name: 's-video-gallery' %}",
		);
		expect(section).toContain("{% render 'c-button'");
		expect(section).toContain("{% render 'c-video'");
		expect(section).toContain("block.settings.video != blank");
		expect(section).toContain('"id": "cta_label"');
		expect(section).toContain('"id": "cta_url"');
		expect(section).toContain('"id": "columns"');
		expect(section).toContain('"id": "layout_mode"');
		expect(section).toContain("{% render 'c-carousel'");
		expect(section).toContain("data-c-carousel-item");
		const lock = await readLock(cwd);
		expect(lock).toContain("c-video:");
		expect(lock).toContain("c-button:");
		expect(lock).toContain("c-carousel:");
		expect(lock).toContain("s-video-gallery:");
		expect(lock).toContain(
			"    dependencies: \n      - c-video\n      - c-button\n      - c-carousel",
		);
		expect(lock).toContain("path: sections/s-video-gallery.liquid");
	});
});
