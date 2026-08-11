import assert from "node:assert/strict";
import test from "node:test";
import { cssFrontend } from "../dist/index.js";
import { CssParserProvider } from "../dist/parsers/css/parser.js";

function extract(source, path = "assets/theme.css", limits = {}) {
	const parsed = new CssParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	return cssFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 1_000, maxWork: 10_000, ...limits },
	});
}

test("CSS frontend extracts exact class selectors without attribute false positives", () => {
	const source = [
		'.card.is-active, :is(.featured, .product\\:card) [data-hook=".ignored"] {',
		"  color: red;",
		"}",
	].join("\n");
	const result = extract(source);
	assert.deepEqual(result.boundaries, []);
	assert.deepEqual(
		result.facts.map(({ name }) => name),
		["card", "is-active", "featured", "product:card"],
	);
	assert.deepEqual(
		result.facts.map(({ nameEvidence }) =>
			source.slice(nameEvidence.range.start, nameEvidence.range.end),
		),
		["card", "is-active", "featured", "product\\:card"],
	);
	assert.equal(result.coverage[0].status, "complete");
});

test("SCSS frontend handles nesting and scopes interpolation uncertainty", () => {
	const source = [
		".header {",
		"  &.is-open, &:not(.is-closing) { color: red; }",
		"  .item-#{$state} { color: blue; }",
		"}",
	].join("\n");
	const result = extract(source, "styles/_header.scss");
	assert.deepEqual(
		result.facts.map(({ name }) => name),
		["header", "is-open", "is-closing"],
	);
	assert.equal(result.coverage[0].status, "partial");
	assert.equal(result.boundaries.length, 1);
	assert.equal(result.boundaries[0].kind, "dynamic-syntax");
	assert.equal(
		source.slice(
			result.boundaries[0].range.start,
			result.boundaries[0].range.end,
		),
		".item-#{$state}",
	);
});

test("CSS frontend reports bounded partial coverage", () => {
	const result = extract(".a, .b, .c { color: red; }", "assets/theme.css", {
		maxFacts: 2,
	});
	assert.deepEqual(
		result.facts.map(({ name }) => name),
		["a", "b"],
	);
	assert.equal(result.boundaries.at(-1).kind, "budget");
	assert.equal(result.coverage[0].status, "partial");
});
