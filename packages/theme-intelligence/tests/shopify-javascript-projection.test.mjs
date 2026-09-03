import assert from "node:assert/strict";
import test from "node:test";
import {
	javaScriptFrontend,
	projectJavaScriptToShopify,
	SemanticGraphContract,
	shopifyOntology,
} from "../dist/index.js";
import { JavaScriptParserProvider } from "../dist/parsers/javascript/parser.js";

function project(source, path = "assets/theme.js") {
	const parsed = new JavaScriptParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	const frontend = javaScriptFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 1_000, maxWork: 10_000 },
	});
	return projectJavaScriptToShopify({ document: parsed.document, frontend });
}

function snapshot(contribution) {
	return {
		contractVersion: 1,
		revision: {
			id: "revision:javascript",
			compilerVersion: "test",
			repositoryFingerprint: "repository:javascript",
			externalInputs: {},
		},
		ontologies: [{ namespace: "shopify", version: 6 }],
		entities: contribution.entities,
		occurrences: contribution.occurrences,
		relations: contribution.relations,
		values: contribution.values,
		predicates: contribution.predicates,
		boundaries: contribution.boundaries,
		coverage: contribution.coverage,
		diagnostics: contribution.diagnostics,
	};
}

test("Shopify JavaScript projection preserves class roles and browser boundary", () => {
	const contribution = project(
		"element.classList.add('is-active'); element.classList.contains('is-ready');",
	);
	const validation = new SemanticGraphContract([shopifyOntology]).validate(
		snapshot(contribution),
	);
	assert.deepEqual(validation.issues, []);
	assert.deepEqual(
		contribution.relations
			.filter(({ kind }) => kind === "shopify.uses-class")
			.map(({ attributes }) => attributes.role),
		["adds", "reads"],
	);
	assert.equal(
		contribution.occurrences.every(
			({ assertion }) => assertion.availability === "runtime-dependent",
		),
		true,
	);
	assert.equal(
		contribution.boundaries.filter(({ kind }) => kind === "browser-runtime")
			.length,
		1,
	);
	assert.equal(
		contribution.coverage.find(
			({ family }) => family === "shopify.class-list-operations",
		).status,
		"complete",
	);
});
