import assert from "node:assert/strict";
import test from "node:test";
import {
	computeNazareTheme,
	getThemeFileImpact,
	getThemeFileImpacts,
	inspectNazareTheme,
	ThemeProgram,
} from "../dist/index.js";

const files = [
	{
		path: "templates/product.json",
		contents: JSON.stringify({
			sections: { main: { type: "main-product" } },
			order: ["main"],
		}),
	},
	{
		path: "sections/main-product.liquid",
		contents:
			'{% render \'card\', product: product %}{% schema %}{"name":"Main product"}{% endschema %}',
	},
	{
		path: "snippets/card.liquid",
		contents: "{{ product.title }}",
	},
];

test("computation owns direct queries and lazily projects the public graph", () => {
	const computation = computeNazareTheme(files);
	const direct = computation.getFileImpact("snippets/card.liquid");
	const graph = computation.toInspectGraph();
	assert.deepEqual(direct, getThemeFileImpact(graph, "snippets/card.liquid"));
	assert.deepEqual(computation.getFileImpacts(), getThemeFileImpacts(graph));
	assert.strictEqual(computation.toInspectGraph(), graph);
	assert.deepEqual(graph, inspectNazareTheme(files));
	assert.equal(
		graph.nodes.some((node) => node.kind === "renderSite"),
		false,
	);
	assert.ok(
		graph.edges.some(
			(edge) =>
				edge.kind === "renders" &&
				edge.from === "file:sections/main-product.liquid" &&
				edge.to === "file:snippets/card.liquid",
		),
	);
	assert.deepEqual(computation.getRenderOccurrences("snippets/card.liquid"), [
		{
			id: computation.model.renderSites[0].id,
			fromPath: "sections/main-product.liquid",
			targetPath: "snippets/card.liquid",
			targetName: "card",
			invocationKind: "render",
			span: computation.model.renderSites[0].span,
		},
	]);
	const referenceId = computation.model.references[0].id;
	assert.ok(computation.getEvidence(referenceId).length > 0);
});

test("metafield impact joins definitions, readers, and affected pages", () => {
	const computation = computeNazareTheme(
		[
			{
				path: "templates/product.json",
				contents: JSON.stringify({ sections: { main: { type: "main" } } }),
			},
			{
				path: "sections/main.liquid",
				contents: "{{ product.metafields.custom.subtitle }}",
			},
		],
		{
			metafields: {
				path: ".shopify/metafields.json",
				contents: JSON.stringify({
					product: [
						{
							namespace: "custom",
							key: "subtitle",
							type: "single_line_text_field",
						},
					],
				}),
			},
		},
	);
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "subtitle",
	});
	assert.equal(impact.definition.type, "single_line_text_field");
	assert.deepEqual(impact.affectedSources, ["sections/main.liquid"]);
	assert.deepEqual(impact.affectedPages, ["templates/product.json"]);
	assert.equal(impact.certainty, "complete");
	assert.deepEqual(impact.uncertainty, []);
	assert.deepEqual(impact.uncertainSources, []);
});

test("metafield impact indexes JSON template dynamic-source settings", () => {
	const templatePath = "templates/product.json";
	const computation = computeNazareTheme(
		[
			{
				path: templatePath,
				contents: `/* Shopify generated */\n${JSON.stringify(
					{
						sections: {
							main: {
								type: "main",
								settings: {
									source: "{{ product.metafields.custom.subtitle.value }}",
								},
								blocks: {
									text: {
										type: "text",
										settings: {
											source:
												'{{ product.metafields.custom["subtitle"] | metafield_tag }}',
										},
									},
								},
								description:
									"{{ product.metafields.custom.must_not_be_scanned }}",
							},
						},
					},
					null,
					2,
				)}`,
			},
		],
		{
			metafields: {
				path: ".shopify/metafields.json",
				contents: JSON.stringify({
					product: [{ namespace: "custom", key: "subtitle" }],
				}),
			},
		},
	);
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "subtitle",
	});
	assert.equal(impact.reads.length, 2);
	assert.deepEqual(impact.affectedSources, [templatePath]);
	assert.deepEqual(impact.affectedPages, [templatePath]);
	assert.ok(impact.reads.every((read) => read.fromPath === templatePath));
	const accesses = impact.reads.map((read) =>
		computation.model.dataAccesses.find(
			(access) => access.id === read.dataAccessId,
		),
	);
	assert.ok(accesses.every((access) => access.span?.file === templatePath));
	assert.equal(
		computation.model.metafieldReads.some(
			(read) => read.key === "must_not_be_scanned",
		),
		false,
	);
});

test("malformed JSON template dynamic sources are explicit uncertainty", () => {
	const templatePath = "templates/product.json";
	const computation = computeNazareTheme(
		[
			{
				path: templatePath,
				contents: JSON.stringify({
					sections: {
						main: {
							type: "main",
							settings: {
								source: "{{ product.metafields[namespace][key] }}",
							},
						},
					},
				}),
			},
		],
		{
			metafields: {
				path: ".shopify/metafields.json",
				contents: JSON.stringify({ product: [] }),
			},
		},
	);
	assert.equal(
		computation.model.issues.some(
			(issue) => issue.code === "THEME_JSON_METAFIELD_SOURCE_INVALID",
		),
		true,
	);
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "subtitle",
	});
	assert.equal(impact.certainty, "partial");
	assert.equal(impact.uncertainSources[0].path, templatePath);
	assert.match(impact.uncertainSources[0].reasons[0], /Unsupported metafield/);
});

test("metafield impact warns when a Shopify definition pull may be truncated", () => {
	const definitions = Array.from({ length: 250 }, (_, index) => ({
		namespace: "custom",
		key: `field_${index}`,
	}));
	const computation = computeNazareTheme([], {
		metafields: {
			path: ".shopify/metafields.json",
			contents: JSON.stringify({ product: definitions, article: [] }),
		},
	});
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "field_0",
	});
	assert.equal(impact.snapshot.state, "present");
	assert.equal(impact.certainty, "partial");
	assert.match(impact.uncertainty[0], /exactly 250 product definitions/);
	assert.equal(
		computation.model.issues.some(
			(issue) => issue.code === "THEME_METAFIELDS_POSSIBLY_TRUNCATED",
		),
		true,
	);
});

test("metafield impact reports unavailable definitions", () => {
	const computation = computeNazareTheme([
		{
			path: "snippets/card.liquid",
			contents: "{{ product.metafields.custom.subtitle }}",
		},
	]);
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "subtitle",
	});
	assert.equal(impact.definition, null);
	assert.equal(impact.snapshot.state, "unknown");
	assert.equal(impact.certainty, "partial");
	assert.match(impact.uncertainty[0], /definitions are unavailable/);
});

test("ThemeProgram keeps graph projection lazy until a graph caller opts in", () => {
	const program = new ThemeProgram(files);
	const changed = files.map((file) =>
		file.path === "snippets/card.liquid"
			? { ...file, contents: "{{ product.title }} {{ product.price }}" }
			: file,
	);
	const semanticUpdate = program.updateFile(changed[2]);
	assert.equal(semanticUpdate.graph, undefined);
	assert.equal(semanticUpdate.telemetry.graphRecordsReplaced, 0);
	assert.deepEqual(program.getGraph(), inspectNazareTheme(changed));

	const second = { ...changed[2], contents: "{{ product.handle }}" };
	const graphUpdate = program.updateFile(second);
	assert.ok(graphUpdate.graph);
	assert.equal(graphUpdate.telemetry.graphRecordsReplaced, 0);
});

test("direct impact queries do not require a public graph snapshot", () => {
	const computation = computeNazareTheme(files);
	assert.deepEqual(
		computation.getImpactSummary().affectedPages["snippets/card.liquid"],
		["templates/product.json"],
	);
	assert.equal(
		computation.getFileImpact("snippets/card.liquid")?.usage,
		"used",
	);
	assert.equal(computation.getFileImpact("missing.liquid"), undefined);
});
