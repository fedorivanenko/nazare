import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
	parseComponentManifest,
	validateComponentMetadata,
} = require("../bin/nazare.js");

const checksum = "a".repeat(64);
const manifestPath = new URL("../nazare.registry.yml", import.meta.url);
const buttonPath = new URL(
	"../components/c-button/c-button.liquid",
	import.meta.url,
);
const announcementPath = new URL(
	"../components/s-announcement/s-announcement.liquid",
	import.meta.url,
);

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function component(overrides = {}) {
	return {
		version: "1.0.0",
		type: "snippet",
		dependencies: [],
		files: [
			{
				from: "components/c-button/c-button.liquid",
				to: "snippets/c-button.liquid",
				checksum: {
					algorithm: "sha256",
					value: checksum,
				},
			},
		],
		...overrides,
	};
}

function expectInvalid(components, message) {
	expect(() => validateComponentMetadata(components)).toThrow(message);
}

describe("component registry metadata", () => {
	it("accepts an empty components manifest", () => {
		expect(
			parseComponentManifest("schemaVersion: 1\n\ncomponents: {}\n"),
		).toEqual({});
	});

	it("accepts valid snippet, section, and package components", () => {
		expect(() =>
			validateComponentMetadata({
				"c-button": component(),
				core: component({
					type: "package",
					files: [
						{
							from: "components/core/core.liquid",
							to: "snippets/core.liquid",
							checksum: { algorithm: "sha256", value: checksum },
						},
					],
				}),
				"s-hero": component({
					type: "section",
					dependencies: ["core"],
					files: [
						{
							from: "components/s-hero/s-hero.liquid",
							to: "sections/s-hero.liquid",
							checksum: { algorithm: "sha256", value: checksum },
						},
					],
				}),
			}),
		).not.toThrow();
	});

	it("declares committed c-button metadata with matching checksum", async () => {
		const manifest = await readFile(manifestPath, "utf8");
		const source = await readFile(buttonPath, "utf8");
		const components = parseComponentManifest(manifest);

		expect(() => validateComponentMetadata(components)).not.toThrow();
		expect(components["c-button"]).toMatchObject({
			version: "1.0.0",
			type: "snippet",
			dependencies: [],
			files: [
				{
					from: "components/c-button/c-button.liquid",
					to: "snippets/c-button.liquid",
					checksum: {
						algorithm: "sha256",
						value: sha256(source),
					},
				},
			],
		});
		expect(source).toContain(
			"assign button_scheme = scheme | default: 'solid'",
		);
		expect(source).toContain("unless button_scheme == 'solid'");
		expect(source).toContain("button_scheme == 'outline'");
		expect(source).toContain("button_scheme == 'ghost'");
		expect(source).toContain(
			"if button_label != blank and button_url != blank",
		);
	});

	it("declares committed s-announcement metadata with matching checksum", async () => {
		const manifest = await readFile(manifestPath, "utf8");
		const source = await readFile(announcementPath, "utf8");
		const components = parseComponentManifest(manifest);

		expect(() => validateComponentMetadata(components)).not.toThrow();
		expect(components["s-announcement"]).toMatchObject({
			version: "1.0.1",
			type: "section",
			dependencies: [],
			files: [
				{
					from: "components/s-announcement/s-announcement.liquid",
					to: "sections/s-announcement.liquid",
					checksum: {
						algorithm: "sha256",
						value: sha256(source),
					},
				},
			],
		});
		expect(source).toContain(
			"{% render 'section-css', section_name: 's-announcement' %}",
		);
		expect(source).toContain('"id": "text"');
		expect(source).toContain('"id": "link_url"');
		expect(source).toContain('"id": "link_label"');
		expect(source).toContain("if link_url != blank and link_label != blank");
	});

	it("parses valid component metadata", () => {
		const components = parseComponentManifest(`schemaVersion: 1

components:
  c-button:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-button/c-button.liquid
        to: snippets/c-button.liquid
        checksum:
          algorithm: sha256
          value: ${checksum}
`);

		expect(components["c-button"].type).toBe("snippet");
	});

	it("rejects invalid IDs, SemVer, and types", () => {
		expectInvalid({ "C-button": component() }, "Invalid component ID");
		expectInvalid(
			{ "c-button": component({ version: "one" }) },
			"Invalid component version",
		);
		expectInvalid(
			{ "c-button": component({ type: "block" }) },
			"Invalid component type",
		);
		expectInvalid(
			{ button: component({ type: "snippet" }) },
			"Invalid snippet component ID",
		);
	});

	it("rejects missing, duplicate, self, and circular dependencies", () => {
		expectInvalid(
			{ "c-button": component({ dependencies: ["missing"] }) },
			"Missing component dependency",
		);
		expectInvalid(
			{
				"c-button": component({ dependencies: ["core", "core"] }),
				core: component({
					type: "package",
					files: [
						{
							...component().files[0],
							from: "components/core/core.liquid",
							to: "snippets/core.liquid",
						},
					],
				}),
			},
			"Duplicate component dependency",
		);
		expectInvalid(
			{ "c-button": component({ dependencies: ["c-button"] }) },
			"Component cannot depend on itself",
		);
		expectInvalid(
			{
				"c-a": component({
					dependencies: ["c-b"],
					files: [
						{
							...component().files[0],
							from: "components/c-a/c-a.liquid",
							to: "snippets/c-a.liquid",
						},
					],
				}),
				"c-b": component({
					dependencies: ["c-a"],
					files: [
						{
							...component().files[0],
							from: "components/c-b/c-b.liquid",
							to: "snippets/c-b.liquid",
						},
					],
				}),
			},
			"Circular component dependency",
		);
	});

	it("rejects unsafe source and target paths", () => {
		expectInvalid(
			{
				"c-button": component({
					files: [{ ...component().files[0], from: "../c-button.liquid" }],
				}),
			},
			"Unsafe component file source path",
		);
		expectInvalid(
			{
				"c-button": component({
					files: [
						{
							...component().files[0],
							from: "components/other/c-button.liquid",
						},
					],
				}),
			},
			"Component source path must be under components/c-button/",
		);
		expectInvalid(
			{
				"c-button": component({
					files: [{ ...component().files[0], to: "layout/theme.liquid" }],
				}),
			},
			"Disallowed component file target path",
		);
	});

	it("rejects duplicate destinations and invalid checksums", () => {
		expectInvalid(
			{
				"c-button": component(),
				"c-link": component({
					files: [
						{
							...component().files[0],
							from: "components/c-link/c-link.liquid",
						},
					],
				}),
			},
			"Duplicate component file target path",
		);
		expectInvalid(
			{
				"c-button": component({
					files: [
						{
							...component().files[0],
							checksum: { algorithm: "sha256", value: "A".repeat(64) },
						},
					],
				}),
			},
			"Invalid component file checksum metadata",
		);
	});
});
