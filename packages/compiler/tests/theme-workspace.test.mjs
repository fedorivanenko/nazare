import assert from "node:assert/strict";
import test from "node:test";
import {
	buildNazareThemeWorkspace,
	getThemeAffectedPages,
	getThemeDependencies,
	getThemeNode,
	inspectNazareTheme,
	summarizeThemeGraph,
	ThemeWorkspaceSession,
} from "../dist/index.js";

const hasIssue = (result, code) =>
	result.issues.some((issue) => issue.code === code);

test("workspace session updates graph with stable revisions and deltas", () => {
	const session = new ThemeWorkspaceSession([
		{
			path: "templates/index.json",
			contents: JSON.stringify({ sections: { main: { type: "main" } } }),
		},
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "Card" },
	]);
	const first = session.updateFile({
		path: "snippets/card.liquid",
		contents: "Updated card",
	});
	assert.equal(first.revision, 1);
	assert.deepEqual(first.invalidatedNodeIds, [
		"sections/main.liquid",
		"snippets/card.liquid",
		"templates/index.json",
	]);
	assert.deepEqual(first.affectedPages, ["templates/index.json"]);
	assert.deepEqual(first.changedPaths, ["snippets/card.liquid"]);
	assert.deepEqual(first.addedNodeIds, []);
	assert.deepEqual(first.removedNodeIds, []);
	assert.deepEqual(first.changedNodeIds, []);
	assert.deepEqual(first.changedEdgeIds, []);
	const unchanged = session.updateFile({
		path: "snippets/card.liquid",
		contents: "Updated card",
	});
	assert.equal(unchanged.revision, 1);
	assert.deepEqual(unchanged.changedPaths, []);
	const removed = session.removeFile("snippets/card.liquid");
	assert.equal(removed.revision, 2);
	assert.ok(removed.removedNodeIds.includes("file:snippets/card.liquid"));
});

test("theme query API reads canonical graph and impact indexes", () => {
	const graph = inspectNazareTheme([
		{
			path: "templates/index.json",
			contents: JSON.stringify({ sections: { main: { type: "main" } } }),
		},
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "Card" },
	]);
	const section = getThemeNode(graph, "section:sections/main.liquid:main");
	assert.equal(section?.kind, "section");
	assert.deepEqual(getThemeDependencies(graph, "templates/index.json"), [
		"sections/main.liquid",
	]);
	assert.deepEqual(getThemeAffectedPages(graph, "snippets/card.liquid"), [
		"templates/index.json",
	]);
	assert.equal(summarizeThemeGraph(graph).pageCount, 1);
});

test("inspectNazareTheme keeps unresolved references navigable", () => {
	const graph = inspectNazareTheme([
		{ path: "sections/main.liquid", contents: `{% render 'missing' %}` },
	]);

	assert.equal(hasIssue(graph, "THEME_UNRESOLVED_REFERENCE"), true);
	assert.ok(
		graph.nodes.some(
			(node) => node.kind === "unresolved" && node.name === "missing",
		),
	);
});

test("semantic graph connects pages, blocks, render sites, settings, and layouts", () => {
	const graph = inspectNazareTheme([
		{ path: "layout/theme.liquid", contents: "{{ content_for_layout }}" },
		{
			path: "templates/product.json",
			contents: JSON.stringify({
				sections: {
					main: {
						type: "main-product",
						blocks: { icon: { type: "icon" } },
					},
				},
			}),
		},
		{
			path: "sections/main-product.liquid",
			contents:
				`{% layout 'theme' %}{% render 'badge', color: section.settings.color %}` +
				`{% schema %}{"settings":[{"type":"color","id":"color"}]}{% endschema %}`,
		},
		{ path: "snippets/badge.liquid", contents: "{{ color }}" },
		{ path: "blocks/icon.liquid", contents: "Icon" },
	]);

	for (const kind of [
		"usesLayout",
		"pageContainsSectionInstance",
		"sectionInstanceContainsBlockInstance",
		"instanceOfBlock",
		"invokes",
		"resolvesRenderTarget",
		"hasArgument",
		"satisfiesInput",
		"argumentReadsSetting",
	]) {
		assert.ok(
			graph.edges.some((edge) => edge.kind === kind),
			kind,
		);
	}
	assert.ok(graph.nodes.some((node) => node.kind === "renderSite"));
	assert.ok(graph.nodes.some((node) => node.kind === "themeBlock"));
	assert.ok(graph.nodes.some((node) => node.kind === "blockInstance"));
});

test("semantic graph is canonical across input order", () => {
	const files = [
		{ path: "snippets/card.liquid", contents: "{{ product.title }}" },
		{
			path: "sections/main.liquid",
			contents: `{% render 'card', product: product %}`,
		},
		{
			path: "templates/product.json",
			contents: JSON.stringify({ sections: { main: { type: "main" } } }),
		},
	];
	assert.deepEqual(
		inspectNazareTheme(files),
		inspectNazareTheme([...files].reverse()),
	);
});

test("impact summary follows template dependencies and Shopify-owned entries", () => {
	const graph = inspectNazareTheme([
		{
			path: "templates/product.json",
			contents: JSON.stringify({
				sections: { main: { type: "main-product" } },
			}),
		},
		{ path: "sections/main-product.liquid", contents: `{% render 'price' %}` },
		{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
		{ path: "snippets/unused.liquid", contents: "Unused" },
		{ path: "config/settings_schema.json", contents: "[]" },
		{ path: "config/settings_data.json", contents: "{}" },
	]);

	assert.deepEqual(graph.impact.dependencies["templates/product.json"], [
		"sections/main-product.liquid",
	]);
	assert.ok(
		graph.impact.affectedPages["snippets/price.liquid"].includes(
			"templates/product.json",
		),
	);
	assert.deepEqual(graph.impact.unusedFiles, ["snippets/unused.liquid"]);
});

test("theme check ignore policy does not suppress unrelated Inspect findings", () => {
	const result = inspectNazareTheme(
		[{ path: "sections/main.liquid", contents: "{% render 'missing' %}" }],
		{ themeCheck: { contents: "ignore:\n  - UnresolvedReference\n" } },
	);
	assert.equal(
		result.issues.some((issue) => issue.code === "THEME_UNRESOLVED_REFERENCE"),
		true,
	);
});

test("unsupported theme check policy keys are reported", () => {
	const result = inspectNazareTheme(
		[{ path: "sections/main.liquid", contents: "{% render 'missing' %}" }],
		{ themeCheck: { contents: "severity: warning\n" } },
	);
	assert.equal(
		result.issues.some(
			(issue) => issue.code === "THEME_CHECK_CONFIG_UNSUPPORTED",
		),
		true,
	);
});

test("malformed theme check policy is reported", () => {
	const result = inspectNazareTheme(
		[{ path: "sections/main.liquid", contents: "{% render 'missing' %}" }],
		{ themeCheck: { contents: "ignore: [" } },
	);
	assert.equal(
		result.issues.some((issue) => issue.code === "THEME_CHECK_CONFIG_INVALID"),
		true,
	);
});

test("metafield snapshot resolves reads and reports missing definitions", () => {
	const files = [
		{
			path: "snippets/card.liquid",
			contents: "{{ product.metafields.custom.subtitle }}",
		},
		{
			path: "sections/main.liquid",
			contents: "{{ product.metafields.custom.missing }}",
		},
	];
	const graph = inspectNazareTheme(files, {
		metafields: {
			path: ".shopify/metafields.json",
			contents: JSON.stringify([
				{
					owner: "product",
					namespace: "custom",
					key: "subtitle",
					type: "single_line_text_field",
				},
			]),
		},
	});
	assert.equal(hasIssue(graph, "THEME_METAFIELD_UNRESOLVED"), true);
	assert.equal(
		graph.nodes.some(
			(node) => node.kind === "metafieldDefinition" && node.key === "subtitle",
		),
		true,
	);
	assert.equal(
		graph.edges.some((edge) => edge.kind === "resolvesMetafieldDefinition"),
		true,
	);
	assert.equal(
		graph.edges.some((edge) => edge.kind === "missingMetafieldDefinition"),
		true,
	);
	assert.equal(graph.metafields.consumedDefinitionIds.length, 1);
	assert.equal(graph.metafields.brokenReadIds.length, 1);
	assert.equal(graph.metafields.unconsumedDefinitionIds.length, 0);
});

test("metafield definitions inherit affected pages through theme dependencies", () => {
	const graph = inspectNazareTheme(
		[
			{
				path: "templates/product.json",
				contents: JSON.stringify({
					sections: { main: { type: "main-product" } },
				}),
			},
			{
				path: "sections/main-product.liquid",
				contents: "{% render 'price' %}",
			},
			{
				path: "snippets/price.liquid",
				contents: "{{ product.metafields.custom.subtitle }}",
			},
		],
		{
			metafields: {
				contents: JSON.stringify([
					{ owner: "product", namespace: "custom", key: "subtitle" },
				]),
			},
		},
	);
	const definitionId = "metafield:product:custom:subtitle";
	assert.deepEqual(graph.impact.affectedPages[definitionId], [
		"templates/product.json",
	]);
	assert.ok(
		graph.impact.dependents[definitionId].includes("snippets/price.liquid"),
	);
});

test("metafield parser does not infer arbitrary nested objects", () => {
	const graph = inspectNazareTheme(
		[
			{
				path: "snippets/card.liquid",
				contents: "{{ product.metafields.custom.subtitle }}",
			},
		],
		{
			metafields: {
				contents: JSON.stringify({
					settings: { custom: { subtitle: { enabled: true } } },
				}),
			},
		},
	);
	assert.equal(graph.metafields.consumedDefinitionIds.length, 0);
	assert.equal(graph.metafields.brokenReadIds.length, 1);
});

test("global metafield reads keep owner unknown", () => {
	const graph = inspectNazareTheme(
		[
			{
				path: "snippets/card.liquid",
				contents: "{{ metafields.custom.subtitle }}",
			},
		],
		{
			metafields: {
				contents: JSON.stringify([
					{ owner: "product", namespace: "custom", key: "subtitle" },
				]),
			},
		},
	);
	assert.equal(graph.metafields.consumedDefinitionIds.length, 0);
	assert.equal(
		graph.nodes.some(
			(node) => node.kind === "metafieldRead" && node.owner === "unknown",
		),
		true,
	);
});

test("metafield parser accepts nested owner maps and normalizes owner types", () => {
	const graph = inspectNazareTheme(
		[
			{
				path: "snippets/card.liquid",
				contents: "{{ product.metafields.custom.subtitle }}",
			},
		],
		{
			metafields: {
				contents: JSON.stringify({
					PRODUCT: {
						custom: { subtitle: { type: { name: "single_line_text_field" } } },
					},
				}),
			},
		},
	);
	assert.equal(graph.metafields.brokenReadIds.length, 0);
	assert.equal(
		graph.nodes.some(
			(node) => node.kind === "metafieldDefinition" && node.owner === "product",
		),
		true,
	);
});

test("missing metafield snapshot keeps schema state unknown", () => {
	const graph = inspectNazareTheme([
		{
			path: "snippets/card.liquid",
			contents: "{{ product.metafields.custom.subtitle }}",
		},
	]);
	assert.equal(
		graph.issues.some((issue) => issue.code === "THEME_METAFIELD_UNRESOLVED"),
		false,
	);
	assert.equal(
		graph.nodes.some(
			(node) => node.kind === "storeSchema" && node.state === "unknown",
		),
		true,
	);
	assert.equal(graph.metafields.state, "unknown");
	assert.deepEqual(graph.metafields.unconsumedDefinitionIds, []);
});

test("buildNazareThemeWorkspace reports invalid file scopes", () => {
	const missing = buildNazareThemeWorkspace([], {
		scope: { kind: "file", path: "missing.nz.liquid" },
	});
	assert.equal(hasIssue(missing, "THEME_SCOPE_FILE_NOT_FOUND"), true);
	assert.deepEqual(missing.artifacts, []);
	assert.deepEqual(missing.emitted.files, []);

	const unsupported = buildNazareThemeWorkspace(
		[{ path: "sections/main.liquid", contents: "<section>Main</section>" }],
		{ scope: { kind: "file", path: "sections/main.liquid" } },
	);
	assert.equal(
		hasIssue(unsupported, "THEME_SCOPE_UNSUPPORTED_FILE_KIND"),
		true,
	);
	assert.deepEqual(unsupported.artifacts, []);
	assert.deepEqual(unsupported.emitted.files, []);
});

test("buildNazareThemeWorkspace file scope emits only its import closure", () => {
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

	assert.equal(scoped.artifacts.length, 1);
	assert.equal(hasIssue(scoped, "IMPORT_NOT_FOUND"), false);
	assert.ok(
		scoped.emitted.files.some((file) => file.path === "snippets/a.liquid"),
	);
});

test("closure scope emits every imported component output", () => {
	const built = buildNazareThemeWorkspace(
		[
			{
				path: "entry.nz.liquid",
				contents:
					'{% import Child from "./child.nz.liquid" %}<div>{% render Child {} %}</div>',
			},
			{ path: "child.nz.liquid", contents: "<span>Child</span>" },
		],
		{ scope: { kind: "closure", path: "entry.nz.liquid" }, name: "entry" },
	);
	assert.deepEqual(built.emitted.files.map((file) => file.path).sort(), [
		"snippets/child.liquid",
		"snippets/entry.liquid",
	]);
	assert.equal(hasIssue(built, "THEME_UNRESOLVED_REFERENCE"), false);
});

test("workspace strictly checks plain Liquid and component scripts before emit", () => {
	const liquid = buildNazareThemeWorkspace([
		{ path: "sections/broken.liquid", contents: "{% if %}" },
		{ path: "valid.nz.liquid", contents: "<span>Valid</span>" },
	]);
	assert.equal(hasIssue(liquid, "NAZARE_PARSE_LIQUID"), true);
	assert.deepEqual(liquid.emitted.files, []);

	const scripts = buildNazareThemeWorkspace([
		{
			path: "invalid.nz.liquid",
			contents:
				'<div ref="panel"></div>{% script lang="ts" %}export default island(({ refs }) => { refs.panel.disabled = true; });{% endscript %}',
		},
	]);
	assert.equal(hasIssue(scripts, "SCRIPT_TYPE_ERROR"), true);
	assert.deepEqual(scripts.emitted.files, []);
});

test("invalid script emission is an error and clean-only output is empty", () => {
	const built = buildNazareThemeWorkspace([
		{
			path: "invalid.nz.liquid",
			contents: "{% script %}console.log('missing export'){% endscript %}",
		},
	]);
	assert.equal(hasIssue(built, "EMIT_SCRIPT_WITHOUT_DEFAULT_EXPORT"), true);
	assert.deepEqual(built.emitted.files, []);
});

test("workspace errors prevent all default emission", () => {
	const built = buildNazareThemeWorkspace([
		{ path: "snippets/valid.nz.liquid", contents: "{% component snippet %}ok" },
		{ path: "templates/index.json", contents: "{" },
	]);

	assert.equal(hasIssue(built, "THEME_JSON_PARSE_ERROR"), true);
	assert.deepEqual(built.emitted.files, []);
	assert.equal(built.emittedOnError, false);
});
