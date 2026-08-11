import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	liquidFrontend,
	projectLiquidToShopify,
	SemanticGraphContract,
	shopifyOntology,
} from "../dist/index.js";
import { LiquidParserProvider } from "../dist/parsers/liquid/parser.js";

const fixturePath = "snippets/product-card.liquid";
const fixtureSource = fs.readFileSync(
	new URL(`../../../fixtures/canonical-theme/${fixturePath}`, import.meta.url),
	"utf8",
);

function project(source = fixtureSource, path = fixturePath, limits = {}) {
	const parsed = new LiquidParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	const frontend = liquidFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 1_000, maxWork: 10_000, ...limits },
	});
	return projectLiquidToShopify({ document: parsed.document, frontend });
}

function snapshot(contribution) {
	return {
		contractVersion: 1,
		revision: {
			id: "revision:test",
			compilerVersion: "test",
			repositoryFingerprint: "repository:test",
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

function recordsOf(records, kind) {
	return records.filter((record) => record.kind === kind);
}

test("Shopify Liquid projection validates the canonical product-card contribution", () => {
	const contribution = project();
	const contract = new SemanticGraphContract([shopifyOntology]);
	const result = contract.validate(snapshot(contribution));
	assert.deepEqual(result.issues, []);
	assert.equal(result.valid, true);

	const sourceFile = recordsOf(contribution.entities, "shopify.source-file")[0];
	assert.equal(sourceFile.identity.components.path, fixturePath);
	assert.equal(sourceFile.attributes.role, "snippet");
	const snippets = recordsOf(contribution.entities, "shopify.snippet");
	assert.deepEqual(
		snippets.map(({ identity }) => identity.components.handle).sort(),
		["price", "product-card"],
	);
	assert.equal(
		snippets.find(
			({ identity }) => identity.components.handle === "product-card",
		).attributes.defined,
		true,
	);
	assert.equal(
		snippets.find(({ identity }) => identity.components.handle === "price")
			.attributes.defined,
		false,
	);

	const render = recordsOf(contribution.occurrences, "shopify.render-site")[0];
	assert.deepEqual(render.assertion.evidence[0].range, {
		start: 494,
		end: 532,
	});
	const invoke = recordsOf(contribution.relations, "shopify.invokes")[0];
	assert.equal(invoke.from, render.id);
	assert.deepEqual(invoke.guards, []);
	assert.equal(invoke.attributes.resolution, "literal-convention");
	assert.equal(invoke.assertion.epistemic.status, "inferred");
	assert.equal(
		contribution.relations.some(
			({ kind }) => kind === "shopify.passes-argument",
		),
		true,
	);

	const comparison = contribution.predicates.find(
		({ operator }) => operator === "greater-than",
	);
	assert.equal(
		comparison.attributes.expression,
		"product.compare_at_price > product.price",
	);
	assert.equal(comparison.assertion.availability, "runtime-dependent");
	assert.equal(
		contribution.boundaries.some(({ kind }) => kind === "shopify-runtime"),
		true,
	);
	assert.equal(
		contribution.coverage.every(({ status }) => status === "complete"),
		true,
	);
});

test("Shopify Liquid projection emits guarded DOM attribute symbols", () => {
	const source = [
		"{% if product.available %}",
		'<article data-product-id="{{ product.id }}">x</article>',
		"{% endif %}",
	].join("\n");
	const contribution = project(source, "sections/product.liquid");
	const contract = new SemanticGraphContract([shopifyOntology]);
	assert.equal(contract.validate(snapshot(contribution)).valid, true);
	const attribute = recordsOf(
		contribution.entities,
		"shopify.dom-attribute",
	)[0];
	assert.equal(attribute.identity.components.name, "data-product-id");
	const occurrence = recordsOf(
		contribution.occurrences,
		"shopify.markup-attribute-site",
	)[0];
	assert.deepEqual(occurrence.attributes, {
		name: "data-product-id",
		element: "article",
		valueKind: "dynamic",
	});
	const value = contribution.values.find(
		({ slot }) => slot === "shopify.markup-attribute-value",
	);
	assert.equal(value.ownerId, occurrence.id);
	assert.equal(value.expression, '"{{ product.id }}"');
	assert.equal(value.assertion.availability, "runtime-dependent");
	const emission = recordsOf(
		contribution.relations,
		"shopify.emits-attribute",
	)[0];
	assert.equal(emission.from, occurrence.id);
	assert.equal(emission.to, attribute.id);
	assert.equal(emission.guards.length, 1);
	assert.equal(emission.assertion.epistemic.status, "proven");
	assert.equal(emission.assertion.availability, "runtime-dependent");
});

test("Shopify Liquid projection attaches exact runtime guards to invokes", () => {
	const source =
		"{% unless product.available %}{% render 'sold-out' %}{% endunless %}";
	const contribution = project(source, "snippets/availability.liquid");
	const invoke = recordsOf(contribution.relations, "shopify.invokes")[0];
	assert.equal(invoke.guards.length, 1);
	const guard = contribution.predicates.find(
		({ id }) => id === invoke.guards[0],
	);
	assert.equal(guard.operator, "not");
	assert.equal(guard.operands[0].kind, "predicate");
	assert.equal(invoke.assertion.availability, "runtime-dependent");
	new SemanticGraphContract([shopifyOntology]).assert(snapshot(contribution));
});

test("Shopify Liquid projection distinguishes iterating and empty loop guards", () => {
	const source =
		"{% for item in products %}{% render 'item' %}{% else %}{% render 'empty' %}{% endfor %}";
	const contribution = project(source, "snippets/list.liquid");
	const invokes = recordsOf(contribution.relations, "shopify.invokes");
	assert.equal(invokes.length, 2);
	assert.deepEqual(
		invokes
			.map(
				({ guards }) =>
					contribution.predicates.find(({ id }) => id === guards[0]).operator,
			)
			.sort(),
		["blank", "not-blank"],
	);
	new SemanticGraphContract([shopifyOntology]).assert(snapshot(contribution));
});

test("Shopify Liquid projection preserves dynamic targets as unavailable resolution", () => {
	const contribution = project(
		"{% render snippet_name, product: product %}",
		"snippets/dynamic.liquid",
	);
	assert.equal(recordsOf(contribution.relations, "shopify.invokes").length, 0);
	const render = recordsOf(contribution.occurrences, "shopify.render-site")[0];
	assert.equal(render.attributes.target, "snippet_name");
	const target = contribution.values.find(
		({ slot }) => slot === "shopify.render-target",
	);
	assert.equal(target.representation, "expression");
	assert.equal(target.assertion.availability, "runtime-dependent");
	assert.equal(
		contribution.boundaries.some(({ kind }) => kind === "dynamic-target"),
		true,
	);
	new SemanticGraphContract([shopifyOntology]).assert(snapshot(contribution));
});

test("Shopify Liquid projection never presents unsupported case guards as unconditional", () => {
	const source =
		"{% case type %}{% when 'sale' %}{% render 'badge' %}{% endcase %}";
	const contribution = project(source, "snippets/case.liquid");
	const invoke = recordsOf(contribution.relations, "shopify.invokes")[0];
	assert.equal(invoke.guards.length, 0);
	assert.equal(invoke.assertion.availability, "runtime-dependent");
	assert.equal(invoke.assertion.boundaryIds.length > 0, true);
	assert.equal(
		contribution.coverage.find(({ family }) => family === "shopify.conditions")
			.status,
		"partial",
	);
	new SemanticGraphContract([shopifyOntology]).assert(snapshot(contribution));
});

test("Shopify Liquid projection carries frontend budget uncertainty into scoped coverage", () => {
	const contribution = project(fixtureSource, fixturePath, { maxFacts: 2 });
	assert.equal(
		contribution.coverage.some(({ status }) => status === "partial"),
		true,
	);
	assert.equal(
		contribution.boundaries.some(({ kind }) => kind === "budget"),
		true,
	);
	new SemanticGraphContract([shopifyOntology]).assert(snapshot(contribution));
});
