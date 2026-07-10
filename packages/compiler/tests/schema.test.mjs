import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, themeSchemaFromIR } from "../dist/index.js";

function schemaFor(props) {
	const result = compileNazareArtifact(
		`{% props {${props}} %}`,
		"component.nz.liquid",
	);
	return themeSchemaFromIR(result.ir, { name: "component" });
}

test("schema: only .setting() props become settings", () => {
	const schema = schemaFor(`
  title: string.setting({ label: "Title" }),
  internal: string.required(),
`);
	assert.deepEqual(schema.settings, [
		{ type: "text", id: "title", label: "Title" },
	]);
});

test("schema: value types map to shopify inputs", () => {
	const schema = schemaFor(`
  text: string.setting({ label: "Text" }),
  body: richtext.setting({ label: "Body" }),
  link: url.setting({ label: "Link" }),
  background: color.setting({ label: "Background" }),
  visible: boolean.setting({ label: "Visible", default: true }),
  count: number.setting({ label: "Count" }),
  product: ShopifyProduct.setting({ label: "Product" }),
  image: ShopifyImage.setting({ label: "Image" }),
`);
	assert.deepEqual(
		schema.settings.map((setting) => [setting.id, setting.type]),
		[
			["text", "text"],
			["body", "richtext"],
			["link", "url"],
			["background", "color"],
			["visible", "checkbox"],
			["count", "number"],
			["product", "product"],
			["image", "image_picker"],
		],
	);
	assert.equal(
		schema.settings.find((setting) => setting.id === "visible")?.default,
		true,
	);
});

test("schema: constrained number becomes a range", () => {
	const schema = schemaFor(
		`size: number.min(0).max(100).step(5).unit("px").setting({ label: "Size", default: 50 }),`,
	);
	assert.deepEqual(schema.settings[0], {
		type: "range",
		id: "size",
		label: "Size",
		min: 0,
		max: 100,
		step: 5,
		unit: "px",
		default: 50,
	});
});

test("schema: enum becomes a select with options", () => {
	const schema = schemaFor(
		`align: string.enum("left", "center", "right").setting({ label: "Align", default: "center" }),`,
	);
	assert.equal(schema.settings[0].type, "select");
	assert.deepEqual(
		schema.settings[0].options?.map((option) => option.value),
		["left", "center", "right"],
	);
	assert.equal(schema.settings[0].default, "center");
});

test("schema: optional wrapper unwraps to the inner input", () => {
	const schema = schemaFor(
		`link: url.optional().setting({ label: "Link" }),`,
	);
	assert.equal(schema.settings[0].type, "url");
});

test("schema: .default() call value lands as the setting default", () => {
	const schema = schemaFor(
		`label: string.default("Details").setting({ label: "Label" }),`,
	);
	assert.equal(schema.settings[0].default, "Details");
});

test("schema: label falls back to prop name", () => {
	const schema = schemaFor(`heading: string.setting({}),`);
	assert.equal(schema.settings[0].label, "heading");
});
