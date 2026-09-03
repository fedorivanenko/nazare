import assert from "node:assert/strict";
import test from "node:test";
import {
	createShopifyLiquidValueFlowPass,
	createShopifySemanticCompiler,
	liquidFrontend,
	projectLiquidToShopify,
	SemanticGraphAssembler,
	SemanticGraphContract,
	shopifyOntology,
	shopifyRepositoryResolutionPass,
} from "../dist/index.js";
import { LiquidParserProvider } from "../dist/parsers/liquid/parser.js";

const hostSource = `{% assign fixed = 'red' %}
{% assign slug = product.title | append: '-' | handleize %}
{% render 'badge', color: fixed, slug: slug %}`;
const badgeSource = `<span data-color="{{ color }}" data-slug="{{ slug }}">{{ slug }}</span>`;

function compile(source = hostSource) {
	return createShopifySemanticCompiler().compile({
		sources: [
			{ path: "snippets/host.liquid", source },
			{ path: "snippets/badge.liquid", source: badgeSource },
		],
		revision: { compilerVersion: "test", externalInputs: {} },
		repositoryScope: { status: "complete" },
	});
}

function ownedValue(snapshot, occurrence, slot) {
	return snapshot.values.find(
		(value) => value.ownerId === occurrence.id && value.slot === slot,
	);
}

test("bounded value flow links literals, bindings, filters, render arguments, and callee reads", () => {
	const { output, inspect } = compile();
	const snapshot = output.snapshot;
	const fixedBinding = snapshot.occurrences.find(
		({ kind, attributes }) =>
			kind === "shopify.binding-site" && attributes.name === "fixed",
	);
	const fixedValue = ownedValue(
		snapshot,
		fixedBinding,
		"shopify.binding-value",
	);
	assert.equal(fixedValue.representation, "literal");
	assert.equal(fixedValue.resolved, "red");
	assert.equal(fixedValue.assertion.availability, "static");

	const colorArgument = snapshot.occurrences.find(
		({ kind, attributes }) =>
			kind === "shopify.render-argument-site" && attributes.name === "color",
	);
	const colorValue = ownedValue(
		snapshot,
		colorArgument,
		"shopify.render-argument-value",
	);
	assert.deepEqual(colorValue.sourceValueIds, [fixedValue.id]);
	assert.equal(colorValue.representation, "derived");
	assert.equal(colorValue.assertion.availability, "static");
	assert.equal(colorValue.assertion.epistemic.basis, "bounded-analysis");

	const colorRead = snapshot.occurrences.find(
		({ kind, attributes, assertion }) =>
			kind === "shopify.expression-site" &&
			attributes.root === "color" &&
			assertion.evidence[0].path === "snippets/badge.liquid",
	);
	const colorReadValue = ownedValue(snapshot, colorRead, "shopify.read-value");
	assert.deepEqual(colorReadValue.sourceValueIds, [colorValue.id]);
	assert.equal(colorReadValue.assertion.availability, "static");

	const slugBinding = snapshot.occurrences.find(
		({ kind, attributes }) =>
			kind === "shopify.binding-site" && attributes.name === "slug",
	);
	const slugValue = ownedValue(snapshot, slugBinding, "shopify.binding-value");
	assert.equal(slugValue.sourceValueIds.length, 1);
	const outerFilter = snapshot.values.find(
		({ id, slot }) =>
			id === slugValue.sourceValueIds[0] && slot === "shopify.filter-result",
	);
	assert.equal(outerFilter.attributes.filter, "handleize");
	assert.equal(outerFilter.sourceValueIds.length, 1);
	const filterArgument = snapshot.values.find(
		({ slot }) => slot === "shopify.filter-argument",
	);
	assert.equal(filterArgument.representation, "literal");
	assert.equal(filterArgument.resolved, "-");
	assert.equal(filterArgument.attributes.position, 0);
	assert.equal(slugValue.assertion.availability, "runtime-dependent");

	const slugArgument = snapshot.occurrences.find(
		({ kind, attributes }) =>
			kind === "shopify.render-argument-site" && attributes.name === "slug",
	);
	const slugArgumentValue = ownedValue(
		snapshot,
		slugArgument,
		"shopify.render-argument-value",
	);
	assert.deepEqual(slugArgumentValue.sourceValueIds, [slugValue.id]);
	assert.equal(slugArgumentValue.assertion.availability, "runtime-dependent");

	const flowCoverage = snapshot.coverage.filter(
		({ family }) => family === "shopify.value-flow",
	);
	assert.equal(flowCoverage.length, 2);
	assert.equal(
		flowCoverage.every(({ status }) => status === "complete"),
		true,
	);

	const colorAnswer = inspect.inspect({
		subject: {
			type: "expression",
			path: "snippets/badge.liquid",
			offset: badgeSource.indexOf("{{ color") + 3,
		},
		evidence: "none",
	});
	assert.equal(colorAnswer.status, "found");
	const colorItem = colorAnswer.answer.groups[0].items[0];
	assert.equal(colorItem.availability, "static");
	assert.equal(colorItem.value.representation, "derived");
	assert.deepEqual(
		colorItem.value.derivedFrom.map(({ role }) => role),
		["renderArgument", "binding"],
	);
	assert.equal(colorItem.value.derivedFrom[1].resolved, "red");
	assert.equal(colorAnswer.completeness.status, "complete");

	const renderAnswer = inspect.inspect({
		subject: {
			type: "render",
			path: "snippets/host.liquid",
			offset: hostSource.indexOf("render 'badge'"),
		},
		evidence: "none",
	});
	const colorArgumentAnswer =
		renderAnswer.answer.groups[0].items[0].arguments.find(
			({ name }) => name === "color",
		);
	assert.equal(colorArgumentAnswer.availability, "static");
	assert.equal(colorArgumentAnswer.value.derivedFrom[0].resolved, "red");
});

test("callee value remains runtime-dependent when any call omits parameter", () => {
	const compilation = compile(
		`${hostSource}\n{% render 'badge', slug: slug %}`,
	);
	const colorRead = compilation.output.snapshot.occurrences.find(
		({ kind, attributes, assertion }) =>
			kind === "shopify.expression-site" &&
			attributes.root === "color" &&
			assertion.evidence[0].path === "snippets/badge.liquid",
	);
	const colorValue = ownedValue(
		compilation.output.snapshot,
		colorRead,
		"shopify.read-value",
	);
	assert.equal(colorValue.sourceValueIds.length, 1);
	assert.equal(colorValue.assertion.availability, "runtime-dependent");
});

test("value-flow budget becomes explicit partial coverage", () => {
	const parser = new LiquidParserProvider();
	const contributions = [
		["snippets/host.liquid", hostSource],
		["snippets/badge.liquid", badgeSource],
	].map(([path, source]) => {
		const parsed = parser.parse({ path, source });
		assert.equal(parsed.ok, true);
		return projectLiquidToShopify({
			document: parsed.document,
			frontend: liquidFrontend.extract({
				document: parsed.document,
				limits: { maxFacts: 10_000, maxWork: 100_000 },
			}),
		});
	});
	const assemble = (orderedContributions) =>
		new SemanticGraphAssembler(new SemanticGraphContract([shopifyOntology]), [
			createShopifyLiquidValueFlowPass({ maxLinks: 2, maxDepth: 1 }),
			shopifyRepositoryResolutionPass,
		]).assemble({
			revision: {
				id: "budget",
				compilerVersion: "test",
				repositoryFingerprint: "budget",
				externalInputs: {},
			},
			contributions: orderedContributions,
			repositoryScope: { status: "complete" },
		});
	const snapshot = assemble(contributions);
	assert.deepEqual(snapshot, assemble([...contributions].reverse()));
	assert.equal(
		snapshot.coverage
			.filter(({ family }) => family === "shopify.value-flow")
			.every(({ status }) => status === "partial"),
		true,
	);
	assert.equal(
		snapshot.boundaries.some(
			({ kind, message }) =>
				kind === "budget" && message.includes("value-flow"),
		),
		true,
	);
});
