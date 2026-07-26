import assert from "node:assert/strict";
import test from "node:test";
import {
	createDefaultSourceParserRegistry,
	MissingSourceGrammarError,
	parseSourceDocument,
	SourceAnalysisHost,
	SourceFile,
	SourceOffsetIndex,
	SourceParserRegistry,
	UnsupportedSourceLanguageError,
} from "../dist/index.js";

const registry = createDefaultSourceParserRegistry();

test("central offset index converts UTF-8 bytes and UTF-16 offsets", () => {
	const index = new SourceOffsetIndex("aé😀\r\nb");
	assert.equal(index.byteAt(0), 0);
	assert.equal(index.byteAt(1), 1);
	assert.equal(index.byteAt(2), 3);
	assert.equal(index.byteAt(4), 7);
	assert.equal(index.utf16At(7), 4);
	assert.deepEqual(index.bytePointAt(4), { row: 0, column: 7 });
	assert.deepEqual(index.treePointAt(4), { row: 0, column: 4 });
	assert.deepEqual(index.positionAt(6), { line: 2, column: 1 });
	assert.throws(() => index.byteAt(3), /splits a surrogate pair/);
	assert.throws(() => index.utf16At(2), /splits a code point/);
});

test("plain Liquid produces a persistent CST with UTF-16 issue ranges", () => {
	const document = parseSourceDocument(
		registry,
		"snippets/x.liquid",
		"liquid",
		"😀 {{ product.title }}",
	);
	assert.equal(document.tree.rootNode.type, "program");
	assert.deepEqual(document.issues, []);
	const access = document.tree.rootNode.namedChildren[1];
	assert.equal(access.type, "access");
	assert.equal(
		access.startIndex,
		6,
		"node-tree-sitter exposes JavaScript UTF-16 indices",
	);
});

test("embedded region scan ignores closing tags in JS and CSS lexical trivia", () => {
	const source = `{% script lang="ts" %}
const a = "{% endscript %}";
const b = /{% endscript %}/;
// {% endscript %}
/* {% endscript %} */
{% endscript %}
{% stylesheet %}
.x::after { content: "{% endstylesheet %}"; }
/* {% endstylesheet %} */
{% endstylesheet %}`;
	const document = parseSourceDocument(
		registry,
		"components/x.nz.liquid",
		"nazare-liquid",
		source,
	);
	assert.equal(document.embeddedRegions.length, 2);
	const [script, style] = document.embeddedRegions;
	assert.equal(script.language, "typescript");
	assert.match(
		source.slice(script.bodyRange.start, script.bodyRange.end),
		/const b/,
	);
	assert.equal(style.language, "css");
	assert.match(
		source.slice(style.bodyRange.start, style.bodyRange.end),
		/content/,
	);
});

test("script language contract maps explicit ts only to TypeScript", () => {
	for (const [opening, language] of [
		["{% script %}", "javascript"],
		['{% script lang="js" %}', "javascript"],
		['{% script lang="ts" %}', "typescript"],
	]) {
		const source = `${opening}x();{% endscript %}`;
		const document = parseSourceDocument(
			registry,
			"x.nz.liquid",
			"nazare-liquid",
			source,
		);
		assert.equal(document.embeddedRegions[0].language, language);
	}
});

test("incremental edit reuses old tree and reports UTF-16 changed ranges", () => {
	const file = new SourceFile(
		registry,
		"x.liquid",
		"liquid",
		"😀 {{ foo }}\r\ntext",
	);
	const oldTree = file.document.tree;
	const update = file.update([{ start: 6, end: 9, text: "bar" }]);
	assert.notEqual(update.document.tree, oldTree);
	assert.equal(update.document.source, "😀 {{ bar }}\r\ntext");
	assert.deepEqual(update.changedRanges, [{ start: 6, end: 9 }]);
	assert.deepEqual(update.document.issues, []);
});

test("incremental edits before multibyte text preserve source and ranges", () => {
	const file = new SourceFile(
		registry,
		"x.liquid",
		"liquid",
		"é😀\r\n{{ value }",
	);
	assert.ok(file.document.issues.length > 0);
	file.update([{ start: 0, end: 0, text: "a" }]);
	const close = file.update([
		{
			start: file.document.source.length,
			end: file.document.source.length,
			text: "}",
		},
	]);
	assert.equal(close.document.source, "aé😀\r\n{{ value }}");
	assert.deepEqual(close.document.issues, []);
});

test("Liquid delimiters inside quoted strings remain string syntax", () => {
	const document = parseSourceDocument(
		registry,
		"x.liquid",
		"liquid",
		'{{ "}}" }} {{ "{% endscript %}" }}',
	);
	assert.deepEqual(document.issues, []);
	assert.deepEqual(document.embeddedRegions, []);
});

test("incremental lang edit refreshes embedded language", () => {
	const source = '{% script lang="js" %}x();{% endscript %}';
	const file = new SourceFile(registry, "x.nz.liquid", "nazare-liquid", source);
	const start = source.indexOf("js");
	const update = file.update([{ start, end: start + 2, text: "ts" }]);
	assert.equal(update.document.embeddedRegions[0].language, "typescript");
});

test("analysis host has explicit lifecycle", () => {
	const host = new SourceAnalysisHost(registry);
	host.openFile("x.liquid", "liquid", "{{ x }}");
	assert.equal(host.getDocument("x.liquid")?.file, "x.liquid");
	assert.throws(() => host.openFile("x.liquid", "liquid", ""), /already open/);
	assert.equal(host.removeFile("x.liquid"), true);
	assert.equal(host.getDocument("x.liquid"), undefined);
});

test("unsupported and missing grammars fail explicitly", () => {
	assert.throws(
		() => registry.createParser("html"),
		UnsupportedSourceLanguageError,
	);
	assert.throws(
		() => new SourceParserRegistry().createParser("liquid"),
		MissingSourceGrammarError,
	);
});
