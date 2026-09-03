import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	createShopifySemanticCompiler,
	FactOntologyQuery,
	FactOntologyValidationError,
	projectSnapshotToFactOntology,
	validateFactOntologySnapshot,
} from "../dist/index.js";

const fixtureRoot = new URL("./fixtures/canonical-theme/", import.meta.url);

function fixtureSource(path) {
	return {
		path,
		source: fs.readFileSync(new URL(path, fixtureRoot), "utf8"),
	};
}

function compile(sources) {
	return createShopifySemanticCompiler().compile({
		sources,
		revision: { compilerVersion: "fact-ontology-test", externalInputs: {} },
		repositoryScope: { status: "complete" },
	});
}

function factSet(sources) {
	return projectSnapshotToFactOntology(compile(sources).output.snapshot);
}

function sourceFor(facts, ref) {
	return facts.sources.find((source) => source.ref === ref);
}

test("experimental fact ontology preserves snippet call truth", () => {
	const facts = factSet([
		fixtureSource("snippets/product-card.liquid"),
		fixtureSource("snippets/price.liquid"),
	]);
	assert.equal(facts.contractVersion, 2);
	assert.doesNotThrow(() => validateFactOntologySnapshot(facts));

	const price = facts.symbols.find(
		(symbol) => symbol.kind === "shopify.snippet" && symbol.name === "price",
	);
	assert.ok(price);
	const calls = facts.facts.filter(
		(fact) =>
			fact.claim.predicate === "CALLS" && fact.claim.object === price.ref,
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].assertion.certainty, "proven");
	assert.equal(calls[0].execution, "unconditional");
	assert.equal(
		sourceFor(facts, calls[0].assertion.evidence[0]).artifact,
		"artifact:snippets~2Fproduct-card.liquid",
	);

	const passed = facts.facts.filter(
		(fact) =>
			fact.claim.predicate === "PASSES" &&
			fact.claim.subject === calls[0].claim.subject,
	);
	assert.equal(passed.length, 1);
	assert.equal(passed[0].claim.attributes.slot, "product");
	const value = facts.values.find(
		(candidate) => candidate.ref === passed[0].claim.object,
	);
	assert.equal(value.expression, "product");
	assert.equal(value.resolvability, "runtime-dependent");

	const query = new FactOntologyQuery(facts);
	const compact = query.callsTo("price");
	assert.deepEqual(
		{
			total: compact.calls.total,
			artifacts: compact.calls.artifacts,
			conditional: compact.calls.conditional,
			contract: compact.argumentContract.map(({ slot, calls: count }) => [
				slot,
				count,
			]),
		},
		{
			total: 1,
			artifacts: 1,
			conditional: 0,
			contract: [["product", 1]],
		},
	);
	assert.equal(compact.calls.items[0].offset, 494);
	assert.equal(
		query.expandAggregate(compact.argumentContract[0].ref).length,
		1,
	);
	const expanded = query.expand(compact.calls.items[0].ref);
	assert.equal(expanded.fact.claim.predicate, "CALLS");
	assert.equal(expanded.relatedFacts.length, 1);
	assert.deepEqual(expanded.evidence[0].range, { start: 494, end: 532 });

	const serialized = JSON.stringify(facts);
	for (const privateKey of [
		"ownerId",
		"sourceIds",
		"boundaryIds",
		"recordId",
	]) {
		assert.equal(serialized.includes(`"${privateKey}"`), false);
	}
});

test("experimental fact ontology normalizes scoped binding lineage and guards", () => {
	const source = [
		"{% assign menu = '' %}",
		"{% for i in section.blocks %}",
		"  {% if i.type == 'megamenu' %}",
		"    {% assign menu = menu | append: i.settings.title %}",
		"  {% endif %}",
		"{% endfor %}",
		"{% if section.enabled %}",
		"  {% render 'price', product: menu %}",
		"{% endif %}",
	].join("\n");
	const facts = factSet([
		{ path: "snippets/menu-card.liquid", source },
		fixtureSource("snippets/price.liquid"),
	]);
	const menuSymbols = facts.symbols.filter(
		(symbol) => symbol.kind === "liquid.binding" && symbol.name === "menu",
	);
	assert.equal(menuSymbols.length, 1);
	const menu = menuSymbols[0];
	const binds = facts.facts.filter(
		(fact) =>
			fact.claim.predicate === "BINDS" && fact.claim.object === menu.ref,
	);
	assert.equal(binds.length, 2);

	const call = facts.facts.find(
		(fact) =>
			fact.claim.predicate === "CALLS" &&
			facts.symbols.find(
				(symbol) => symbol.ref === fact.claim.object && symbol.name === "price",
			),
	);
	assert.ok(call);
	assert.equal(call.execution, "conditional");
	assert.equal(call.guards.length, 1);
	assert.equal(
		facts.conditions.find((condition) => condition.ref === call.guards[0])
			.expression,
		"section.enabled",
	);
	assert.equal(
		facts.facts.some(
			(fact) =>
				fact.claim.predicate === "GUARDED_BY" &&
				fact.claim.subject === call.ref &&
				fact.claim.object === call.guards[0],
		),
		true,
	);
	assert.equal(
		facts.facts.some(
			(fact) =>
				fact.claim.predicate === "DERIVES_FROM" &&
				facts.values.some((value) => value.ref === fact.claim.subject),
		),
		true,
	);
	assert.equal(
		facts.facts.some(
			(fact) =>
				fact.claim.predicate === "USES" &&
				facts.symbols.some(
					(symbol) => symbol.ref === fact.claim.object && symbol.name === "i",
				),
		),
		true,
	);
});

test("Liquid markup projects into expandable DOM attribute USES facts", () => {
	const source = [
		"{% if product.available %}",
		'<article data-product-id="{{ product.id }}">x</article>',
		"{% endif %}",
	].join("\n");
	const facts = factSet([{ path: "sections/product.liquid", source }]);
	const attribute = facts.symbols.find(
		(symbol) =>
			symbol.kind === "dom.attribute" && symbol.name === "data-product-id",
	);
	assert.ok(attribute);
	const use = facts.facts.find(
		(fact) =>
			fact.claim.predicate === "USES" && fact.claim.object === attribute.ref,
	);
	assert.equal(use.claim.attributes.role, "emits");
	assert.equal(use.execution, "conditional");
	assert.equal(use.guards.length, 1);
	const query = new FactOntologyQuery(facts);
	const compact = query.usesOf("data-product-id", "dom.attribute");
	assert.deepEqual(
		compact.roles.map(({ role, uses }) => [role, uses]),
		[["emits", 1]],
	);
	assert.equal(compact.uses.items[0].path, "sections/product.liquid");
	assert.deepEqual(compact.coverage, {
		family: "markup-attributes",
		status: "complete",
		coveredArtifacts: 1,
		completeArtifacts: 1,
		uncertainArtifacts: 0,
		totalArtifacts: 1,
	});
	const expanded = query.expand(compact.uses.items[0].ref);
	assert.equal(expanded.guards.length, 1);
	assert.equal(expanded.relatedFacts.length, 1);
	const emittedValue = facts.values.find(
		(value) => value.ref === expanded.relatedFacts[0].claim.subject,
	);
	assert.equal(emittedValue.expression, '"{{ product.id }}"');
	assert.equal(emittedValue.resolvability, "runtime-dependent");
	assert.equal(
		source.slice(
			expanded.evidence[0].range.start,
			expanded.evidence[0].range.end,
		),
		"data-product-id",
	);
});

test("generic USES roles compact DOM attribute behavior across languages", () => {
	const artifacts = [
		["artifact:section", "sections/product.liquid", "liquid"],
		["artifact:script", "assets/product.js", "javascript"],
		["artifact:style", "assets/product.css", "css"],
	].map(([ref, path, language]) => ({
		ref,
		kind: "source",
		path,
		language,
	}));
	const sources = artifacts.map((artifact, index) => ({
		ref: `source:${index}`,
		artifact: artifact.ref,
		range: { start: index * 10, end: index * 10 + 5 },
	}));
	const operations = [
		"markup.emit-attribute",
		"javascript.read-attribute",
		"css.select-attribute",
	].map((kind, index) => ({
		ref: `operation:${index}`,
		kind,
		scope: {
			artifact: artifacts[index].ref,
			start: sources[index].range.start,
			end: sources[index].range.end,
		},
		sources: [sources[index].ref],
	}));
	const symbol = {
		ref: "symbol:dom.attribute:data-product-id",
		kind: "dom.attribute",
		namespace: "dom",
		name: "data-product-id",
	};
	const roles = ["emits", "reads", "selects"];
	const facts = operations.map((operation, index) => ({
		ref: `fact:use:${index}`,
		claim: {
			subject: operation.ref,
			predicate: "USES",
			object: symbol.ref,
			attributes: { role: roles[index] },
		},
		assertion: {
			certainty: "proven",
			basis: "syntax",
			authority: ["authored-source"],
			evidence: [sources[index].ref],
		},
		evaluation: "static",
		execution: "unconditional",
	}));
	const snapshot = {
		contractVersion: 2,
		revision: { id: "revision:dom", repositoryFingerprint: "repository:dom" },
		artifacts,
		symbols: [symbol],
		values: [],
		operations,
		conditions: [],
		sources,
		facts,
		coverage: [],
	};
	assert.doesNotThrow(() => validateFactOntologySnapshot(snapshot));
	const query = new FactOntologyQuery(snapshot);
	const compact = query.usesOf("data-product-id", "dom.attribute");
	assert.equal(compact.uses.total, 3);
	assert.equal(compact.uses.artifacts, 3);
	assert.deepEqual(
		compact.roles.map(({ role, uses }) => [role, uses]),
		[
			["emits", 1],
			["reads", 1],
			["selects", 1],
		],
	);
	assert.equal(query.expandAggregate(compact.roles[0].ref).length, 1);
});

test("fact ontology validator enforces primary predicate endpoints", () => {
	const facts = factSet([
		fixtureSource("snippets/product-card.liquid"),
		fixtureSource("snippets/price.liquid"),
	]);
	const invalid = structuredClone(facts);
	const call = invalid.facts.find((fact) => fact.claim.predicate === "CALLS");
	call.claim.subject = invalid.artifacts[0].ref;
	assert.throws(
		() => validateFactOntologySnapshot(invalid),
		FactOntologyValidationError,
	);
	const invalidEvaluation = structuredClone(facts);
	invalidEvaluation.facts[0].evaluation = "maybe-runtime";
	assert.throws(
		() => validateFactOntologySnapshot(invalidEvaluation),
		FactOntologyValidationError,
	);
});
