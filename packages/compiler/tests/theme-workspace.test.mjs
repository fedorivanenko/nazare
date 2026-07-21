import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeNazareTheme,
	buildNazareThemeWorkspace,
	inspectNazareTheme,
} from "../dist/index.js";

test("inspectNazareTheme projects plain Liquid dependencies and schema", () => {
	const graph = inspectNazareTheme([
		{
			path: "sections/main.liquid",
			contents: `{% render 'card' %}\n{% schema %}{"settings":[{"type":"text","id":"title"}]}{% endschema %}`,
		},
		{ path: "snippets/card.liquid", contents: `<article>Card</article>` },
	]);

	assert.ok(
		graph.nodes.some((node) => node.kind === "section" && node.name === "main"),
	);
	assert.ok(graph.views.themeStructure.edgeIds.length > 0);
	assert.ok(
		graph.nodes.some((node) => node.kind === "snippet" && node.name === "card"),
	);
	assert.ok(
		graph.nodes.some(
			(node) => node.kind === "setting" && node.settingId === "title",
		),
	);
	assert.ok(
		graph.edges.some(
			(edge) => edge.kind === "renders" && edge.targetName === "card",
		),
	);
});

test("inspectNazareTheme keeps unresolved references navigable", () => {
	const graph = inspectNazareTheme([
		{ path: "sections/main.liquid", contents: `{% render 'missing' %}` },
	]);

	assert.ok(
		graph.nodes.some(
			(node) => node.kind === "unresolved" && node.name === "missing",
		),
	);
	assert.ok(
		graph.issues.some((issue) => issue.code === "THEME_UNRESOLVED_REFERENCE"),
	);
});

test("analyzeNazareTheme extracts template JSON sections", () => {
	const analysis = analyzeNazareTheme([
		{
			path: "templates/index.json",
			contents: JSON.stringify({ sections: { main: { type: "hero" } } }),
		},
		{ path: "sections/hero.liquid", contents: `<section>Hero</section>` },
	]);

	assert.ok(
		analysis.ir.references.some(
			(reference) =>
				reference.kind === "containsSection" &&
				reference.targetName === "hero" &&
				reference.resolvedDeclarationId,
		),
	);
});

test("template JSON sections create section instances", () => {
	const graph = inspectNazareTheme([
		{
			path: "templates/product.json",
			contents: JSON.stringify({
				sections: { main: { type: "main-product" } },
				order: ["main"],
			}),
		},
		{
			path: "sections/main-product.liquid",
			contents: "<section>Product</section>",
		},
	]);

	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "sectionInstance" &&
				node.instanceId === "main" &&
				node.sectionType === "main-product",
		),
	);
	assert.ok(
		graph.edges.some((edge) => edge.kind === "templateContainsSectionInstance"),
	);
	assert.ok(graph.edges.some((edge) => edge.kind === "instanceOf"));
});

test("impact summary links dependencies, dependents, pages, and unused files", () => {
	const graph = inspectNazareTheme([
		{
			path: "templates/product.json",
			contents: JSON.stringify({
				sections: { main: { type: "main-product" } },
			}),
		},
		{ path: "sections/main-product.liquid", contents: `{% render 'price' %}` },
		{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
		{ path: "snippets/unused.liquid", contents: `Unused` },
	]);

	assert.deepEqual(graph.impact.dependencies["templates/product.json"], [
		"sections/main-product.liquid",
	]);
	assert.ok(
		graph.impact.dependents["snippets/price.liquid"].includes(
			"sections/main-product.liquid",
		),
	);
	assert.ok(
		graph.impact.affectedPages["snippets/price.liquid"].includes(
			"templates/product.json",
		),
	);
	assert.ok(graph.impact.unusedFiles.includes("snippets/unused.liquid"));
});

test("templates create page composition nodes", () => {
	const graph = inspectNazareTheme([
		{
			path: "templates/product.json",
			contents: JSON.stringify({ sections: {} }),
		},
	]);

	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "page" &&
				node.path === "templates/product.json" &&
				node.pageType === "product",
		),
	);
	assert.ok(graph.edges.some((edge) => edge.kind === "pageUsesTemplate"));
});

test("section schemas create block and block setting nodes", () => {
	const graph = inspectNazareTheme([
		{
			path: "sections/main.liquid",
			contents: `{% schema %}${JSON.stringify({
				blocks: [
					{
						type: "feature",
						name: "Feature",
						settings: [{ type: "text", id: "heading" }],
					},
				],
			})}{% endschema %}`,
		},
	]);

	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "block" &&
				node.path === "sections/main.liquid" &&
				node.blockType === "feature",
		),
	);
	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "blockSetting" &&
				node.blockType === "feature" &&
				node.settingId === "heading",
		),
	);
	assert.ok(graph.edges.some((edge) => edge.kind === "definesBlock"));
	assert.ok(graph.edges.some((edge) => edge.kind === "definesBlockSetting"));
});

test("source behavior creates capability and classification records", () => {
	const graph = inspectNazareTheme([
		{
			path: "sections/main-product.liquid",
			contents: `<form action="{{ routes.cart_add_url }}"><input name="id" value="{{ product.selected_or_first_available_variant.id }}">{{ product.price }}</form>`,
		},
	]);

	assert.ok(
		graph.nodes.some(
			(node) => node.kind === "capability" && node.capability === "addsToCart",
		),
	);
	assert.ok(
		graph.nodes.some(
			(node) => node.kind === "classification" && node.label === "productForm",
		),
	);
	assert.ok(graph.edges.some((edge) => edge.kind === "classifiedAs"));
});

test("source filters create asset and locale references", () => {
	const graph = inspectNazareTheme([
		{
			path: "sections/main.liquid",
			contents: `{{ 'theme.css' | asset_url }} {{ 'general.accessibility.skip_to_content' | t }}`,
		},
		{ path: "assets/theme.css", contents: "body{}" },
		{
			path: "locales/en.default.json",
			contents: JSON.stringify({
				general: { accessibility: { skip_to_content: "Skip" } },
			}),
		},
	]);

	assert.ok(
		graph.edges.some(
			(edge) =>
				edge.kind === "referencesAsset" && edge.targetName === "theme.css",
		),
	);
	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "localeKey" &&
				node.key === "general.accessibility.skip_to_content",
		),
	);
	assert.ok(graph.edges.some((edge) => edge.kind === "referencesLocaleKey"));
});

test("settings_schema settings point at existing schema nodes", () => {
	const graph = inspectNazareTheme([
		{
			path: "config/settings_schema.json",
			contents: JSON.stringify([
				{ name: "Theme", settings: [{ type: "text", id: "brand" }] },
			]),
		},
	]);
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	for (const edge of graph.edges) {
		assert.ok(
			nodeIds.has(edge.from),
			`${edge.id} has missing from ${edge.from}`,
		);
		assert.ok(nodeIds.has(edge.to), `${edge.id} has missing to ${edge.to}`);
	}
});

test("duplicate normalized paths are diagnostics", () => {
	const analysis = analyzeNazareTheme([
		{ path: "./sections/main.liquid", contents: "one" },
		{ path: "sections/main.liquid", contents: "two" },
	]);

	assert.ok(
		analysis.issues.some(
			(issue) => issue.code === "THEME_DUPLICATE_NORMALIZED_PATH",
		),
	);
});

test("duplicate declarations make references explicitly ambiguous", () => {
	const analysis = analyzeNazareTheme([
		{ path: "sections/main.liquid", contents: `{% render 'button' %}` },
		{ path: "snippets/button.liquid", contents: "plain" },
		{ path: "components/button.nz.liquid", contents: "<button>NZ</button>" },
	]);

	assert.ok(
		analysis.issues.some(
			(issue) => issue.code === "THEME_DUPLICATE_DECLARATION",
		),
	);
	assert.ok(
		analysis.issues.some((issue) => issue.code === "THEME_AMBIGUOUS_REFERENCE"),
	);
	assert.equal(
		analysis.issues.some(
			(issue) => issue.code === "THEME_UNRESOLVED_REFERENCE",
		),
		false,
	);
	const reference = analysis.ir.references.find(
		(candidate) =>
			candidate.kind === "rendersSnippet" && candidate.targetName === "button",
	);
	assert.ok(reference);
	assert.equal(reference.resolvedDeclarationId, undefined);
});

test("inspectNazareTheme records data access, settings reads, and render args", () => {
	const graph = inspectNazareTheme([
		{
			path: "sections/product-card.liquid",
			contents: `{% render 'price', product: product %}\n{{ product.price }}\n{{ section.settings.heading }}\n{% schema %}{"settings":[{"type":"text","id":"heading"}]}{% endschema %}`,
		},
		{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
	]);

	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "shopifyProperty" &&
				node.object === "product" &&
				node.propertyPath === "price",
		),
	);
	assert.ok(
		graph.edges.some(
			(edge) =>
				edge.kind === "accessesData" && edge.expression === "product.price",
		),
	);
	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "capability" &&
				node.capability === "displaysProductPrice" &&
				node.confidence > 0,
		),
	);
	assert.ok(graph.edges.some((edge) => edge.kind === "readsSetting"));
	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "renderArgument" &&
				node.argumentName === "product" &&
				node.valueExpression === "product",
		),
	);
	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "expectedInput" &&
				node.path === "snippets/price.liquid" &&
				node.name === "product" &&
				node.required,
		),
	);
	assert.ok(
		graph.evidence.some(
			(evidence) =>
				evidence.kind === "dataRead" &&
				evidence.file === "snippets/price.liquid" &&
				evidence.extractor === "theme-source-facts",
		),
	);
});

test("analyzeNazareTheme reports missing and unknown inferred render inputs", () => {
	const missing = analyzeNazareTheme([
		{ path: "sections/card.liquid", contents: `{% render 'price' %}` },
		{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
	]);

	assert.ok(
		missing.issues.some(
			(issue) => issue.code === "THEME_RENDER_ARGUMENT_MISSING",
		),
	);

	const unknown = analyzeNazareTheme([
		{
			path: "sections/card.liquid",
			contents: `{% render 'price', product: product, unused: product %}`,
		},
		{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
	]);
	assert.ok(
		unknown.issues.some(
			(issue) => issue.code === "THEME_RENDER_ARGUMENT_UNKNOWN",
		),
	);
});

test("buildNazareThemeWorkspace reports invalid scoped files", () => {
	const missing = buildNazareThemeWorkspace([], {
		scope: { kind: "file", path: "missing.nz.liquid" },
	});

	assert.ok(
		missing.issues.some((issue) => issue.code === "THEME_SCOPE_FILE_NOT_FOUND"),
	);
	assert.deepEqual(missing.artifacts, []);
	assert.deepEqual(missing.emitted.files, []);

	const unsupported = buildNazareThemeWorkspace(
		[{ path: "sections/main.liquid", contents: "<section>Main</section>" }],
		{ scope: { kind: "file", path: "sections/main.liquid" } },
	);
	assert.ok(
		unsupported.issues.some(
			(issue) => issue.code === "THEME_SCOPE_UNSUPPORTED_FILE_KIND",
		),
	);
	assert.deepEqual(unsupported.artifacts, []);
	assert.deepEqual(unsupported.emitted.files, []);
});

test("buildNazareThemeWorkspace builds a file scope without unrelated diagnostics or duplicate compile diagnostics", () => {
	const built = buildNazareThemeWorkspace(
		[{ path: "component.nz.liquid", contents: `<div>Hello</div>` }],
		{ scope: { kind: "file", path: "component.nz.liquid" }, name: "component" },
	);

	assert.equal(built.artifacts.length, 1);
	assert.ok(
		built.emitted.files.some(
			(file) => file.path === "snippets/component.liquid",
		),
	);

	const scoped = buildNazareThemeWorkspace(
		[
			{
				path: "a.nz.liquid",
				contents: `{% import Child from "./child.nz.liquid" %}<div>A</div>`,
			},
			{ path: "child.nz.liquid", contents: `<span>Child</span>` },
			{
				path: "b.nz.liquid",
				contents: `{% import Missing from "./missing.nz.liquid" %}`,
			},
		],
		{ scope: { kind: "file", path: "a.nz.liquid" }, name: "a" },
	);
	assert.equal(
		scoped.issues.filter((issue) => issue.code === "IMPORT_NOT_FOUND").length,
		0,
	);
	assert.equal(
		scoped.issues.filter((issue) => issue.code === "THEME_UNRESOLVED_REFERENCE")
			.length,
		0,
	);

	const missing = buildNazareThemeWorkspace(
		[
			{
				path: "component.nz.liquid",
				contents: `{% import Missing from "./missing.nz.liquid" %}`,
			},
		],
		{ scope: { kind: "file", path: "component.nz.liquid" }, name: "component" },
	);
	assert.equal(
		missing.issues.filter((issue) => issue.code === "IMPORT_NOT_FOUND").length,
		1,
	);
});

test("comments and script bodies never produce data facts", () => {
	const analysis = analyzeNazareTheme([
		{
			path: "snippets/quiet.liquid",
			contents: `{% comment %}{{ product.price }}{% endcomment %}\n<!-- cart.items -->\nplain text mentioning product.title`,
		},
		{
			path: "components/widget.nz.liquid",
			contents: `<div ref="root"></div>\n{% script %}\nconst n = cart.items.length;\nexport default island(() => {});\n{% endscript %}`,
		},
	]);

	assert.deepEqual(analysis.ir.dataAccesses, []);
	assert.deepEqual(analysis.ir.capabilities, []);
});

test("two renders of one snippet keep separate argument sets", () => {
	const analysis = analyzeNazareTheme([
		{
			path: "sections/main.liquid",
			contents: `{% render 'price', product: product %}\n{% render 'price' %}`,
		},
		{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
	]);

	const sites = analysis.ir.renderSites.filter(
		(site) => site.targetName === "price",
	);
	assert.equal(sites.length, 2);
	const argumentCounts = sites
		.map((site) => site.argumentIds.length)
		.sort((a, b) => a - b);
	assert.deepEqual(argumentCounts, [0, 1]);
	// The bare call misses the input; the argument-passing call does not.
	assert.equal(
		analysis.issues.filter(
			(issue) => issue.code === "THEME_RENDER_ARGUMENT_MISSING",
		).length,
		1,
	);
	assert.ok(
		analysis.issues.some(
			(issue) => issue.code === "THEME_RENDER_ARGUMENT_INCONSISTENT",
		),
	);
});

test("guarded object reads make the inferred input optional", () => {
	const analysis = analyzeNazareTheme([
		{ path: "sections/main.liquid", contents: `{% render 'price' %}` },
		{
			path: "snippets/price.liquid",
			contents: `{% if product %}{{ product.price }}{% endif %}`,
		},
	]);

	const input = analysis.ir.expectedInputs.find(
		(candidate) => candidate.name === "product",
	);
	assert.ok(input);
	assert.equal(input.required, false);
	assert.ok(
		!analysis.issues.some(
			(issue) => issue.code === "THEME_RENDER_ARGUMENT_MISSING",
		),
	);
});

test("free variable reads in a snippet are inferred inputs", () => {
	const missing = analyzeNazareTheme([
		{ path: "sections/main.liquid", contents: `{% render 'badge' %}` },
		{ path: "snippets/badge.liquid", contents: `<span>{{ text }}</span>` },
	]);
	assert.ok(
		missing.ir.expectedInputs.some(
			(input) => input.name === "text" && input.required,
		),
	);
	assert.ok(
		missing.issues.some(
			(issue) => issue.code === "THEME_RENDER_ARGUMENT_MISSING",
		),
	);

	// Passing the free variable satisfies it — and is not flagged unknown.
	const passed = analyzeNazareTheme([
		{
			path: "sections/main.liquid",
			contents: `{% render 'badge', text: product.title %}`,
		},
		{ path: "snippets/badge.liquid", contents: `<span>{{ text }}</span>` },
	]);
	assert.ok(
		!passed.issues.some(
			(issue) =>
				issue.code === "THEME_RENDER_ARGUMENT_MISSING" ||
				issue.code === "THEME_RENDER_ARGUMENT_UNKNOWN",
		),
	);

	// Assigned names are not inputs.
	const assigned = analyzeNazareTheme([
		{
			path: "snippets/local.liquid",
			contents: `{% assign label = 'Hi' %}{{ label }}`,
		},
	]);
	assert.ok(
		!assigned.ir.expectedInputs.some((input) => input.name === "label"),
	);
});

test("invalid schema JSON in analysis is a diagnostic, not silence", () => {
	const analysis = analyzeNazareTheme([
		{
			path: "sections/broken.liquid",
			contents: `{% schema %}{ not json }{% endschema %}`,
		},
	]);

	assert.ok(
		analysis.issues.some((issue) => issue.code === "THEME_SCHEMA_JSON_INVALID"),
	);
});

test("config files are Shopify-consumed entries, never unused", () => {
	const graph = inspectNazareTheme([
		{ path: "config/settings_schema.json", contents: "[]" },
		{ path: "config/settings_data.json", contents: "{}" },
		{ path: "snippets/unused.liquid", contents: "Unused" },
	]);

	assert.ok(!graph.impact.unusedFiles.includes("config/settings_schema.json"));
	assert.ok(!graph.impact.unusedFiles.includes("config/settings_data.json"));
	assert.ok(graph.impact.unusedFiles.includes("snippets/unused.liquid"));
});
