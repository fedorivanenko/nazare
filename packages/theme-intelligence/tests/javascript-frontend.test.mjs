import assert from "node:assert/strict";
import test from "node:test";
import { javaScriptFrontend } from "../dist/index.js";
import { JavaScriptParserProvider } from "../dist/parsers/javascript/parser.js";

function extract(source, path = "assets/theme.js", limits = {}) {
	const parsed = new JavaScriptParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	return javaScriptFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 1_000, maxWork: 10_000, ...limits },
	});
}

test("JavaScript frontend extracts direct classList lifecycle roles", () => {
	const source = [
		"element.classList.add('is-active', `is-ready`);",
		'element["classList"].remove("is-hidden");',
		"element?.classList.toggle('is-open', force);",
		"element.classList.contains('is-selected');",
		"element.classList.replace('is-old', 'is-new');",
		"const ignored = '.not-a-class-operation';",
	].join("\n");
	const result = extract(source);
	assert.deepEqual(result.boundaries, []);
	assert.deepEqual(
		result.facts.map(({ action, name }) => [action, name]),
		[
			["adds", "is-active"],
			["adds", "is-ready"],
			["removes", "is-hidden"],
			["toggles", "is-open"],
			["reads", "is-selected"],
			["removes", "is-old"],
			["adds", "is-new"],
		],
	);
	assert.deepEqual(
		result.facts.map(({ nameEvidence }) =>
			source.slice(nameEvidence.range.start, nameEvidence.range.end),
		),
		[
			"is-active",
			"is-ready",
			"is-hidden",
			"is-open",
			"is-selected",
			"is-old",
			"is-new",
		],
	);
	assert.equal(result.coverage[0].status, "complete");
});

test("JavaScript frontend keeps runtime class names explicitly partial", () => {
	const source = [
		"element.classList.add(className);",
		"element.classList.toggle(`state-$" + "{value}`);",
		"element.classList[method]('is-active');",
	].join("\n");
	const result = extract(source);
	assert.deepEqual(result.facts, []);
	assert.equal(result.coverage[0].status, "partial");
	assert.equal(result.boundaries.length, 3);
	assert.equal(
		result.boundaries.every(({ kind }) => kind === "dynamic-syntax"),
		true,
	);
});

test("JavaScript frontend rejects invalid static DOMTokenList tokens", () => {
	const result = extract("element.classList.add('two classes', '');");
	assert.deepEqual(result.facts, []);
	assert.equal(result.boundaries.length, 2);
	assert.equal(
		result.boundaries.every(({ kind }) => kind === "unsupported-syntax"),
		true,
	);
});

test("JavaScript frontend reports bounded partial coverage", () => {
	const result = extract(
		"a.classList.add('a'); b.classList.add('b'); c.classList.add('c');",
		"assets/theme.js",
		{ maxFacts: 2 },
	);
	assert.deepEqual(
		result.facts.map(({ name }) => name),
		["a", "b"],
	);
	assert.equal(result.boundaries.at(-1).kind, "budget");
	assert.equal(result.coverage[0].status, "partial");
});
