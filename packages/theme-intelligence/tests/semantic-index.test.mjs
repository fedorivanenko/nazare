import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	buildSemanticIndex,
	createQueryableSemanticOutput,
	liquidFrontend,
	openQueryableSemanticOutput,
	projectLiquidToShopify,
	SemanticGraphAssembler,
	SemanticGraphContract,
	SemanticIndexRevisionMismatchError,
	SemanticQueryIndex,
	shopifyOntology,
	shopifyRepositoryResolutionPass,
} from "../dist/index.js";
import { LiquidParserProvider } from "../dist/parsers/liquid/parser.js";

const fixtureRoot = new URL("./fixtures/canonical-theme/", import.meta.url);

function contribution(path) {
	const source = fs.readFileSync(new URL(path, fixtureRoot), "utf8");
	const parsed = new LiquidParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	const frontend = liquidFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 10_000, maxWork: 100_000 },
	});
	return projectLiquidToShopify({ document: parsed.document, frontend });
}

function canonicalSnapshot() {
	return new SemanticGraphAssembler(
		new SemanticGraphContract([shopifyOntology]),
		[shopifyRepositoryResolutionPass],
	).assemble({
		revision: {
			id: "revision:index-test",
			compilerVersion: "test",
			repositoryFingerprint: "repository:index-test",
			externalInputs: {},
		},
		contributions: [
			contribution("snippets/product-card.liquid"),
			contribution("snippets/price.liquid"),
		],
		repositoryScope: { status: "complete" },
	});
}

test("semantic index provides exact identity, ownership, relation, and evidence lookup", () => {
	const snapshot = canonicalSnapshot();
	const query = new SemanticQueryIndex(snapshot);
	const price = query.findByIdentity("shopify.snippet", { handle: "price" });
	assert.equal(price.length, 1);
	assert.equal(price[0].attributes.defined, true);
	assert.equal(query.findByPath("snippets/price.liquid").length, 2);

	const render = query.findByKind("shopify.render-site")[0];
	assert.equal(query.outgoing(render.id, "shopify.invokes").length, 1);
	assert.equal(query.incoming(price[0].id, "shopify.invokes").length, 1);
	const sourceFile = query
		.findByPath("snippets/product-card.liquid")
		.find(({ kind }) => kind === "shopify.source-file");
	assert.equal(query.ownedBy(sourceFile.id).length > 10, true);
	assert.equal(
		query
			.evidenceAt("snippets/product-card.liquid", 500)
			.some(({ id }) => id === render.id),
		true,
	);
	assert.equal(query.coverageFor("shopify.snippets").length >= 3, true);
	assert.equal(
		query
			.coverageFor("shopify.snippets", "snippets/not-present.liquid")
			.some(
				({ status, scope }) =>
					status === "complete" && scope.kinds?.includes("shopify.snippet"),
			),
		true,
	);
});

test("semantic search separates exact, normalized, and inferred retrieval", () => {
	const query = new SemanticQueryIndex(canonicalSnapshot());
	const exact = query.search("price", { kinds: ["shopify.snippet"] });
	assert.equal(exact.matches[0].match, "exact");
	assert.equal(exact.matches[0].field, "name");
	assert.equal(
		query.record(exact.matches[0].id).identity.components.handle,
		"price",
	);

	const normalized = query.search("product card", {
		kinds: ["shopify.snippet"],
	});
	assert.equal(normalized.matches[0].match, "normalized");
	assert.equal(
		query.record(normalized.matches[0].id).identity.components.handle,
		"product-card",
	);

	const inferred = query.search("compare price", {
		kinds: ["shopify.expression-site"],
	});
	assert.equal(inferred.matches[0].match, "inferred");
	assert.equal(inferred.matches[0].label.includes("compare_at_price"), true);
	assert.equal(query.search("prce").total, 0);
	assert.equal(query.search("expression").total, 0);
});

test("semantic search is bounded, deterministic, and never mutates graph truth", () => {
	const snapshot = canonicalSnapshot();
	const output = createQueryableSemanticOutput(snapshot);
	assert.deepEqual(output.index, buildSemanticIndex(snapshot));
	const query = openQueryableSemanticOutput(output);
	const page = query.search("price", { limit: 1 });
	assert.equal(page.returned, 1);
	assert.equal(page.total > page.returned, true);
	assert.equal(page.truncated, true);
	const record = query.record(page.matches[0].id);
	const original =
		snapshot.entities.find(({ id }) => id === record.id) ??
		snapshot.occurrences.find(({ id }) => id === record.id);
	assert.equal(record, original);
});

test("semantic query rejects stale revision indexes", () => {
	const snapshot = canonicalSnapshot();
	const index = buildSemanticIndex(snapshot);
	assert.throws(
		() =>
			new SemanticQueryIndex(snapshot, {
				...index,
				revision: { ...index.revision, id: "revision:stale" },
			}),
		SemanticIndexRevisionMismatchError,
	);
});
