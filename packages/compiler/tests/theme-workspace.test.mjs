import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeNazareTheme,
	buildNazareThemeWorkspace,
	getThemeAffectedPages,
	getThemeDependencies,
	getThemeNode,
	inspectNazareTheme,
	shareThemeGraphRecords,
	summarizeThemeGraph,
	ThemeBuildSession,
	ThemeFactIndex,
	ThemeFactStore,
	ThemeImpactIndex,
	ThemeMetafieldIndex,
	ThemeResolverIndex,
	ThemeSemanticStore,
	ThemeWorkspaceSession,
	themeGraphToDot,
} from "../dist/index.js";

const hasIssue = (result, code) =>
	result.issues.some((issue) => issue.code === code);

test("impact index propagates dependencies to pages", () => {
	const graph = inspectNazareTheme([
		{
			path: "templates/index.json",
			contents: JSON.stringify({ sections: { main: { type: "main" } } }),
		},
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "Card" },
	]);
	const index = new ThemeImpactIndex(graph);
	assert.ok(
		index
			.getDependencies("sections/main.liquid")
			.includes("snippets/card.liquid"),
	);
	assert.ok(
		index
			.getDependents("snippets/card.liquid")
			.includes("sections/main.liquid"),
	);
	assert.deepEqual(index.getAffectedPages("snippets/card.liquid"), [
		"templates/index.json",
	]);
});

test("metafield index serves reads by definition", () => {
	const model = analyzeNazareTheme(
		[
			{
				path: "snippets/card.liquid",
				contents:
					"{{ product.metafields.custom.subtitle }} {{ product.metafields.custom.missing }}",
			},
		],
		{
			metafields: {
				path: ".shopify/metafields.json",
				contents: JSON.stringify([
					{
						owner: "product",
						namespace: "custom",
						key: "subtitle",
						type: "single_line_text_field",
					},
					{ owner: "product", namespace: "custom", key: "unused" },
				]),
			},
		},
	).ir;
	const index = new ThemeMetafieldIndex(model);
	const definition = model.metafieldDefinitions[0];
	assert.ok(definition);
	assert.equal(index.getReads(definition.id).length, 1);
	assert.deepEqual(index.getAffectedSources(definition.id), [
		"snippets/card.liquid",
	]);
	assert.deepEqual(index.getConsumedDefinitionIds(), [definition.id]);
	assert.deepEqual(index.getUnconsumedDefinitionIds(), [
		"metafield:product:custom:unused",
	]);
	assert.equal(index.getBrokenReadIds().length, 1);
});

test("resolver index serves declaration dependents", () => {
	const model = analyzeNazareTheme([
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "Card" },
	]).ir;
	const index = new ThemeResolverIndex(model);
	const declarationId = index.getDeclarations("snippet:card")[0];
	assert.ok(declarationId);
	assert.deepEqual(index.getDependents(declarationId), [
		"sections/main.liquid",
	]);
	assert.equal(
		index
			.resolveModel(model)
			.references.find((reference) => reference.kind === "rendersSnippet")
			?.resolvedDeclarationId,
		declarationId,
	);
});

test("graph projection shares unchanged nodes and edges", () => {
	const first = inspectNazareTheme([
		{ path: "snippets/card.liquid", contents: "Card" },
	]);
	const second = inspectNazareTheme([
		{ path: "snippets/card.liquid", contents: "Card" },
		{ path: "assets/new.css", contents: ".new {}" },
	]);
	const shared = shareThemeGraphRecords(first, second);
	const firstFile = first.nodes.find(
		(node) => node.id === "file:snippets/card.liquid",
	);
	const sharedFile = shared.nodes.find(
		(node) => node.id === "file:snippets/card.liquid",
	);
	assert.equal(sharedFile, firstFile);
});

test("semantic transaction shares unchanged identified records", () => {
	const first = analyzeNazareTheme([
		{ path: "sections/main.liquid", contents: "<section>Main</section>" },
	]);
	const second = analyzeNazareTheme([
		{ path: "sections/main.liquid", contents: "<section>Main</section>" },
		{ path: "assets/new.css", contents: ".new {}" },
	]);
	const store = new ThemeSemanticStore(first.ir);
	const transaction = store.beginUpdate(second.ir);
	const update = transaction.commit();
	assert.equal(
		update.model.files.find((file) => file.path === "sections/main.liquid"),
		first.ir.files.find((file) => file.path === "sections/main.liquid"),
	);
});

test("fact index replaces declarations and dependents transactionally", () => {
	const index = new ThemeFactIndex([
		{ kind: "declaresSnippet", path: "snippets/card.liquid", name: "card" },
		{
			kind: "rendersSnippet",
			fromPath: "sections/main.liquid",
			siteId: "main@1:1",
			invocationKind: "render",
			static: true,
			targetName: "card",
		},
	]);
	assert.deepEqual(index.getDeclarations("snippet:card"), [
		"snippets/card.liquid",
	]);
	assert.deepEqual(index.getDependents("snippet:card"), [
		"sections/main.liquid",
	]);
	assert.deepEqual(index.dependentsOfFiles(["snippets/card.liquid"]), [
		"sections/main.liquid",
		"snippets/card.liquid",
	]);
	index.replaceFileFacts("sections/main.liquid", []);
	assert.deepEqual(index.getDependents("snippet:card"), []);
});

test("fact store replaces only one source bucket", () => {
	const store = new ThemeFactStore([
		{ kind: "file", path: "a.liquid", fileKind: "other" },
		{
			kind: "rendersSnippet",
			fromPath: "a.liquid",
			siteId: "a@1:1",
			invocationKind: "render",
			static: true,
			targetName: "card",
		},
		{ kind: "file", path: "b.liquid", fileKind: "other" },
	]);
	store.replaceFile("a.liquid", [
		{ kind: "file", path: "a.liquid", fileKind: "other" },
	]);
	assert.deepEqual(store.files(), ["a.liquid", "b.liquid"]);
	assert.equal(store.getFile("a.liquid").length, 1);
	assert.equal(store.all().length, 2);
});

test("build session reports emitted output deltas", () => {
	const session = new ThemeBuildSession([
		{ path: "card.nz.liquid", contents: "<span>Card</span>" },
	]);
	const unchanged = session.updateFile({
		path: "card.nz.liquid",
		contents: "<span>Card</span>",
	});
	assert.equal(unchanged.revision, 0);
	const changed = session.updateFile({
		path: "card.nz.liquid",
		contents: "<span>Updated</span>",
	});
	assert.equal(changed.revision, 1);
	assert.deepEqual(changed.changedPaths, ["card.nz.liquid"]);
	assert.deepEqual(changed.recomputedPaths, ["card.nz.liquid"]);
	assert.ok(changed.changedOutputPaths.length > 0);
});

test("semantic model memo reuses unchanged resolved models", () => {
	const memo = {};
	const files = [{ path: "snippets/card.liquid", contents: "Card" }];
	const first = analyzeNazareTheme(files, { memo });
	const second = analyzeNazareTheme(files, { memo });
	assert.equal(first.ir, second.ir);
});

test("component artifacts reuse only affected dependency cache entries", () => {
	const cache = { version: 1, entries: {} };
	const firstFiles = [
		{ path: "card.nz.liquid", contents: "<span>Card</span>" },
		{ path: "other.nz.liquid", contents: "<span>Other</span>" },
	];
	analyzeNazareTheme(firstFiles, { cache });
	const otherFingerprint = cache.entries["other.nz.liquid"].fingerprint;
	const second = analyzeNazareTheme(
		[
			{ path: "card.nz.liquid", contents: "<span>Updated</span>" },
			firstFiles[1],
		],
		{ cache },
	);
	assert.equal(second.artifacts.length, 2);
	assert.equal(cache.entries["other.nz.liquid"].fingerprint, otherFingerprint);
	assert.ok(cache.entries["other.nz.liquid"].artifact);
});

test("theme graph DOT projection escapes identifiers and labels", () => {
	const graph = inspectNazareTheme([
		{ path: "snippets/card.liquid", contents: "Card" },
	]);
	const dot = themeGraphToDot(graph);
	assert.match(dot, /^digraph nazare_theme/);
	assert.match(dot, /snippet: card/);
	assert.match(dot, /file:snippets\/card\.liquid/);
});

test("incremental graph replay equals full rebuild", () => {
	let files = [
		{
			path: "templates/index.json",
			contents: JSON.stringify({ sections: { main: { type: "main" } } }),
		},
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "Card" },
	];
	const session = new ThemeWorkspaceSession(files);
	const edits = [
		{ path: "snippets/card.liquid", contents: "Updated" },
		{ path: "snippets/extra.liquid", contents: "Extra" },
	];
	for (const edit of edits) {
		files = [...files.filter((file) => file.path !== edit.path), edit];
		session.updateFile(edit);
		assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
	}
	files = files.filter((file) => file.path !== "snippets/card.liquid");
	session.removeFile("snippets/card.liquid");
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
});

test("workspace scheduler preserves unresolved and resolved reference transitions", () => {
	let files = [
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
	];
	const session = new ThemeWorkspaceSession(files);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));

	const card = { path: "snippets/card.liquid", contents: "Card" };
	files = [...files, card];
	const resolved = session.updateFile(card);
	assert.ok(resolved.addedNodeIds.includes("file:snippets/card.liquid"));
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));

	files = files.filter((file) => file.path !== card.path);
	const unresolved = session.removeFile(card.path);
	assert.ok(unresolved.removedNodeIds.includes("file:snippets/card.liquid"));
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
});

test("workspace scheduler preserves resolved and ambiguous transitions", () => {
	let files = [
		{ path: "sections/main.liquid", contents: "{% render 'button' %}" },
		{ path: "snippets/button.liquid", contents: "Button" },
	];
	const session = new ThemeWorkspaceSession(files);
	assert.equal(
		hasIssue(session.getGraph(), "THEME_AMBIGUOUS_REFERENCE"),
		false,
	);

	const duplicate = {
		path: "components/button.nz.liquid",
		contents: "<button>NZ</button>",
	};
	files = [...files, duplicate];
	session.updateFile(duplicate);
	assert.equal(hasIssue(session.getGraph(), "THEME_AMBIGUOUS_REFERENCE"), true);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));

	files = files.filter((file) => file.path !== duplicate.path);
	session.removeFile(duplicate.path);
	assert.equal(
		hasIssue(session.getGraph(), "THEME_AMBIGUOUS_REFERENCE"),
		false,
	);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
});

test("workspace scheduler treats declaration rename as delete plus add", () => {
	let files = [
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "Card" },
	];
	const session = new ThemeWorkspaceSession(files);

	files = files.filter((file) => file.path !== "snippets/card.liquid");
	session.removeFile("snippets/card.liquid");
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));

	const tile = { path: "snippets/tile.liquid", contents: "Tile" };
	files = [...files, tile];
	session.updateFile(tile);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));

	const caller = {
		path: "sections/main.liquid",
		contents: "{% render 'tile' %}",
	};
	files = [...files.filter((file) => file.path !== caller.path), caller];
	session.updateFile(caller);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
	assert.equal(
		hasIssue(session.getGraph(), "THEME_UNRESOLVED_REFERENCE"),
		false,
	);
});

test("workspace scheduler replaces schema and setting records by source", () => {
	let files = [
		{
			path: "sections/main.liquid",
			contents:
				'{{ block.settings.heading }}{% schema %}{"blocks":[{"type":"feature","settings":[{"type":"text","id":"heading"}]}]}{% endschema %}',
		},
	];
	const session = new ThemeWorkspaceSession(files);
	const updated = {
		path: "sections/main.liquid",
		contents:
			'{{ block.settings.title }}{% schema %}{"blocks":[{"type":"feature","settings":[{"type":"text","id":"title"}]}]}{% endschema %}',
	};
	files = [updated];
	session.updateFile(updated);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
	assert.equal(
		hasIssue(session.getGraph(), "THEME_UNRESOLVED_SETTING_READ"),
		false,
	);
	assert.equal(
		session.getGraph().nodes.some((node) => node.id.includes(":heading")),
		false,
	);
});

test("workspace scheduler replaces section and block instances by source", () => {
	let files = [
		{
			path: "templates/index.json",
			contents: JSON.stringify({
				sections: {
					hero: {
						type: "main",
						blocks: { copy: { type: "text" } },
					},
				},
				order: ["hero"],
			}),
		},
		{
			path: "sections/main.liquid",
			contents:
				'{% schema %}{"blocks":[{"type":"text","name":"Text"}]}{% endschema %}',
		},
		{ path: "sections/alternate.liquid", contents: "Alternate" },
	];
	const session = new ThemeWorkspaceSession(files);
	const updated = {
		path: "templates/index.json",
		contents: JSON.stringify({
			sections: { hero: { type: "alternate" } },
			order: ["hero"],
		}),
	};
	files = [...files.filter((file) => file.path !== updated.path), updated];
	session.updateFile(updated);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
	assert.equal(
		session.getGraph().nodes.some((node) => node.id.includes(":copy")),
		false,
	);
});

test("workspace scheduler replaces locale keys and references by source", () => {
	let files = [
		{
			path: "locales/en.default.json",
			contents: JSON.stringify({ general: { hello: "Hello" } }),
		},
		{
			path: "sections/main.liquid",
			contents: "{{ 'general.hello' | t }}",
		},
	];
	const session = new ThemeWorkspaceSession(files);
	const locale = {
		path: "locales/en.default.json",
		contents: JSON.stringify({ general: { goodbye: "Goodbye" } }),
	};
	files = [...files.filter((file) => file.path !== locale.path), locale];
	session.updateFile(locale);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
	assert.equal(
		hasIssue(session.getGraph(), "THEME_UNRESOLVED_LOCALE_KEY"),
		true,
	);

	const section = {
		path: "sections/main.liquid",
		contents: "{{ 'general.goodbye' | t }}",
	};
	files = [...files.filter((file) => file.path !== section.path), section];
	session.updateFile(section);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
	assert.equal(
		hasIssue(session.getGraph(), "THEME_UNRESOLVED_LOCALE_KEY"),
		false,
	);
});

test("workspace scheduler replaces data-flow inputs by source", () => {
	let files = [
		{ path: "snippets/card.liquid", contents: "{{ title }}" },
		{
			path: "sections/main.liquid",
			contents: "{% render 'card', title: section.settings.title %}",
		},
	];
	const session = new ThemeWorkspaceSession(files);
	const snippet = {
		path: "snippets/card.liquid",
		contents: "{{ subtitle }}",
	};
	files = [...files.filter((file) => file.path !== snippet.path), snippet];
	session.updateFile(snippet);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
	assert.equal(
		session.getGraph().nodes.some((node) => node.id.includes(":title")),
		true,
	);
	assert.equal(
		session.getGraph().nodes.some((node) => node.id.includes(":subtitle")),
		true,
	);
});

test("workspace fixed-point data flow matches cold rebuild for render cycles", () => {
	let files = [
		{
			path: "snippets/a.liquid",
			contents: "{{ value }}{% render 'b', value: value %}",
		},
		{
			path: "snippets/b.liquid",
			contents: "{{ value }}{% render 'a', value: value %}",
		},
	];
	const session = new ThemeWorkspaceSession(files);
	const updated = {
		path: "snippets/b.liquid",
		contents: "{{ value.title }}{% render 'a', value: value %}",
	};
	files = [...files.filter((file) => file.path !== updated.path), updated];
	session.updateFile(updated);
	assert.deepEqual(session.getGraph(), inspectNazareTheme(files));
});

test("workspace rolls back a fixed-point work-budget failure", () => {
	const files = [
		{ path: "snippets/a.liquid", contents: "{% render 'b' %}" },
		{ path: "snippets/b.liquid", contents: "{% render 'a' %}" },
	];
	const session = new ThemeWorkspaceSession(files);
	const previousGraph = session.getGraph();
	const updated = {
		path: "snippets/a.liquid",
		contents: "{{ value }}{% render 'b' %}",
	};
	session.collectionScheduler.maximumFixedPointWork = 1;
	assert.throws(() => session.updateFile(updated), /after 1 work units/);
	assert.equal(session.getGraph(), previousGraph);
	session.collectionScheduler.maximumFixedPointWork = 100_000;
	const result = session.updateFile(updated);
	assert.equal(result.revision, 1);
	assert.deepEqual(session.getGraph(), inspectNazareTheme([files[1], updated]));
});

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
	assert.deepEqual(session.getAffectedPages("snippets/card.liquid"), [
		"templates/index.json",
	]);
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
	const external = session.updateExternalArtifacts({
		metafields: undefined,
		themeCheck: undefined,
	});
	assert.equal(external.revision, 1);
	assert.deepEqual(external.changedPaths, []);
	const policyAdded = session.updateExternalArtifacts({
		metafields: undefined,
		themeCheck: { path: ".theme-check.yml", contents: "ignore: []" },
	});
	assert.deepEqual(policyAdded.changedPaths, [".theme-check.yml"]);
	const policyRemoved = session.updateExternalArtifacts({
		metafields: undefined,
		themeCheck: undefined,
	});
	assert.deepEqual(policyRemoved.changedPaths, [".theme-check.yml"]);
	const removed = session.removeFile("snippets/card.liquid");
	assert.equal(removed.revision, 4);
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

test("workspace seeds snapshot-only metafield updates without reparsing Liquid", () => {
	const files = [
		{
			path: "sections/main.liquid",
			contents: "{{ product.metafields.custom.subtitle }}",
		},
	];
	const session = new ThemeWorkspaceSession(files);
	const cached = session.cache.entries["sections/main.liquid"];
	const metafields = {
		contents: JSON.stringify([
			{ owner: "product", namespace: "custom", key: "subtitle" },
		]),
	};
	const update = session.updateExternalArtifacts({ metafields });
	assert.equal(update.changedPaths.includes(".shopify/metafields.json"), true);
	assert.strictEqual(session.cache.entries["sections/main.liquid"], cached);
	assert.deepEqual(
		session.getGraph(),
		inspectNazareTheme(files, { metafields }),
	);
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
