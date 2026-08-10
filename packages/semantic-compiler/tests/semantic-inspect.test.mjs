import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	InvalidSemanticInspectRequestError,
	liquidFrontend,
	projectLiquidToShopify,
	SemanticGraphAssembler,
	SemanticGraphContract,
	SemanticInspect,
	SemanticInspectInputError,
	SemanticQueryIndex,
	shopifyOntology,
	shopifyRepositoryResolutionPass,
} from "../dist/index.js";
import { LiquidParserProvider } from "../dist/parsers/liquid/parser.js";

const fixtureRoot = new URL(
	"../../../fixtures/canonical-theme/",
	import.meta.url,
);

function contribution(path, source) {
	const contents =
		source ?? fs.readFileSync(new URL(path, fixtureRoot), "utf8");
	const parsed = new LiquidParserProvider().parse({ path, source: contents });
	assert.equal(parsed.ok, true);
	const frontend = liquidFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 10_000, maxWork: 100_000 },
	});
	return {
		contribution: projectLiquidToShopify({
			document: parsed.document,
			frontend,
		}),
		source: contents,
	};
}

function inspectFixture(status = "complete", custom = []) {
	const inputs = [
		contribution("snippets/product-card.liquid"),
		contribution("snippets/price.liquid"),
		...custom,
	];
	const snapshot = new SemanticGraphAssembler(
		new SemanticGraphContract([shopifyOntology]),
		[shopifyRepositoryResolutionPass],
	).assemble({
		revision: {
			id: `revision:inspect:${status}`,
			compilerVersion: "test",
			repositoryFingerprint: `repository:inspect:${status}`,
			externalInputs: {},
		},
		contributions: inputs.map((input) => input.contribution),
		repositoryScope: { status },
	});
	const sources = new Map(
		inputs.map((input) => [input.contribution.scope.paths[0], input.source]),
	);
	return {
		inspect: new SemanticInspect(new SemanticQueryIndex(snapshot), {
			source: (path) => sources.get(path),
		}),
		snapshot,
	};
}

function assertNoInternalIds(value) {
	const forbidden = new Set([
		"id",
		"ownerId",
		"sourceIds",
		"boundaryIds",
		"predicateId",
		"valueId",
		"recordId",
		"from",
		"to",
	]);
	function visit(item, path = "response") {
		if (!item || typeof item !== "object") return;
		for (const [key, child] of Object.entries(item)) {
			assert.equal(forbidden.has(key), false, `${path}.${key} leaked`);
			visit(child, `${path}.${key}`);
		}
	}
	visit(value.answer);
	visit(value.candidates);
}

test("Inspect returns compact snippet architecture without graph IDs", () => {
	const { inspect } = inspectFixture();
	const summary = inspect.inspect({
		subject: { type: "snippet", handle: "price" },
		facet: "summary",
		evidence: "none",
	});
	assert.equal(summary.status, "found");
	assert.deepEqual(summary.answer.summary, {
		handle: "price",
		path: "snippets/price.liquid",
		defined: true,
		dependencies: 0,
		usages: 1,
	});
	assert.equal(summary.completeness.status, "complete");
	assertNoInternalIds(summary);

	const dependencies = inspect.inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "dependencies",
		evidence: "location",
	});
	const item = dependencies.answer.groups[0].items[0];
	assert.equal(item.type, "snippet");
	assert.equal(item.handle, "price");
	assert.equal(item.resolution, "repository-exact");
	assert.equal(item.certainty, "proven");
	assert.equal(item.evidence[0].path, "snippets/price.liquid");
	assertNoInternalIds(dependencies);
});

test("Inspect selects exact render and expression occurrences by source offset", () => {
	const { inspect } = inspectFixture();
	const render = inspect.inspect({
		subject: {
			type: "render",
			path: "snippets/product-card.liquid",
			offset: 500,
		},
		evidence: "excerpt",
	});
	assert.equal(render.status, "found");
	assert.equal(render.answer.summary.target, "price");
	assert.equal(render.answer.summary.resolution, "repository-exact");
	assert.deepEqual(render.answer.summary.arguments, [
		{ kind: "named", name: "product", expression: "product" },
	]);
	assert.equal(
		render.answer.groups[0].items[0].evidence.some(({ excerpt }) =>
			excerpt?.includes("render 'price'"),
		),
		true,
	);

	const expression = inspect.inspect({
		subject: {
			type: "expression",
			path: "snippets/product-card.liquid",
			offset: 680,
		},
		evidence: "none",
	});
	assert.equal(expression.status, "found");
	assert.equal(expression.answer.summary.root, "product");
	assert.deepEqual(
		expression.answer.summary.segments.map(({ name }) => name),
		["metafields", "custom", "subtitle"],
	);
	assert.equal(
		expression.answer.groups[0].items[0].availability,
		"runtime-dependent",
	);
	assert.equal(expression.completeness.status, "runtime-dependent");
	assert.equal(
		expression.completeness.reasons.some(
			({ code }) => code === "shopify-runtime",
		),
		true,
	);
	assertNoInternalIds(expression);
});

test("Inspect distinguishes proven not-found from partial-scope unknown", () => {
	const complete = inspectFixture("complete").inspect.inspect({
		subject: { type: "snippet", handle: "absent" },
	});
	assert.equal(complete.status, "not-found");
	assert.equal(complete.completeness.status, "complete");

	const partial = inspectFixture("partial").inspect.inspect({
		subject: { type: "snippet", handle: "absent" },
	});
	assert.equal(partial.status, "external-data-required");
	assert.equal(partial.completeness.status, "external-data-required");
});

test("Inspect exposes dynamic render targets as runtime-dependent, never missing", () => {
	const dynamic = contribution(
		"snippets/dynamic-inspect.liquid",
		"{% render snippet_name, product: product %}",
	);
	const { inspect } = inspectFixture("complete", [dynamic]);
	const response = inspect.inspect({
		subject: {
			type: "render",
			path: "snippets/dynamic-inspect.liquid",
			offset: 5,
		},
		evidence: "none",
	});
	assert.equal(response.status, "found");
	assert.equal(response.answer.summary.target, "snippet_name");
	assert.equal(
		response.answer.groups[0].items[0].availability,
		"runtime-dependent",
	);
	assert.equal(response.completeness.status, "runtime-dependent");
	assert.equal(
		response.completeness.reasons.some(({ code }) => code === "dynamic-target"),
		true,
	);
});

test("Inspect discovery ranks semantic matches and uses revision-bound cursors", () => {
	const { inspect } = inspectFixture();
	const normalized = inspect.inspect({
		query: "product card",
		kinds: ["snippet"],
		evidence: "none",
	});
	const normalizedItem = normalized.answer.groups[0].items[0];
	assert.equal(normalized.answer.groups[0].total, normalized.page.total);
	assert.equal(normalizedItem.retrieval.match, "normalized");
	assert.equal(normalizedItem.certainty, "inferred");
	const first = inspect.inspect({
		query: "product",
		limit: 1,
		evidence: "none",
	});
	assert.equal(first.status, "found");
	assert.equal(first.page.returned, 1);
	assert.equal(typeof first.page.nextCursor, "string");
	assertNoInternalIds(first);
	const second = inspect.inspect({
		query: "product",
		limit: 1,
		evidence: "none",
		cursor: first.page.nextCursor,
	});
	assert.equal(second.page.returned, 1);
	assert.notDeepEqual(second.answer.groups, first.answer.groups);
	assert.throws(
		() =>
			inspect.inspect({
				query: "price",
				limit: 1,
				evidence: "none",
				cursor: first.page.nextCursor,
			}),
		SemanticInspectInputError,
	);
});

test("Inspect rejects malformed or graph-oriented public inputs", () => {
	const { inspect } = inspectFixture();
	assert.throws(
		() => inspect.inspect({ query: "price", recordId: "internal" }),
		InvalidSemanticInspectRequestError,
	);
	assert.throws(
		() =>
			inspect.inspect({
				subject: { type: "render", path: "snippets/x.liquid", offset: -1 },
			}),
		InvalidSemanticInspectRequestError,
	);
});

test("Inspect reports unavailable excerpts without weakening semantic truth", () => {
	const { snapshot } = inspectFixture();
	const inspect = new SemanticInspect(new SemanticQueryIndex(snapshot));
	const response = inspect.inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "dependencies",
		evidence: "excerpt",
	});
	assert.equal(response.status, "found");
	assert.equal(response.completeness.status, "partial");
	assert.equal(
		response.completeness.reasons.some(
			({ code }) => code === "EVIDENCE_SOURCE_UNAVAILABLE",
		),
		true,
	);
});
