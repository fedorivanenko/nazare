import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	defineFrontend,
	defineMechanicalOntology,
	InvalidMechanicalOntologyError,
	LIQUID_MECHANICAL_FACT_KINDS,
	liquidMechanicalOntology,
} from "../dist/index.js";

const path = "snippets/product-card.liquid";
const source = fs.readFileSync(
	new URL(`./fixtures/canonical-theme/${path}`, import.meta.url),
	"utf8",
);

function anchor(text, from = 0) {
	const start = source.indexOf(text, from);
	assert.notEqual(start, -1, `missing ${text}`);
	return { path, range: { start, end: start + text.length } };
}

function accessPath(text, segments) {
	const evidence = anchor(text);
	const root = text.split(".")[0];
	return {
		root: { name: root, evidence: anchor(root, evidence.range.start) },
		segments: segments.map((name) => ({
			kind: "property",
			name,
			evidence: anchor(name, evidence.range.start),
		})),
	};
}

test("Liquid facts keep product-card syntax exact and source-local", () => {
	const renderSite = anchor("{% render 'price', product: product %}");
	const renderArgument = anchor("product: product", renderSite.range.start);
	const predicate = anchor("product.compare_at_price > product.price");
	const guarded = anchor("<s>{{ product.compare_at_price | money }}</s>");
	const metafield = "product.metafields.custom.subtitle";
	const bindingValue = anchor("product.title | handleize");
	const facts = [
		{
			kind: "liquid.binding",
			evidence: anchor(
				"{% assign product_handle = product.title | handleize %}",
			),
			binding: "assign",
			name: "product_handle",
			nameEvidence: anchor("product_handle"),
			scopeEvidence: {
				path,
				range: { start: bindingValue.range.end, end: source.length },
			},
			value: { text: "product.title | handleize", evidence: bindingValue },
		},
		{
			kind: "liquid.filter",
			evidence: bindingValue,
			name: "handleize",
			nameEvidence: anchor("handleize", bindingValue.range.start),
			input: {
				text: "product.title",
				evidence: anchor("product.title", bindingValue.range.start),
			},
			arguments: [],
		},
		{
			kind: "liquid.access-path",
			evidence: anchor(metafield),
			access: "read",
			path: accessPath(metafield, ["metafields", "custom", "subtitle"]),
			context: "output",
		},
		{
			kind: "liquid.predicate",
			evidence: predicate,
			operator: "greater-than",
			operands: [
				{
					kind: "access-path",
					path: accessPath("product.compare_at_price", ["compare_at_price"]),
				},
				{
					kind: "access-path",
					path: accessPath("product.price", ["price"]),
				},
			],
		},
		{
			kind: "liquid.condition",
			evidence: anchor("{% if product.compare_at_price > product.price %}"),
			construct: "if",
			predicateEvidence: [predicate],
			bodyEvidence: guarded,
		},
		{
			kind: "liquid.guard",
			evidence: guarded,
			conditionEvidence: predicate,
			guardedEvidence: guarded,
			outcome: "true",
		},
		{
			kind: "liquid.render-site",
			evidence: renderSite,
			target: {
				kind: "literal",
				value: "price",
				evidence: anchor("'price'", renderSite.range.start),
			},
		},
		{
			kind: "liquid.render-argument",
			evidence: renderArgument,
			renderSiteEvidence: renderSite,
			argument: {
				kind: "named",
				name: "product",
				nameEvidence: {
					path,
					range: {
						start: renderArgument.range.start,
						end: renderArgument.range.start + "product".length,
					},
				},
				value: {
					text: "product",
					evidence: {
						path,
						range: {
							start: renderArgument.range.end - "product".length,
							end: renderArgument.range.end,
						},
					},
				},
			},
		},
	];

	const frontend = defineFrontend({
		id: "liquid-contract-test",
		version: 1,
		languages: ["liquid"],
		ontology: { namespace: "liquid", version: 1 },
		factKinds: LIQUID_MECHANICAL_FACT_KINDS,
		extract({ document }) {
			return {
				path: document.path,
				language: document.language,
				frontend: { id: "liquid-contract-test", version: 1 },
				facts,
				diagnostics: [],
				boundaries: [],
				coverage: liquidMechanicalOntology.coverageFamilies.map((family) => ({
					family: family.kind,
					status: "complete",
					boundaryIds: [],
				})),
				work: { visited: 20, emitted: facts.length },
			};
		},
	});
	const result = frontend.extract({
		document: { path, language: "liquid", source, syntax: {}, diagnostics: [] },
		limits: { maxFacts: 100, maxWork: 100 },
	});

	assert.deepEqual(
		result.facts.map((fact) => fact.kind),
		[
			"liquid.binding",
			"liquid.filter",
			"liquid.access-path",
			"liquid.predicate",
			"liquid.condition",
			"liquid.guard",
			"liquid.render-site",
			"liquid.render-argument",
		],
	);
	for (const fact of result.facts) {
		assert.equal(
			source.slice(fact.evidence.range.start, fact.evidence.range.end).length >
				0,
			true,
		);
		assert.equal(LIQUID_MECHANICAL_FACT_KINDS.includes(fact.kind), true);
	}
	assert.equal(result.coverage.length, LIQUID_MECHANICAL_FACT_KINDS.length);
});

test("Liquid mechanical ontology registers closed fact and coverage vocabularies", () => {
	assert.deepEqual(
		liquidMechanicalOntology.factKinds.map(({ kind }) => kind),
		LIQUID_MECHANICAL_FACT_KINDS,
	);
	assert.throws(
		() =>
			defineMechanicalOntology({
				...liquidMechanicalOntology,
				factKinds: [
					...liquidMechanicalOntology.factKinds,
					liquidMechanicalOntology.factKinds[0],
				],
			}),
		InvalidMechanicalOntologyError,
	);
});
