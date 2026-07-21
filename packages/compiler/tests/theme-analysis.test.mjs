import assert from "node:assert/strict";
import test from "node:test";
import { analyzeNazareTheme, inspectNazareTheme } from "../dist/index.js";

const issues = (files) => analyzeNazareTheme(files).issues;
const hasIssue = (files, code) =>
	issues(files).some((issue) => issue.code === code);
const input = (files, name) =>
	analyzeNazareTheme(files).ir.expectedInputs.find(
		(candidate) => candidate.name === name,
	);
const edgeCount = (files, kind) =>
	inspectNazareTheme(files).edges.filter((edge) => edge.kind === kind).length;

test("theme input validation rejects invalid JSON shapes and unsafe paths", () => {
	for (const [path, contents, code] of [
		["config/settings_schema.json", "{}", "THEME_SETTINGS_SCHEMA_INVALID_ROOT"],
		["config/settings_data.json", "[]", "THEME_SETTINGS_DATA_INVALID_ROOT"],
		[
			"templates/index.json",
			'{"sections":[]}',
			"THEME_TEMPLATE_INVALID_SECTIONS",
		],
		["locales/en.json", "[]", "THEME_LOCALE_INVALID_ROOT"],
	]) {
		assert.equal(hasIssue([{ path, contents }], code), true, path);
	}

	for (const path of [
		"",
		".",
		"C:/theme/file.liquid",
		"a/./b.liquid",
		"a\u0000b.liquid",
	]) {
		assert.equal(
			hasIssue([{ path, contents: "" }], "THEME_UNSAFE_PATH"),
			true,
			JSON.stringify(path),
		);
	}
});

test("theme analysis reports duplicate, ambiguous, and broken schema inputs", () => {
	assert.equal(
		hasIssue(
			[
				{ path: "./sections/main.liquid", contents: "one" },
				{ path: "sections/main.liquid", contents: "two" },
			],
			"THEME_DUPLICATE_NORMALIZED_PATH",
		),
		true,
	);

	const ambiguous = [
		{ path: "sections/main.liquid", contents: `{% render 'button' %}` },
		{ path: "snippets/button.liquid", contents: "plain" },
		{ path: "components/button.nz.liquid", contents: "<button>NZ</button>" },
	];
	assert.equal(hasIssue(ambiguous, "THEME_DUPLICATE_DECLARATION"), true);
	assert.equal(hasIssue(ambiguous, "THEME_AMBIGUOUS_REFERENCE"), true);
	assert.equal(hasIssue(ambiguous, "THEME_UNRESOLVED_REFERENCE"), false);

	assert.equal(
		hasIssue(
			[
				{
					path: "sections/broken.liquid",
					contents: `{% schema %}{ not json }{% endschema %}`,
				},
			],
			"THEME_SCHEMA_JSON_INVALID",
		),
		true,
	);
});

test("theme input inference handles render arguments and Liquid scope", () => {
	assert.equal(
		hasIssue(
			[
				{ path: "sections/card.liquid", contents: `{% render 'price' %}` },
				{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
			],
			"THEME_RENDER_ARGUMENT_MISSING",
		),
		true,
	);
	assert.equal(
		hasIssue(
			[
				{
					path: "sections/card.liquid",
					contents: `{% render 'price', product: product, unused: product %}`,
				},
				{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
			],
			"THEME_RENDER_ARGUMENT_UNKNOWN",
		),
		true,
	);
	assert.equal(
		hasIssue(
			[
				{
					path: "sections/main.liquid",
					contents: `{% render 'price', product: product %}\n{% render 'price' %}`,
				},
				{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
			],
			"THEME_RENDER_ARGUMENT_INCONSISTENT",
		),
		true,
	);

	assert.equal(
		input(
			[
				{
					path: "snippets/price.liquid",
					contents: `{% if product %}{{ product.price }}{% endif %}`,
				},
			],
			"product",
		)?.required,
		false,
	);
	assert.equal(
		input(
			[
				{
					path: "snippets/price.liquid",
					contents:
						"{% if product %}{{ product.price }}{% endif %}{{ product.title }}",
				},
			],
			"product",
		)?.required,
		true,
	);
	assert.equal(
		input(
			[
				{
					path: "snippets/label.liquid",
					contents: "{{ label }}{% assign label = 'later' %}",
				},
			],
			"label",
		)?.required,
		true,
	);
	assert.equal(
		input(
			[
				{
					path: "snippets/local.liquid",
					contents: `{% assign label = 'Hi' %}{{ label }}`,
				},
			],
			"label",
		),
		undefined,
	);
});

test("theme input inference respects include and lexical scopes", () => {
	const includeFiles = [
		{ path: "sections/main.liquid", contents: "{% include 'card' %}" },
		{ path: "snippets/card.liquid", contents: "{{ product.title }}" },
	];
	assert.equal(hasIssue(includeFiles, "THEME_RENDER_ARGUMENT_MISSING"), false);

	assert.equal(
		input(
			[
				{
					path: "snippets/loop.liquid",
					contents:
						"{% for item in collection.products %}{{ item.title }}{% endfor %}{{ item.title }}",
				},
			],
			"item",
		)?.required,
		true,
	);
	assert.equal(
		input(
			[
				{
					path: "snippets/conditional.liquid",
					contents:
						"{% if product %}\n{% assign label = product.title %}\n{% endif %}\n{{ label }}",
				},
			],
			"label",
		)?.required,
		true,
	);
});

test("theme schema validation rejects malformed and duplicate definitions", () => {
	assert.equal(
		hasIssue(
			[
				{
					path: "sections/main.liquid",
					contents: '{% schema %}{"settings":{}}{% endschema %}',
				},
			],
			"THEME_SCHEMA_INVALID_SETTINGS",
		),
		true,
	);
	assert.equal(
		hasIssue(
			[
				{
					path: "sections/main.liquid",
					contents:
						'{% schema %}{"settings":[{"type":"text","id":"x"},{"type":"text","id":"x"}]}{% endschema %}',
				},
			],
			"THEME_SCHEMA_DUPLICATE_SETTING_ID",
		),
		true,
	);
});

test("theme occurrence evidence and imported render aliases remain resolved", () => {
	const repeated = analyzeNazareTheme([
		{ path: "snippets/repeated.liquid", contents: "{{ label }} {{ label }}" },
	]);
	assert.equal(repeated.ir.expectedInputs[0]?.evidenceIds.length, 2);

	const imported = analyzeNazareTheme([
		{
			path: "entry.nz.liquid",
			contents:
				'{% import Child from "./child.nz.liquid" %}<div>{% render Child {} %}</div>',
		},
		{ path: "child.nz.liquid", contents: "<span>child</span>" },
	]);
	assert.equal(
		imported.issues.some(
			(issue) => issue.code === "THEME_UNRESOLVED_REFERENCE",
		),
		false,
	);
});

test("theme and unambiguous block setting reads resolve", () => {
	const graph = inspectNazareTheme([
		{
			path: "config/settings_schema.json",
			contents: '[{"settings":[{"type":"text","id":"brand"}]}]',
		},
		{
			path: "sections/main.liquid",
			contents:
				'{{ settings.brand }} {{ block.settings.heading }}{% schema %}{"blocks":[{"type":"feature","settings":[{"type":"text","id":"heading"}]}]}{% endschema %}',
		},
	]);
	const reads = graph.edges.filter((edge) => edge.kind === "readsSetting");
	assert.equal(reads.length, 2);
	assert.equal(
		reads.some((edge) => edge.to.startsWith("unresolved:")),
		false,
	);
});

test("ambiguous block setting reads expose candidates and diagnostics", () => {
	const graph = inspectNazareTheme([
		{
			path: "sections/main.liquid",
			contents:
				'{{ block.settings.heading }}{% schema %}{"blocks":[{"type":"a","settings":[{"type":"text","id":"heading"}]},{"type":"b","settings":[{"type":"text","id":"heading"}]}]}{% endschema %}',
		},
	]);
	assert.equal(
		graph.issues.some((issue) => issue.code === "THEME_AMBIGUOUS_SETTING_READ"),
		true,
	);
	assert.equal(
		graph.edges.filter((edge) => edge.kind === "readsSetting").length,
		2,
	);
});

test("theme source facts ignore non-Liquid regions and keep repeated references distinct", () => {
	const quiet = analyzeNazareTheme([
		{
			path: "snippets/quiet.liquid",
			contents: `{% comment %}{{ product.price }}{% endcomment %}\n<!-- cart.items -->\nplain text mentioning product.title`,
		},
		{
			path: "components/widget.nz.liquid",
			contents: `<div ref="root"></div>\n{% script %}\nconst n = cart.items.length;\nexport default island(() => {});\n{% endscript %}`,
		},
	]);
	assert.deepEqual(quiet.ir.dataAccesses, []);
	assert.deepEqual(quiet.ir.capabilities, []);

	assert.equal(
		edgeCount(
			[
				{ path: "locales/en.json", contents: '{"key":"value"}' },
				{
					path: "snippets/repeated.liquid",
					contents: "{{ 'key' | t }} {{ 'key' | t }}",
				},
			],
			"referencesLocaleKey",
		),
		2,
	);
});
