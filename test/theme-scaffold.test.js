import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const manifestPath = new URL("../nazare.registry.yml", import.meta.url);
const layoutPath = new URL(
	"../theme/default/layout/theme.liquid",
	import.meta.url,
);
const templatePath = new URL(
	"../theme/default/templates/index.json",
	import.meta.url,
);
const sectionPath = new URL(
	"../theme/default/sections/s-main.liquid",
	import.meta.url,
);
const settingsSchemaPath = new URL(
	"../theme/default/config/settings_schema.json",
	import.meta.url,
);

async function readText(url) {
	return readFile(url, "utf8");
}

describe("theme scaffold", () => {
	it("contains exact v1 Shopify-only scaffold file list in manifest", async () => {
		const manifest = await readText(manifestPath);

		expect(manifest).toContain(
			"theme:\n  version: 1.0.0\n  source: theme/default",
		);
		expect(manifest).toContain(
			"- from: theme/default/layout/theme.liquid\n      to: layout/theme.liquid",
		);
		expect(manifest).toContain(
			"- from: theme/default/templates/index.json\n      to: templates/index.json",
		);
		expect(manifest).toContain(
			"- from: theme/default/sections/s-main.liquid\n      to: sections/s-main.liquid",
		);
		expect(manifest).toContain(
			"- from: theme/default/config/settings_schema.json\n      to: config/settings_schema.json",
		);
	});

	it("keeps Shopify scaffold sources present", async () => {
		await expect(readText(layoutPath)).resolves.toContain(
			"{{ content_for_layout }}",
		);
		await expect(readText(templatePath)).resolves.toContain('"type": "s-main"');
		await expect(readText(sectionPath)).resolves.toContain("{% schema %}");
		await expect(readText(settingsSchemaPath)).resolves.toContain(
			'"name": "Theme settings"',
		);
	});

	it("uses one starter section only and index template points to it", async () => {
		const template = JSON.parse(await readText(templatePath));

		expect(Object.keys(template.sections)).toEqual(["main"]);
		expect(template.sections.main).toEqual({
			type: "s-main",
			settings: {},
		});
		expect(template.order).toEqual(["main"]);
	});

	it("layout renders minimal Shopify document structure", async () => {
		const layout = await readText(layoutPath);

		expect(layout).toContain("<!doctype html>");
		expect(layout).toContain("<html");
		expect(layout).toContain("<head>");
		expect(layout).toContain("{{ content_for_header }}");
		expect(layout).toContain("<body>");
		expect(layout).toContain("{{ content_for_layout }}");
	});
});
