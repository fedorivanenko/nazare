import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createShopifySemanticCompiler } from "../dist/index.js";

const fixtureRoot = new URL(
	"../../../fixtures/canonical-theme/",
	import.meta.url,
);
const paths = [
	"sections/collection-grid.liquid",
	"sections/featured-collection.liquid",
	"sections/main-product.liquid",
	"snippets/price.liquid",
	"snippets/product-card.liquid",
	"snippets/product-gallery.liquid",
	"snippets/recommendations.liquid",
];
const sources = paths.map((path) => ({
	path,
	source: fs.readFileSync(new URL(path, fixtureRoot), "utf8"),
}));
const compilation = createShopifySemanticCompiler().compile({
	sources,
	revision: { compilerVersion: "liquid-acceptance", externalInputs: {} },
	repositoryScope: { status: "complete" },
});
const snapshot = compilation.output.snapshot;

function inspect(request) {
	const response = compilation.inspect.inspect(request);
	assertNoInternalIds(response);
	assert.ok(
		Buffer.byteLength(JSON.stringify(response)) < 16_384,
		"Inspect response exceeded compact acceptance budget",
	);
	return response;
}

function assertNoInternalIds(response) {
	const forbidden = new Set([
		"ownerId",
		"sourceIds",
		"sourceValueIds",
		"boundaryIds",
		"predicateId",
		"valueId",
		"recordId",
		"from",
		"to",
	]);
	function visit(value, path = "response") {
		if (!value || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			assert.equal(forbidden.has(key), false, `${path}.${key} leaked`);
			visit(child, `${path}.${key}`);
		}
	}
	visit(response.answer);
	visit(response.candidates);
}

test("Liquid acceptance corpus compiles with complete extractor coverage", () => {
	assert.deepEqual(
		compilation.report.sources.map(({ path, semanticSupport }) => ({
			path,
			semanticSupport,
		})),
		paths.map((path) => ({ path, semanticSupport: "projected" })),
	);
	assert.deepEqual(
		{
			entities: snapshot.entities.length,
			occurrences: snapshot.occurrences.length,
			relations: snapshot.relations.length,
			values: snapshot.values.length,
			predicates: snapshot.predicates.length,
		},
		{
			entities: 20,
			occurrences: 81,
			relations: 27,
			values: 95,
			predicates: 10,
		},
	);
	assert.equal(
		snapshot.entities.filter(({ kind }) => kind === "shopify.dom-attribute")
			.length,
		9,
	);
	assert.equal(
		snapshot.relations.filter(({ kind }) => kind === "shopify.emits-attribute")
			.length,
		10,
	);
	assert.deepEqual(snapshot.diagnostics, []);
	assert.equal(
		snapshot.coverage.every(({ status }) => status === "complete"),
		true,
	);
	assert.equal(
		snapshot.boundaries.every(({ kind }) => kind === "shopify-runtime"),
		true,
	);
	assert.equal(
		snapshot.relations
			.filter(({ kind }) => kind === "shopify.invokes")
			.every(({ attributes }) => attributes.resolution === "repository-exact"),
		true,
	);
});

test("Liquid Inspect returns exact dependency and usage architecture", () => {
	const dependencies = inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "dependencies",
		evidence: "excerpt",
	});
	assert.equal(dependencies.status, "found");
	assert.equal(dependencies.completeness.status, "complete");
	const dependencySnippets = dependencies.answer.groups.find(
		({ kind }) => kind === "snippet",
	).items;
	const dependencyRenders = dependencies.answer.groups.find(
		({ kind }) => kind === "render",
	).items;
	assert.deepEqual(
		dependencySnippets.map(({ handle, path, resolution, defined }) => ({
			handle,
			path,
			resolution,
			defined,
		})),
		[
			{
				handle: "price",
				path: "snippets/price.liquid",
				resolution: "repository-exact",
				defined: true,
			},
		],
	);
	assert.equal(
		dependencyRenders[0].evidence.some(({ excerpt }) =>
			excerpt?.includes("render 'price'"),
		),
		true,
	);

	const firstUsages = inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "usages",
		evidence: "none",
		limit: 2,
	});
	assert.equal(firstUsages.status, "found");
	assert.equal(firstUsages.page.total, 3);
	assert.equal(firstUsages.page.returned, 2);
	assert.equal(typeof firstUsages.page.nextCursor, "string");
	assert.deepEqual(
		firstUsages.answer.groups[0].items.map(({ path }) => path),
		["sections/collection-grid.liquid", "sections/featured-collection.liquid"],
	);
	assert.equal(
		firstUsages.answer.groups[0].items.every(
			({ guards }) => guards?.[0]?.operator === "not-blank",
		),
		true,
	);
	const finalUsage = inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "usages",
		evidence: "none",
		limit: 2,
		cursor: firstUsages.page.nextCursor,
	});
	assert.deepEqual(
		finalUsage.answer.groups[0].items.map(({ path }) => path),
		["snippets/recommendations.liquid"],
	);
	assert.equal(finalUsage.page.nextCursor, undefined);

	const missing = inspect({
		subject: { type: "snippet", handle: "absent" },
		evidence: "none",
	});
	assert.equal(missing.status, "not-found");
	assert.equal(missing.completeness.status, "complete");
});

test("Liquid Inspect preserves exact render arguments and bounded value lineage", () => {
	const productCard = sources.find(
		({ path }) => path === "snippets/product-card.liquid",
	).source;
	const render = inspect({
		subject: {
			type: "render",
			path: "snippets/product-card.liquid",
			offset: productCard.indexOf("render 'price'") + 3,
		},
		evidence: "excerpt",
	});
	assert.equal(render.status, "found");
	assert.equal(render.completeness.status, "complete");
	assert.equal(render.answer.summary.target, "price");
	assert.equal(render.answer.summary.resolution, "repository-exact");
	assert.deepEqual(
		render.answer.summary.arguments.map(
			({ kind, name, expression, availability }) => ({
				kind,
				name,
				expression,
				availability,
			}),
		),
		[
			{
				kind: "named",
				name: "product",
				expression: "product",
				availability: "runtime-dependent",
			},
		],
	);

	const productHandle = inspect({
		subject: {
			type: "expression",
			path: "snippets/product-card.liquid",
			offset: productCard.indexOf("{{ product_handle") + 3,
		},
		evidence: "location",
	});
	const value = productHandle.answer.summary.value;
	assert.equal(productHandle.status, "found");
	assert.equal(productHandle.completeness.status, "runtime-dependent");
	assert.equal(value.representation, "derived");
	assert.deepEqual(
		value.derivedFrom.map(({ role, expression }) => ({ role, expression })),
		[
			{
				role: "binding",
				expression: "product.title | handleize",
			},
			{
				role: "filterResult",
				expression: "product.title | handleize",
			},
			{ role: "filterInput", expression: "product.title" },
		],
	);
	assert.equal(value.lineageTruncated, undefined);
});

test("Liquid discovery remains semantic, bounded, and evidence-backed", () => {
	const discovery = inspect({
		query: "product card",
		kinds: ["snippet"],
		evidence: "location",
		limit: 5,
	});
	assert.equal(discovery.status, "found");
	assert.equal(discovery.completeness.status, "complete");
	assert.equal(discovery.page.total, 1);
	const item = discovery.answer.groups[0].items[0];
	assert.equal(item.handle, "product-card");
	assert.equal(item.retrieval.match, "normalized");
	assert.equal(item.path, "snippets/product-card.liquid");
	assert.equal(item.evidence[0].path, "snippets/product-card.liquid");
});
