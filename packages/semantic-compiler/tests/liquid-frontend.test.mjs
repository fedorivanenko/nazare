import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { liquidFrontend } from "../dist/index.js";
import { LiquidParserProvider } from "../dist/parsers/liquid/parser.js";

const fixturePath = "snippets/product-card.liquid";
const fixtureSource = fs.readFileSync(
	new URL(`../../../fixtures/canonical-theme/${fixturePath}`, import.meta.url),
	"utf8",
);

function extract(source = fixtureSource, path = fixturePath, limits = {}) {
	const parsed = new LiquidParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	return liquidFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 1_000, maxWork: 10_000, ...limits },
	});
}

function factsOf(result, kind) {
	return result.facts.filter((fact) => fact.kind === kind);
}

test("Liquid frontend extracts the canonical product-card slice from CST offsets", () => {
	const result = extract();
	assert.deepEqual(result.boundaries, []);
	assert.equal(
		result.coverage.every(({ status }) => status === "complete"),
		true,
	);
	assert.equal(result.work.emitted, result.facts.length);
	assert.equal(result.work.visited > result.work.emitted, true);

	const binding = factsOf(result, "liquid.binding").find(
		(fact) => fact.name === "product_handle",
	);
	assert.equal(binding.binding, "assign");
	assert.equal(binding.value.text, "product.title | handleize");
	assert.equal(
		fixtureSource.slice(
			binding.evidence.range.start,
			binding.evidence.range.end,
		),
		"{% assign product_handle = product.title | handleize %}",
	);

	const handleize = factsOf(result, "liquid.filter").find(
		(fact) => fact.name === "handleize",
	);
	assert.equal(handleize.input.text, "product.title");

	const render = factsOf(result, "liquid.render-site")[0];
	assert.deepEqual(render.evidence.range, { start: 494, end: 532 });
	assert.deepEqual(render.target, {
		kind: "literal",
		value: "price",
		evidence: { path: fixturePath, range: { start: 504, end: 511 } },
	});
	const renderArgument = factsOf(result, "liquid.render-argument")[0];
	assert.equal(renderArgument.argument.kind, "named");
	assert.equal(renderArgument.argument.name, "product");
	assert.equal(renderArgument.argument.value.text, "product");

	const predicate = factsOf(result, "liquid.predicate")[0];
	assert.equal(predicate.operator, "greater-than");
	assert.deepEqual(predicate.evidence.range, { start: 543, end: 583 });

	const metafieldReads = factsOf(result, "liquid.access-path").filter(
		(fact) => fact.path.segments.at(-1)?.name === "subtitle",
	);
	assert.equal(metafieldReads.length, 1);
	assert.deepEqual(
		metafieldReads[0].path.segments.map((segment) => segment.name),
		["metafields", "custom", "subtitle"],
	);
	assert.equal(metafieldReads[0].context, "output");

	const headingOutputReads = factsOf(result, "liquid.access-path").filter(
		(fact) =>
			fact.path.root.name === "heading_tag" && fact.context === "output",
	);
	assert.equal(headingOutputReads.length, 2);
});

test("Liquid frontend extracts branch, render-mode, schema, asset, and locale syntax", () => {
	const source = [
		"{% capture label %}{{ product.title | escape }}{% endcapture %}",
		"{% for item in products limit: 3 %}{{ item.title }}{% else %}none{% endfor %}",
		"{{ products[index].title }}",
		"{% render card_name with product as item %}",
		"{{ 'theme.css' | asset_url | stylesheet_tag }}",
		"{{ 'products.title' | t }}",
		"{% unless product.available %}x{% elsif product.tags contains 'x' %}y{% else %}z{% endunless %}",
		'{% schema %}{"name":"Card"}{% endschema %}',
	].join("\n");
	const result = extract(source, "snippets/syntax.liquid");
	assert.deepEqual(result.boundaries, []);
	assert.equal(
		result.coverage.every(({ status }) => status === "complete"),
		true,
	);

	const bindingKinds = factsOf(result, "liquid.binding").map(
		({ binding }) => binding,
	);
	assert.deepEqual(bindingKinds, ["capture", "for"]);
	const renderArgument = factsOf(result, "liquid.render-argument")[0].argument;
	assert.equal(renderArgument.kind, "with");
	assert.equal(renderArgument.value.text, "product");
	assert.equal(renderArgument.alias.name, "item");
	assert.equal(
		factsOf(result, "liquid.access-path").some(
			(fact) =>
				fact.path.root.name === "index" && fact.path.segments.length === 0,
		),
		true,
	);
	assert.deepEqual(
		factsOf(result, "liquid.asset-reference").map(({ syntax }) => syntax),
		["stylesheet-tag-filter", "asset-url-filter"],
	);
	assert.equal(
		factsOf(result, "liquid.locale-reference")[0].key.value,
		"products.title",
	);
	const schema = factsOf(result, "liquid.schema-region")[0];
	assert.equal(
		source.slice(
			schema.contentEvidence.range.start,
			schema.contentEvidence.range.end,
		),
		'{"name":"Card"}',
	);
	assert.deepEqual(
		factsOf(result, "liquid.condition").map(({ construct }) => construct),
		["unless", "elsif"],
	);
	assert.equal(
		factsOf(result, "liquid.guard").some(
			({ outcome }) => outcome === "iterates",
		),
		true,
	);
	assert.equal(
		factsOf(result, "liquid.guard").some(({ outcome }) => outcome === "empty"),
		true,
	);
});

test("Liquid frontend extracts authored markup attributes across Liquid values", () => {
	const source = [
		"{% if product %}",
		'<article class="card {{ active_class }}" data-product-id="{{ product.id }}" disabled>',
		"<button data-action='add'>Add</button>",
		"</article>",
		"{% endif %}",
	].join("\n");
	const result = extract(source, "sections/product.liquid");
	const attributes = factsOf(result, "liquid.markup-attribute");
	assert.deepEqual(
		attributes.map(({ name, element, valueKind }) => [
			name,
			element,
			valueKind,
		]),
		[
			["class", "article", "mixed"],
			["data-product-id", "article", "dynamic"],
			["disabled", "article", "boolean"],
			["data-action", "button", "literal"],
		],
	);
	assert.deepEqual(
		factsOf(result, "liquid.markup-class").map(({ name }) => name),
		["card"],
	);
	assert.equal(
		result.coverage.find(({ family }) => family === "liquid.markup-classes")
			.status,
		"partial",
	);
	const productId = attributes.find(({ name }) => name === "data-product-id");
	assert.equal(
		source.slice(
			productId.nameEvidence.range.start,
			productId.nameEvidence.range.end,
		),
		"data-product-id",
	);
	assert.equal(
		result.coverage.find(({ family }) => family === "liquid.markup-attributes")
			.status,
		"complete",
	);
});

test("Liquid frontend marks dynamic markup attribute names partial", () => {
	const result = extract(
		'<div class="card" {{ block.shopify_attributes }}></div>',
		"sections/dynamic-attributes.liquid",
	);
	assert.deepEqual(
		factsOf(result, "liquid.markup-attribute").map(({ name }) => name),
		["class"],
	);
	assert.equal(
		result.coverage.find(({ family }) => family === "liquid.markup-attributes")
			.status,
		"partial",
	);
	assert.equal(
		result.boundaries.some(({ message }) =>
			message.includes("may emit attribute names"),
		),
		true,
	);
});

test("Liquid frontend marks malformed authored start tags partial", () => {
	const result = extract(
		'<div data-test="unterminated',
		"sections/malformed-markup.liquid",
	);
	assert.equal(
		result.coverage.find(({ family }) => family === "liquid.markup-attributes")
			.status,
		"partial",
	);
	assert.equal(
		result.boundaries.some(({ message }) =>
			message.includes("markup parser could not fully interpret"),
		),
		true,
	);
});

test("Liquid frontend preserves statement evidence inside multi-statement liquid tags", () => {
	const source = `{% liquid
  assign first = ''
  assign second = first | append: 'x'
  if second != blank
    render 'card', value: second
  endif
%}`;
	const result = extract(source, "snippets/liquid-tag.liquid");
	const excerpts = (kind) =>
		factsOf(result, kind).map(({ evidence }) =>
			source.slice(evidence.range.start, evidence.range.end),
		);
	assert.deepEqual(excerpts("liquid.binding"), [
		"assign first = ''",
		"assign second = first | append: 'x'",
	]);
	assert.deepEqual(excerpts("liquid.condition"), ["if second != blank"]);
	assert.deepEqual(excerpts("liquid.render-site"), [
		"render 'card', value: second",
	]);
});

test("Liquid frontend scopes parser uncertainty into explicit partial coverage", () => {
	const result = extract("{% render %}", "snippets/invalid.liquid");
	assert.equal(result.diagnostics[0].code, "TREE_SITTER_MISSING");
	assert.equal(result.boundaries[0].kind, "unsupported-syntax");
	assert.equal(
		result.coverage.every(({ status }) => status === "partial"),
		true,
	);
});

test("Liquid frontend reports bounded partial coverage without over-emitting", () => {
	const result = extract(fixtureSource, fixturePath, { maxFacts: 3 });
	assert.equal(result.facts.length, 3);
	assert.equal(result.work.emitted, 3);
	assert.equal(result.boundaries.length, 1);
	assert.equal(result.boundaries[0].kind, "budget");
	assert.equal(
		result.coverage.every(({ status }) => status === "partial"),
		true,
	);
	assert.equal(
		result.coverage.every(
			({ boundaryIds }) => boundaryIds[0] === result.boundaries[0].id,
		),
		true,
	);
});
