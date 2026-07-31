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
									source:
										"<p>{{ product.metafields.custom.subtitle.value }}</p><p>{{ product.metafields.custom.subtitle | metafield_tag }}</p>",
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
	assert.equal(impact.reads.length, 3);
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
		new Set(
			accesses.map(
				(access) =>
					`${access.span.start.line}:${access.span.start.column}-${access.span.end.line}:${access.span.end.column}`,
			),
		).size,
		3,
	);
	assert.equal(
		computation.model.metafieldReads.some(
			(read) => read.key === "must_not_be_scanned",
		),
		false,
	);
});

test("JSON dynamic sources resolve section and block resource-setting owners", () => {
	const templatePath = "templates/product.json";
	const computation = computeNazareTheme(
		[
			{
				path: "sections/main.liquid",
				contents: `{% schema %}{
					"name":"Main",
					"settings":[{"type":"product","id":"featured_product"}],
					"blocks":[{"type":"step","name":"Step","settings":[{"type":"product","id":"block_product"}]}]
				}{% endschema %}`,
			},
			{
				path: templatePath,
				contents: JSON.stringify({
					sections: {
						main: {
							type: "main",
							settings: {
								source:
									"{{ section.settings.featured_product.metafields.custom.subtitle.value }}",
							},
							blocks: {
								step: {
									type: "step",
									settings: {
										source:
											"{{ block.settings.block_product.metafields.custom.subtitle.value }}",
									},
								},
							},
						},
					},
				}),
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
	assert.equal(impact.certainty, "complete");
	assert.ok(impact.reads.every((read) => read.owner === "product"));
});

test("resource-setting metafield owners remain uncertain without a resource type", () => {
	const path = "sections/main.liquid";
	const computation = computeNazareTheme(
		[
			{
				path,
				contents: `{{ section.settings.featured.metafields.custom.subtitle }}
{% schema %}{"name":"Main","settings":[{"type":"text","id":"featured"}]}{% endschema %}`,
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
	assert.equal(impact.reads.length, 0);
	assert.equal(impact.certainty, "partial");
	assert.equal(impact.uncertainSources[0].path, path);
});

test("settings_data metafield sources affect every theme page", () => {
	const computation = computeNazareTheme(
		[
			{
				path: "templates/index.json",
				contents: JSON.stringify({ sections: {} }),
			},
			{
				path: "templates/product.json",
				contents: JSON.stringify({ sections: {} }),
			},
			{
				path: "sections/promo.liquid",
				contents: `{% schema %}{"name":"Promo","settings":[{"type":"product","id":"featured_product"}]}{% endschema %}`,
			},
			{
				path: "config/settings_data.json",
				contents: JSON.stringify({
					current: {
						sections: {
							promo: {
								type: "promo",
								settings: {
									source:
										"{{ section.settings.featured_product.metafields.custom.subtitle.value }}",
								},
							},
						},
					},
				}),
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
	assert.deepEqual(impact.affectedSources, ["config/settings_data.json"]);
	assert.deepEqual(impact.affectedPages, [
		"templates/index.json",
		"templates/product.json",
	]);
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

test("Liquid metafield paths normalize quoted keys and reject dynamic keys", () => {
	const path = "snippets/card.liquid";
	const computation = computeNazareTheme(
		[
			{
				path,
				contents: `{{ product.metafields.custom['2nd_description'].value }}
{{ product.metafields.custom[metafield_key] }}`,
			},
		],
		{
			metafields: {
				path: ".shopify/metafields.json",
				contents: JSON.stringify({
					product: [{ namespace: "custom", key: "2nd_description" }],
				}),
			},
		},
	);
	const staticImpact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "2nd_description",
	});
	assert.equal(staticImpact.reads.length, 1);
	assert.equal(staticImpact.reads[0].definitionId, staticImpact.definition.id);
	assert.equal(
		computation.model.metafieldReads.some(
			(read) => read.key === "metafield_key",
		),
		false,
	);
	assert.equal(staticImpact.certainty, "partial");
	assert.equal(staticImpact.uncertainSources[0].path, path);
	assert.match(
		staticImpact.uncertainSources[0].reasons[0],
		/Dynamic metafield/,
	);
});

test("dynamic metafield uncertainty is constrained by a proven owner", () => {
	const computation = computeNazareTheme(
		[
			{
				path: "sections/main.liquid",
				contents: `{{ product.metafields.custom.subtitle }}
{{ article.metafields.custom[dynamic_key] }}`,
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
	assert.equal(impact.certainty, "complete");
	assert.deepEqual(impact.uncertainSources, []);
});

test("metafield owner provenance follows assignments, loops, and render arguments", () => {
	const computation = computeNazareTheme(
		[
			{
				path: "sections/main.liquid",
				contents: `{% assign assigned_product = product %}
{{ assigned_product.metafields.custom.subtitle }}
{% for loop_product in collection.products %}{{ loop_product.metafields.custom.subtitle }}{% endfor %}
{% render 'card', item: product %}
{{ section.settings.featured_product.metafields.custom.subtitle }}
{{ block.settings.block_product.metafields.custom.subtitle }}
{% schema %}{
	"name":"Main",
	"settings":[{"type":"product","id":"featured_product"}],
	"blocks":[{"type":"step","name":"Step","settings":[{"type":"product","id":"block_product"}]}]
}{% endschema %}`,
			},
			{
				path: "snippets/card.liquid",
				contents: "{{ item.metafields.custom.subtitle }}",
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
	assert.equal(impact.reads.length, 5);
	assert.deepEqual(impact.affectedSources, [
		"sections/main.liquid",
		"snippets/card.liquid",
	]);
	assert.ok(impact.reads.every((read) => read.owner === "product"));
});

test("local JavaScript API calls and static GraphQL metafields respect the source boundary", () => {
	const computation = computeNazareTheme(
		[
			{
				path: "layout/theme.liquid",
				contents: `{{ 'theme.js' | asset_url | script_tag }}{{ content_for_layout }}`,
			},
			{
				path: "templates/product.liquid",
				contents: "{{ product.title }}",
			},
			{
				path: "templates/page.liquid",
				contents: "{% layout 'alternate' %}{{ page.title }}",
			},
			{
				path: "layout/alternate.liquid",
				contents: "{{ content_for_layout }}",
			},
			{
				path: "templates/gift_card.liquid",
				contents: "{% layout none %}{{ gift_card.balance }}",
			},
			{
				path: "assets/theme.js",
				contents: `const query = \`query ProductData {
	product(handle: "example") {
		metafield(namespace: "custom", key: "subtitle") { value }
	}
}\`;
fetch("/api/2025-01/graphql.json", {
	method: "POST",
	body: JSON.stringify({ query }),
});
fetch("/apps/recommendations", {
	method: "POST",
	body: JSON.stringify({ productId }),
});`,
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
	assert.equal(computation.model.networkAccesses.length, 2);
	assert.equal(
		computation.model.networkAccesses.filter(
			(access) => access.graphql === "static",
		).length,
		1,
	);
	assert.equal(
		computation.model.networkAccesses.filter(
			(access) => access.graphql === "none",
		).length,
		1,
	);
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "subtitle",
	});
	assert.equal(impact.version, 2);
	assert.equal(impact.apiReads.length, 1);
	assert.equal(impact.localNetworkAccessCount, 2);
	assert.deepEqual(impact.affectedSources, ["assets/theme.js"]);
	assert.deepEqual(impact.affectedPages, ["templates/product.liquid"]);
	assert.deepEqual(
		computation.getFileImpact("assets/theme.js").affectedPages,
		impact.affectedPages,
	);
	assert.deepEqual(
		computation.model.references
			.filter((reference) => reference.kind === "usesLayout")
			.map((reference) => ({
				path: reference.fromPath,
				selection: reference.layoutSelection,
				provenance: reference.provenance,
				target: reference.targetName,
			})),
		[
			{
				path: "templates/gift_card.liquid",
				selection: "none",
				provenance: "authored",
				target: undefined,
			},
			{
				path: "templates/page.liquid",
				selection: "named",
				provenance: "authored",
				target: "alternate",
			},
			{
				path: "templates/product.liquid",
				selection: "shopifyDefault",
				provenance: "shopifyDefault",
				target: "theme",
			},
		],
	);
	assert.equal(impact.certainty, "complete");
	assert.ok(impact.scope.excluded.includes("remoteAppRuntime"));
});

test("missing Shopify default layouts remain explicit unresolved relations", () => {
	const computation = computeNazareTheme([
		{ path: "templates/product.liquid", contents: "{{ product.title }}" },
	]);
	assert.deepEqual(
		computation.model.references.map((reference) => ({
			kind: reference.kind,
			selection: reference.layoutSelection,
			provenance: reference.provenance,
			resolved: reference.resolvedDeclarationId,
		})),
		[
			{
				kind: "usesLayout",
				selection: "shopifyDefault",
				provenance: "shopifyDefault",
				resolved: undefined,
			},
		],
	);
	assert.ok(
		computation.model.issues.some(
			(issue) =>
				issue.code === "THEME_UNRESOLVED_REFERENCE" &&
				issue.message.includes("layout reference theme"),
		),
	);
});

test("dynamic local GraphQL payloads are explicit metafield uncertainty", () => {
	const computation = computeNazareTheme(
		[
			{
				path: "assets/theme.js",
				contents: `fetch("/api/2025-01/graphql.json", {
	method: "POST",
	body: JSON.stringify({ query: buildQuery(namespace, key) }),
});`,
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
	assert.equal(impact.apiReads.length, 0);
	assert.equal(impact.certainty, "partial");
	assert.equal(impact.uncertainSources[0].path, "assets/theme.js");
	assert.match(impact.uncertainSources[0].reasons[0], /GraphQL identity/);
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

test("JavaScript metafield certainty fails closed when source parsing fails", () => {
	const computation = computeNazareTheme(
		[{ path: "assets/broken.js", contents: 'fetch("/graphql", {' }],
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
	assert.equal(impact.certainty, "partial");
	assert.equal(impact.uncertainSources[0].path, "assets/broken.js");
	assert.match(
		impact.uncertainSources[0].reasons[0],
		/javascript source analysis failed/,
	);
});

test("static GraphQL identifiers require immutable lexical bindings", () => {
	const query = `query { product(handle: "example") { metafield(namespace: "custom", key: "subtitle") { value } } }`;
	const computation = computeNazareTheme(
		[
			{
				path: "assets/theme.js",
				contents: `let query = ${JSON.stringify(query)};
query = buildQuery();
fetch("/graphql", { body: JSON.stringify({ query }) });
const outerQuery = ${JSON.stringify(query)};
function send(outerQuery) {
	fetch("/graphql", { body: JSON.stringify({ query: outerQuery }) });
}
function shadowGlobals(fetch, window, navigator, JSON) {
	fetch("/graphql", { body: JSON.stringify({ query: outerQuery }) });
	window.fetch("/graphql");
	navigator.sendBeacon("/graphql", outerQuery);
}`,
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
	assert.equal(computation.model.networkAccesses.length, 2);
	assert.ok(
		computation.model.networkAccesses.every(
			(access) => access.graphql === "dynamic",
		),
	);
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "subtitle",
	});
	assert.equal(impact.apiReads.length, 0);
	assert.equal(impact.certainty, "partial");
});

test("static GraphQL resolution distinguishes nested duplicate bindings", () => {
	const productQuery = `query { product(handle: "example") { metafield(namespace: "custom", key: "subtitle") { value } } }`;
	const articleQuery = `query { article(handle: "example") { metafield(namespace: "custom", key: "subtitle") { value } } }`;
	const computation = computeNazareTheme(
		[
			{
				path: "assets/theme.js",
				contents: `{
	const query = ${JSON.stringify(productQuery)};
	fetch("/graphql", { body: JSON.stringify({ query }) });
}
{
	const query = ${JSON.stringify(articleQuery)};
	fetch("/graphql", { body: JSON.stringify({ query }) });
}`,
			},
		],
		{
			metafields: {
				path: ".shopify/metafields.json",
				contents: JSON.stringify({
					product: [{ namespace: "custom", key: "subtitle" }],
					article: [{ namespace: "custom", key: "subtitle" }],
				}),
			},
		},
	);
	assert.equal(computation.model.networkAccesses.length, 2);
	assert.equal(
		computation.getMetafieldImpact({
			owner: "product",
			namespace: "custom",
			key: "subtitle",
		}).apiReads.length,
		1,
	);
	assert.equal(
		computation.getMetafieldImpact({
			owner: "article",
			namespace: "custom",
			key: "subtitle",
		}).apiReads.length,
		1,
	);
});

test("GraphQL clients require supported binding provenance", () => {
	const query = `query { product(handle: "example") { metafield(namespace: "custom", key: "subtitle") { value } } }`;
	const computation = computeNazareTheme(
		[
			{
				path: "assets/theme.js",
				contents: `import { GraphQLClient } from "graphql-request";
import { ApolloClient } from "@apollo/client";
import { createStorefrontApiClient } from "@shopify/storefront-api-client";
const query = ${JSON.stringify(query)};
const graphqlRequest = new GraphQLClient("/graphql");
const apollo = new ApolloClient({});
const storefront = createStorefrontApiClient({});
graphqlRequest.request(query);
graphqlRequest.request(buildQuery());
graphqlRequest.request("not a GraphQL document");
const transformedQuery = transform\`query { product(handle: "example") { metafield(namespace: "custom", key: "subtitle") { value } } }\`;
graphqlRequest.request(transformedQuery);
apollo.query({ query });
storefront.request(query);
database.query({ query });`,
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
	assert.equal(computation.model.networkAccesses.length, 6);
	assert.equal(
		computation.model.networkAccesses.filter(
			(access) => access.graphql === "static",
		).length,
		3,
	);
	assert.equal(
		computation.model.networkAccesses.filter(
			(access) => access.graphql === "dynamic",
		).length,
		2,
	);
	assert.equal(
		computation.model.networkAccesses.filter(
			(access) => access.graphql === "invalid",
		).length,
		1,
	);
	const impact = computation.getMetafieldImpact({
		owner: "product",
		namespace: "custom",
		key: "subtitle",
	});
	assert.equal(impact.apiReads.length, 3);
	assert.equal(impact.certainty, "partial");
});

test("GraphQL owner proof clears across unknown nested HasMetafields types", () => {
	const query = `query {
	product(handle: "example") {
		metafield(namespace: "custom", key: "subtitle") { value }
		media(first: 1) { nodes { ... on MediaImage { metafield(namespace: "custom", key: "image") { value } } } }
		variants(first: 1) { edges { node { metafield(namespace: "custom", key: "variant_note") { value } } } }
	}
	node(id: "gid://shopify/Product/1") { ...ProductFields }
}
fragment ProductFields on Product { metafield(namespace: "custom", key: "fragment_note") { value } }`;
	const computation = computeNazareTheme(
		[
			{
				path: "assets/theme.js",
				contents: `fetch("/graphql", { body: JSON.stringify({ query: ${JSON.stringify(query)} }) });`,
			},
		],
		{
			metafields: {
				path: ".shopify/metafields.json",
				contents: JSON.stringify({
					product: [
						{ namespace: "custom", key: "subtitle" },
						{ namespace: "custom", key: "image" },
						{ namespace: "custom", key: "fragment_note" },
					],
					variant: [{ namespace: "custom", key: "variant_note" }],
				}),
			},
		},
	);
	const access = computation.model.networkAccesses[0];
	assert.ok(
		access.metafieldReferences.some(
			(reference) =>
				reference.certainty === "exact" &&
				reference.owner === "product" &&
				reference.key === "subtitle",
		),
	);
	assert.ok(
		access.metafieldReferences.some(
			(reference) =>
				reference.certainty === "exact" &&
				reference.owner === "variant" &&
				reference.key === "variant_note",
		),
	);
	assert.ok(
		access.metafieldReferences.some(
			(reference) =>
				reference.certainty === "partial" &&
				reference.owner === undefined &&
				reference.key === "image",
		),
	);
	assert.equal(
		computation.getMetafieldImpact({
			owner: "product",
			namespace: "custom",
			key: "image",
		}).certainty,
		"partial",
	);
	assert.equal(
		computation.getMetafieldImpact({
			owner: "product",
			namespace: "custom",
			key: "fragment_note",
		}).apiReads.length,
		1,
	);
});

test("incremental JavaScript network facts converge with cold metafield impact", () => {
	const initial = [
		{ path: "assets/theme.js", contents: 'fetch("/apps/recommendations")' },
	];
	const options = {
		metafields: {
			path: ".shopify/metafields.json",
			contents: JSON.stringify({
				product: [{ namespace: "custom", key: "subtitle" }],
			}),
		},
	};
	const changed = {
		path: "assets/theme.js",
		contents: `const query = \`query { product(handle: "example") { metafield(namespace: "custom", key: "subtitle") { value } } }\`;
fetch("/api/graphql", { body: JSON.stringify({ query }) });`,
	};
	const program = new ThemeProgram(initial, options);
	program.updateFile(changed);
	const cold = computeNazareTheme([changed], options);
	assert.deepEqual(program.getModel(), cold.model);
	assert.deepEqual(
		program.getMetafieldImpact({
			owner: "product",
			namespace: "custom",
			key: "subtitle",
		}),
		cold.getMetafieldImpact({
			owner: "product",
			namespace: "custom",
			key: "subtitle",
		}),
	);
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
