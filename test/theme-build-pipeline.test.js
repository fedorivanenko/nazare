import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const manifestPath = new URL("../nazare.registry.yml", import.meta.url);
const packagePath = new URL("../theme/default/package.json", import.meta.url);
const viteConfigPath = new URL(
	"../theme/default/vite.config.js",
	import.meta.url,
);
const baseCssPath = new URL(
	"../theme/default/styles/base.css",
	import.meta.url,
);
const gitignorePath = new URL("../theme/default/.gitignore", import.meta.url);
const layoutPath = new URL(
	"../theme/default/layout/theme.liquid",
	import.meta.url,
);
const sectionPath = new URL(
	"../theme/default/sections/s-main.liquid",
	import.meta.url,
);

async function readText(url) {
	return readFile(url, "utf8");
}

describe("theme build pipeline", () => {
	it("declares build pipeline files in the registry manifest", async () => {
		const manifest = await readText(manifestPath);

		expect(manifest).toContain(
			"- from: theme/default/package.json\n      to: package.json",
		);
		expect(manifest).toContain(
			"- from: theme/default/vite.config.js\n      to: vite.config.js",
		);
		expect(manifest).toContain(
			"- from: theme/default/styles/base.css\n      to: styles/base.css",
		);
		expect(manifest).toContain(
			"- from: theme/default/.gitignore\n      to: .gitignore",
		);
	});

	it("exposes dev, build, and watch scripts with Vite and Tailwind dependencies", async () => {
		const packageJson = JSON.parse(await readText(packagePath));

		expect(packageJson.scripts).toEqual({
			dev: "shopify theme dev",
			build: "vite build",
			watch: "vite build --watch",
		});
		expect(packageJson.devDependencies).toMatchObject({
			"@tailwindcss/vite": expect.any(String),
			tailwindcss: expect.any(String),
			vite: expect.any(String),
		});
	});

	it("configures stable Vite output into Shopify assets", async () => {
		const config = await readText(viteConfigPath);

		expect(config).toContain('import tailwindcss from "@tailwindcss/vite"');
		expect(config).toContain(
			'import { nazareThemePlugin } from "./nazare/vite-plugin.js"',
		);
		expect(config).toContain("nazareThemePlugin()");
		expect(config).toContain("tailwindcss()");
		expect(config).toContain('outDir: "assets"');
		expect(config).toContain("emptyOutDir: false");
		expect(config).toContain('base: "styles/base.css"');
		expect(config).toContain('entryFileNames: "[name].js"');
		expect(config).toContain('chunkFileNames: "[name].js"');
		expect(config).toContain('assetFileNames: "[name][extname]"');
	});

	it("provides Tailwind base CSS scan sources", async () => {
		const css = await readText(baseCssPath);

		expect(css).toContain('@import "tailwindcss"');
		expect(css).toContain('@source "../layout/**/*.liquid"');
		expect(css).toContain('@source "../sections/**/*.liquid"');
		expect(css).toContain('@source "../snippets/**/*.liquid"');
	});

	it("adds CSS and JS bridge hook points", async () => {
		const layout = await readText(layoutPath);
		const section = await readText(sectionPath);

		expect(layout).toContain("{{ 'base.css' | asset_url | stylesheet_tag }}");
		expect(layout).toContain("{% render 'section-css-preloads' %}");
		expect(layout).toContain(
			'<script type="module" src="{{ \'theme.js\' | asset_url }}"></script>',
		);
		expect(section).toContain(
			"{% render 'section-css', section_name: 's-main' %}",
		);
	});

	it("keeps generated build outputs trackable", async () => {
		const gitignore = await readText(gitignorePath);

		expect(gitignore).toContain("node_modules/");
		expect(gitignore).not.toContain("assets/");
		expect(gitignore).not.toContain("styles/");
		expect(gitignore).not.toContain("scripts/theme.js");
		expect(gitignore).not.toContain("snippets/section-css");
	});
});
