import assert from "node:assert/strict";
import test from "node:test";
import { cssClassTokens, rewriteCssClasses } from "../dist/css-modules.js";

test("css modules: parses selector classes inside :is()", () => {
	const tokens = cssClassTokens(
		`.card:is(.featured, .compact) { color: red; }`,
	);
	assert.deepEqual(
		tokens.map((token) => token.name),
		["card", "featured", "compact"],
	);
});

test("css modules: ignores declaration values, strings, and comments", () => {
	const tokens = cssClassTokens(`
/* .commented */
.card::before {
	content: ".not-a-selector";
	background: url(".asset.svg");
}
`);
	assert.deepEqual(
		tokens.map((token) => token.name),
		["card"],
	);
});

test("css modules: rewrites nested and functional selectors", () => {
	assert.equal(
		rewriteCssClasses(
			`.card:is(.featured, .compact) { & .label { color: red; } }`,
			(className) => `x-${className}`,
		),
		`.x-card:is(.x-featured, .x-compact) { & .x-label { color: red; } }`,
	);
});
