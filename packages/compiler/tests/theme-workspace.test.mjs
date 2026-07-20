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
	assert.ok(graph.edges.some((edge) => edge.kind === "readsSetting"));
	assert.ok(
		graph.nodes.some(
			(node) =>
				node.kind === "renderArgument" &&
				node.argumentName === "product" &&
				node.valueExpression === "product",
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
