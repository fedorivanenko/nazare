import assert from "node:assert/strict";
import test from "node:test";
import {
	liquidAssetReferences,
	liquidBlocks,
	liquidDocParams,
	liquidGuards,
	liquidLocalBindings,
	liquidLocaleReferences,
	liquidReads,
	liquidRenderArguments,
	scanLiquid,
} from "../dist/index.js";

const tokens = (source) => scanLiquid(source).tokens;

test("readings: blocks pair with their end tags, nested", () => {
	const found = liquidBlocks(
		tokens("{% if a %}{% for b in c %}{{ b }}{% endfor %}{% endif %}"),
	);
	assert.deepEqual(
		found.map((block) => block.name),
		["for", "if"],
	);
	const [inner, outer] = found;
	assert.ok(
		outer.range.start < inner.range.start && inner.range.end < outer.range.end,
		"the inner block sits inside the outer one",
	);
});

test("readings: reads carry their syntactic position", () => {
	const found = liquidReads(
		tokens("{% if product %}{{ product.title }}{% render 'c', p: order %}"),
	);
	assert.deepEqual(
		found.map((read) => [
			read.expression,
			read.inCondition,
			read.inRenderArgument,
		]),
		[
			["product", true, false],
			["product.title", false, false],
			["order", false, true],
		],
	);
});

test("readings: a condition guards the name it tests", () => {
	assert.deepEqual(
		liquidGuards(tokens("{% if heading %}{{ heading }}{% endif %}")).map(
			(g) => [g.name, g.via],
		),
		[["heading", "guard"]],
	);
});

test("readings: guarding a property does not guard its root", () => {
	// `{% if product.metafields.x %}` shows the file handles that property being
	// missing, not that it handles `product` being absent. Attributing it to the
	// root would make a required input look optional.
	assert.deepEqual(
		liquidGuards(tokens("{% if product.metafields.custom.badge %}{% endif %}")),
		[],
	);
});

test("readings: a default filter guards the name too", () => {
	assert.deepEqual(
		liquidGuards(tokens("{{ heading | default: 'Hi' }}")).map((g) => [
			g.name,
			g.via,
		]),
		[["heading", "default"]],
	);
});

test("readings: named render arguments with their source lookup", () => {
	const [first, second] = liquidRenderArguments(
		tokens("{% render 'card', product: item, size: 'lg' %}"),
	);
	assert.deepEqual(
		[first.targetName, first.argumentName, first.valueExpression],
		["card", "product", "item"],
	);
	assert.equal(first.source?.root, "item");
	assert.deepEqual(
		[second.argumentName, second.valueExpression, second.source],
		["size", "'lg'", undefined],
	);
});

test("readings: `with` binds to the target name, `as` renames it", () => {
	assert.deepEqual(
		liquidRenderArguments(tokens("{% render 'card' with product %}")).map(
			(a) => [a.argumentName, a.valueExpression],
		),
		[["card", "product"]],
	);
	assert.deepEqual(
		liquidRenderArguments(tokens("{% render 'card' for items as item %}")).map(
			(a) => [a.argumentName, a.valueExpression],
		),
		[["item", "items"]],
	);
});

test("readings: asset and locale references come from the filter chain", () => {
	const source = `{{ 'theme.css' | asset_url }}{{ 'shop.title' | t }}{{ 'x' | append: 'y' }}`;
	assert.deepEqual(
		liquidAssetReferences(tokens(source)).map((r) => r.value),
		["theme.css"],
	);
	assert.deepEqual(
		liquidLocaleReferences(tokens(source)).map((r) => r.value),
		["shop.title"],
	);
});

test("readings: a literal used as a filter argument is not a reference", () => {
	// `| t: name: 'x'` translates the subject, not the argument.
	assert.deepEqual(
		liquidLocaleReferences(tokens("{{ 'greeting' | t: name: 'Ada' }}")).map(
			(r) => r.value,
		),
		["greeting"],
	);
});

test("readings: doc params, required and optional", () => {
	const source = `{% doc %}
  @param {product} product - The product to render.
  @param {string} [heading_tag] - Optional heading element.
  @param bare
{% enddoc %}`;
	assert.deepEqual(
		liquidDocParams(tokens(source)).map((p) => [
			p.name,
			p.required,
			p.paramType,
			p.description,
		]),
		[
			["product", true, "product", "The product to render."],
			["heading_tag", false, "string", "Optional heading element."],
			["bare", true, undefined, undefined],
		],
	);
});

test("readings: a doc block is not scanned as Liquid", () => {
	// `@param {product} product` must not become a read of `product`.
	assert.deepEqual(
		liquidReads(tokens("{% doc %}\n  @param {product} product\n{% enddoc %}")),
		[],
	);
});

test("readings: bindings carry what they were bound to", () => {
	// Resolving `menu.links` back to `linklists.…` is data flow the caller owns.
	// The scanner's job is to say what the name was bound to.
	const found = liquidLocalBindings(
		tokens(
			"{% assign menu = linklists[section.settings.menu] %}{% for link in menu.links %}{% endfor %}",
		),
		1000,
	);
	assert.deepEqual(
		found
			.filter((b) => b.via !== "for" || b.name !== "forloop")
			.map((b) => [b.name, b.via, b.value]),
		[
			["menu", "assign", "linklists[section.settings.menu]"],
			["link", "for", "menu.links"],
		],
	);
});

test("readings: a self-referential assign still reads its own right side", () => {
	// `{% assign n = n | to_i %}` binds `n` on the left and reads it on the
	// right. Skipping every occurrence by name lost the read.
	assert.deepEqual(
		liquidReads(tokens("{% assign n = n | to_i %}")).map((r) => r.expression),
		["n"],
	);
	// The binding site itself is still not a read.
	assert.deepEqual(
		liquidReads(tokens("{% assign n = 1 %}")).map((r) => r.expression),
		[],
	);
});
