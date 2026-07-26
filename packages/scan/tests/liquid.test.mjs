import assert from "node:assert/strict";
import test from "node:test";
import {
	BLOCK_TAGS,
	LineIndex,
	liquidDependencies,
	liquidSchema,
	liquidSettingsReads,
	RAW_TAGS,
	scanLiquid,
	TAGS_WITHOUT_MARKUP,
} from "../dist/index.js";

const document = (source) => {
	const scan = scanLiquid(source);
	assert.equal(scan.status, "valid");
	return scan.document;
};
const deps = (source) => liquidDependencies(document(source));
const reads = (source) => liquidSettingsReads(document(source));

test("scan: the tag vocabulary matches the reference parser's own tables", async () => {
	// The spec tables are copied from @shopify/liquid-html-parser's grammar
	// module. If a parser upgrade changes them, the scanner is scanning a
	// different language than the build path parses, and this fails.
	const grammar = await import(
		"../../compiler/node_modules/@shopify/liquid-html-parser/dist/grammar.js"
	);
	assert.deepEqual([...BLOCK_TAGS].sort(), [...grammar.BLOCKS].sort());
	assert.deepEqual([...RAW_TAGS].sort(), [...grammar.RAW_TAGS].sort());
	assert.deepEqual(
		[...TAGS_WITHOUT_MARKUP].sort(),
		[...grammar.TAGS_WITHOUT_MARKUP].sort(),
	);
});

test("scan: static and dynamic dependencies", () => {
	assert.deepEqual(
		deps("{% render 'card' %}{% render block %}{% include 'old' %}").map(
			(d) => [d.kind, d.invocationKind, d.name],
		),
		[
			["snippet", "render", "card"],
			["snippet", "render", undefined],
			["snippet", "include", "old"],
		],
	);
});

test("scan: section, section group, and layout", () => {
	assert.deepEqual(
		deps(
			"{% section 'header' %}{% sections 'header-group' %}{% layout 'theme' %}{% layout none %}",
		).map((d) => [d.kind, d.name]),
		[
			["section", "header"],
			["section-group", "header-group"],
			["layout", "theme"],
			["layout", "none"],
		],
	);
});

test("scan: a filter in a render argument keeps the target name", () => {
	// The reference parser degrades this to a dynamic reference and loses the
	// edge — the defect this scanner was built to fix. See findings.md.
	const found = deps(
		"{% render 'c-social', facebook: 'https://x/?u=' | append: url, class: 'gap-3' %}",
	);
	assert.deepEqual(
		found.map((d) => d.name),
		["c-social"],
	);
});

test("scan: closing delimiters inside strings do not close tags", () => {
	assert.deepEqual(
		deps("{% assign marker = '%}' %}{% render 'card' %}").map(
			(dependency) => dependency.name,
		),
		["card"],
	);
	assert.equal(document("{{ '}}' | append: value }}").tokens.length, 1);
});

test("scan: {% liquid %} statements are tags in their own right", () => {
	const source = `{%- liquid
  assign a = 1
  render 'price'
  render 'media'
-%}`;
	assert.deepEqual(
		deps(source).map((d) => d.name),
		["price", "media"],
	);
});

test("scan: prose in a {% liquid %} comment does not derail the scan", () => {
	// An apostrophe here once put a quote-aware scanner into a string it never
	// left, silently dropping every fact in the rest of the file.
	const source = `{% liquid
  comment
    Author = the metaobject. Don't treat {% examples as nested tags.
  endcomment
  render 'after-the-comment'
%}
{% render 'later' %}`;
	assert.deepEqual(
		deps(source).map((d) => d.name),
		["after-the-comment", "later"],
	);
});

test("scan: raw bodies are not scanned for Liquid", () => {
	const source = `{% comment %}{% render 'ignored' %}{% endcomment %}
{% raw %}{{ settings.ignored }}{% endraw %}
{% render 'real' %}`;
	assert.deepEqual(
		deps(source).map((d) => d.name),
		["real"],
	);
	assert.deepEqual(reads(source), []);
});

test("scan: settings reads by root object", () => {
	assert.deepEqual(
		reads(
			"{{ settings.a }}{{ section.settings.b }}{{ block.settings.c }}{{ other.settings.d }}",
		).map((r) => [r.object, r.name]),
		[
			["settings", "a"],
			["section", "b"],
			["block", "c"],
		],
	);
});

test("scan: settings reads inside tag arguments", () => {
	// `{% paginate … by section.settings.per_page %}` — a read the reference
	// parser loses, because PaginateMarkup is not in its known-children list.
	assert.deepEqual(
		reads(
			"{%- paginate blog.articles by section.settings.per_page -%}{% endpaginate %}",
		).map((read) => [read.object, read.name]),
		[["section", "per_page"]],
	);
});

test("scan: settings reads come from lookups, not string contents", () => {
	assert.deepEqual(reads('{{ "settings.not_a_read" }}'), []);
	assert.deepEqual(
		reads('{{ settings["heading"] }}{{ section.settings["columns"] }}').map(
			(read) => [read.object, read.name],
		),
		[
			["settings", "heading"],
			["section", "columns"],
		],
	);
});

test("scan: schema body is handed out unparsed", () => {
	const source = `<div></div>\n{% schema %}\n{ "name": "Hero" }\n{% endschema %}\n`;
	const schema = liquidSchema(document(source));
	assert.equal(JSON.parse(schema.body).name, "Hero");
});

test("scan: an unterminated tag is reported without swallowing the next tag", () => {
	const scan = scanLiquid("{% render 'a' %}\n{% oops\n{% render 'b' %}");
	assert.equal(scan.status, "invalid");
	assert.deepEqual(
		scan.partialTokens
			.filter((token) => token.kind === "tag" && token.name === "render")
			.map((token) => token.markup.trim()),
		["'a'", "'b'"],
	);
	assert.deepEqual(
		scan.issues.map((issue) => issue.code),
		["UNTERMINATED_TAG"],
	);
});

test("scan: mismatched block closes are explicit and do not repair the stack", () => {
	const scan = scanLiquid("{% if a %}{% for x in y %}{% endif %}");
	assert.equal(scan.status, "invalid");
	assert.deepEqual(
		scan.issues.map((issue) => [issue.code, issue.name]),
		[
			["MISMATCHED_BLOCK", "if"],
			["UNCLOSED_BLOCK", "if"],
			["UNCLOSED_BLOCK", "for"],
		],
	);
});

test("scan: an unclosed raw statement inside liquid is reported", () => {
	const scan = scanLiquid("{% liquid\n  comment\n    words\n%}");
	assert.equal(scan.status, "invalid");
	assert.deepEqual(
		scan.issues.map((issue) => [issue.code, issue.name]),
		[["UNCLOSED_RAW_TAG", "comment"]],
	);
});

test("scan: an unclosed raw tag is reported", () => {
	const scan = scanLiquid("{% comment %}\nnever closed");
	assert.equal(scan.status, "invalid");
	assert.deepEqual(
		scan.issues.map((issue) => [issue.code, issue.name]),
		[["UNCLOSED_RAW_TAG", "comment"]],
	);
});

test("scan: ranges resolve to the right line and column", () => {
	const source = "<div>\n  {% render 'card' %}\n</div>";
	const [dependency] = deps(source);
	const span = new LineIndex(source).spanAt("s.liquid", dependency.range);
	assert.deepEqual(span.start, { line: 2, column: 3 });
});

test("scan: authored and canonical tag names are both observable", () => {
	const [token] = document("{% ReNdEr 'card' %}").tokens;
	assert.equal(token.authoredName, "ReNdEr");
	assert.equal(token.name, "render");
});

test("scan: expression errors invalidate the document", () => {
	const scan = scanLiquid("{{ title | default: 'missing }}");
	assert.equal(scan.status, "invalid");
	assert.deepEqual(
		scan.issues.map((issue) => issue.code),
		["UNTERMINATED_STRING"],
	);
});

test("scan: source positions reject invalid offsets and reversed ranges", () => {
	const index = new LineIndex("abc");
	assert.throws(() => index.positionAt(-1), RangeError);
	assert.throws(() => index.positionAt(4), RangeError);
	assert.throws(
		() => index.spanAt("x.liquid", { start: 2, end: 1 }),
		RangeError,
	);
});
