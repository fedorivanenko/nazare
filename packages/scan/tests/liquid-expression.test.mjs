import assert from "node:assert/strict";
import test from "node:test";
import { lookupExpression, scanLiquidExpression } from "../dist/index.js";

const expr = (markup) => scanLiquidExpression(markup);
const paths = (markup) => expr(markup).lookups.map(lookupExpression);

test("expression: property paths", () => {
	assert.deepEqual(paths(" product.featured_image.src "), [
		"product.featured_image.src",
	]);
});

test("expression: bracket access with a literal joins the path", () => {
	assert.deepEqual(paths(`product.metafields["custom"].subtitle`), [
		"product.metafields.custom.subtitle",
	]);
});

test("expression: a computed index ends the static path", () => {
	// `product.images[index]` is only statically known as far as `images`.
	assert.deepEqual(paths("product.images[index].src"), [
		"product.images",
		"index",
	]);
});

test("expression: keywords are syntax, not variables", () => {
	assert.deepEqual(paths("a and b or c contains d"), ["a", "b", "c", "d"]);
	assert.deepEqual(paths("x != blank and y == empty"), ["x", "y"]);
});

test("expression: filters and their subjects", () => {
	const found = expr("'shop.title' | t: name: shop.name | upcase");
	assert.deepEqual(
		found.filters.map((f) => f.name),
		["t", "upcase"],
	);
	assert.deepEqual(
		found.strings.map((s) => s.value),
		["shop.title"],
	);
	// The filter's own `name:` argument is not a tag argument.
	assert.deepEqual(found.namedArguments, []);
	assert.ok(paths("'shop.title' | t: name: shop.name").includes("shop.name"));
});

test("expression: render arguments are named, filter arguments are not", () => {
	const found = expr("'card', product: product, class: 'wide'");
	assert.deepEqual(
		found.namedArguments.map((a) => [a.name, a.value]),
		[
			["product", "product"],
			["class", "'wide'"],
		],
	);
});

test("expression: a filter inside a render argument keeps both readable", () => {
	// The shape the reference parser degrades on.
	const found = expr("'c-social', facebook: 'https://x/?u=' | append: url");
	assert.deepEqual(
		found.strings.map((s) => s.value),
		["c-social", "https://x/?u="],
	);
	assert.deepEqual(
		found.filters.map((f) => f.name),
		["append"],
	);
	assert.equal(found.namedArguments[0]?.name, "facebook");
});

test("expression: ranges are file offsets", () => {
	const found = scanLiquidExpression("product.title", 100);
	assert.deepEqual(found.lookups[0].range, { start: 100, end: 113 });
});

test("expression: an unterminated string does not hang or overrun", () => {
	const found = expr("'unterminated");
	assert.deepEqual(
		found.strings.map((s) => s.value),
		["unterminated"],
	);
});
