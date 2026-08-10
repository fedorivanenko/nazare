import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	liquidFrontend,
	projectLiquidToShopify,
	SemanticAssemblyError,
	SemanticGraphAssembler,
	SemanticGraphContract,
	shopifyOntology,
	shopifyRepositoryResolutionPass,
} from "../dist/index.js";
import { LiquidParserProvider } from "../dist/parsers/liquid/parser.js";

const fixtureRoot = new URL(
	"../../../fixtures/canonical-theme/",
	import.meta.url,
);

function contribution(
	path,
	source = fs.readFileSync(new URL(path, fixtureRoot), "utf8"),
) {
	const parsed = new LiquidParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	const frontend = liquidFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 10_000, maxWork: 100_000 },
	});
	return projectLiquidToShopify({ document: parsed.document, frontend });
}

function assembler() {
	return new SemanticGraphAssembler(
		new SemanticGraphContract([shopifyOntology]),
		[shopifyRepositoryResolutionPass],
	);
}

function assemble(contributions, status = "complete") {
	return assembler().assemble({
		revision: {
			id: "revision:canonical",
			compilerVersion: "test",
			repositoryFingerprint: "repository:canonical",
			externalInputs: {},
		},
		contributions,
		repositoryScope: { status },
	});
}

test("assembler resolves product-card render against the defined price snippet", () => {
	const productCard = contribution("snippets/product-card.liquid");
	const price = contribution("snippets/price.liquid");
	const snapshot = assemble([productCard, price]);

	const snippets = snapshot.entities.filter(
		({ kind }) => kind === "shopify.snippet",
	);
	assert.equal(snippets.length, 2);
	const priceSnippet = snippets.find(
		({ identity }) => identity.components.handle === "price",
	);
	assert.equal(priceSnippet.attributes.defined, true);
	assert.deepEqual(
		priceSnippet.assertion.evidence.map(({ path }) => path).sort(),
		["snippets/price.liquid", "snippets/product-card.liquid"],
	);

	const invoke = snapshot.relations.find(
		({ kind }) => kind === "shopify.invokes",
	);
	assert.equal(invoke.attributes.resolution, "repository-exact");
	assert.equal(invoke.assertion.epistemic.status, "proven");
	assert.equal(invoke.assertion.epistemic.basis, "resolution");
	assert.deepEqual(
		[...new Set(invoke.assertion.evidence.map(({ path }) => path))].sort(),
		["snippets/price.liquid", "snippets/product-card.liquid"],
	);
	assert.equal(
		snapshot.boundaries.some(({ kind }) => kind === "unresolved-reference"),
		false,
	);
	const repositoryCoverage = snapshot.coverage.find(
		({ id }) => id === "coverage:shopify.snippets:repository",
	);
	assert.equal(repositoryCoverage.status, "complete");
	assert.deepEqual(repositoryCoverage.scope.kinds, ["shopify.snippet"]);
});

test("assembler output is invariant to contribution order", () => {
	const productCard = contribution("snippets/product-card.liquid");
	const price = contribution("snippets/price.liquid");
	assert.deepEqual(
		assemble([productCard, price]),
		assemble([price, productCard]),
	);
});

test("assembler reports not-found only for a complete repository scope", () => {
	const missing = contribution(
		"snippets/host.liquid",
		"{% render 'does-not-exist' %}",
	);
	const complete = assemble([missing], "complete");
	const completeInvoke = complete.relations.find(
		({ kind }) => kind === "shopify.invokes",
	);
	assert.equal(completeInvoke.attributes.resolution, "not-found");
	assert.equal(completeInvoke.assertion.boundaryIds.length, 1);
	assert.equal(
		complete.boundaries.some(({ kind }) => kind === "unresolved-reference"),
		true,
	);
	assert.equal(
		complete.diagnostics.some(
			({ code }) => code === "SHOPIFY_SNIPPET_NOT_FOUND",
		),
		true,
	);

	const partial = assemble([missing], "partial");
	const partialInvoke = partial.relations.find(
		({ kind }) => kind === "shopify.invokes",
	);
	assert.equal(partialInvoke.attributes.resolution, "literal-convention");
	assert.deepEqual(partialInvoke.assertion.boundaryIds, []);
	assert.equal(
		partial.diagnostics.some(
			({ code }) => code === "SHOPIFY_SNIPPET_NOT_FOUND",
		),
		false,
	);
	const partialCoverage = partial.coverage.find(
		({ id }) => id === "coverage:shopify.snippets:repository",
	);
	assert.equal(partialCoverage.status, "partial");
	assert.equal(partialCoverage.boundaryIds.length, 1);
	assert.equal(
		partial.boundaries.find(({ id }) => id === partialCoverage.boundaryIds[0])
			.kind,
		"external-data",
	);
});

test("assembler rejects incompatible records sharing one semantic identity", () => {
	const original = contribution("snippets/product-card.liquid");
	const conflicting = structuredClone(original);
	const snippet = conflicting.entities.find(
		({ kind }) => kind === "shopify.snippet",
	);
	snippet.attributes.path = "snippets/conflict.liquid";
	assert.throws(
		() => assemble([original, conflicting]),
		(error) => {
			assert.equal(error instanceof SemanticAssemblyError, true);
			assert.equal(error.issues[0].code, "SEMANTIC_RECORD_CONFLICT");
			return true;
		},
	);
});
