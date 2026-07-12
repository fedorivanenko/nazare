import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

function compile(source, readFile) {
	return compileNazareArtifact(source, "component.nz.liquid", { readFile });
}

function emit(source, readFile) {
	return emitTheme(source, compile(source, readFile), { name: "widget" });
}

function fileByPath(result, path) {
	return result.files.find((file) => file.path === path);
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

test("style: bound stylesheet classes rewrite to readable scoped names", () => {
	const source = `<div class="{{ styles.wrapper }}">
  <button class="{{ styles.action }}">Go</button>
</div>

{% stylesheet styles %}
.wrapper { display: flex; }
.wrapper .action, .action:hover { color: red; }
{% endstylesheet %}`;
	const result = emit(source);

	const css = fileByPath(result, "assets/widget.css")?.contents;
	assert.ok(css.includes(".nz-widget__wrapper { display: flex; }"));
	assert.ok(
		css.includes(".nz-widget__wrapper .nz-widget__action, .nz-widget__action:hover"),
	);

	const liquid = fileByPath(result, "snippets/widget.liquid")?.contents;
	assert.ok(!liquid.includes("{% stylesheet"));
	assert.ok(liquid.includes('class="nz-widget__wrapper"'));
	assert.ok(liquid.includes('class="nz-widget__action"'));
	assert.ok(liquid.includes("'widget.css' | asset_url | stylesheet_tag"));
	// Scoping is the class rewrite; no root stamp for style-only components.
	assert.ok(!liquid.includes("data-nz-component"));
});

test("style: imported css binds a class map the same way", () => {
	const readFile = (path) =>
		path === "card.css" ? `.card { padding: 1rem; }\n` : undefined;
	const source = `{% import styles from "./card.css" %}
<div class="{{ styles.card }}"></div>`;
	const result = emit(source, readFile);
	const css = fileByPath(result, "assets/widget.css")?.contents;
	assert.ok(css.includes(".nz-widget__card { padding: 1rem; }"));
	const liquid = fileByPath(result, "snippets/widget.liquid")?.contents;
	assert.ok(liquid.includes('class="nz-widget__card"'));
});

test("style: unbound stylesheet passes through untouched", () => {
	const source = `<div class="w"></div>
{% stylesheet %}
.w { color: blue; }
{% endstylesheet %}`;
	const compiled = compile(source);
	assert.ok(!codes(compiled).some((code) => code.includes("STYLE_CLASS")));
	const css = fileByPath(
		emitTheme(source, compiled, { name: "widget" }),
		"assets/widget.css",
	)?.contents;
	assert.ok(css.includes(".w { color: blue; }"));
	assert.ok(!css.includes("nz-widget"));
});

test("style: unknown styles.x reference is an error", () => {
	const result = compile(`<div class="{{ styles.ghost }}"></div>
{% stylesheet styles %}
.wrapper { display: flex; }
{% endstylesheet %}`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNKNOWN_STYLE_CLASS",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("ghost"));
});

test("style: unused class in a bound sheet warns with a css span", () => {
	const result = compile(`<div class="{{ styles.wrapper }}"></div>
{% stylesheet styles %}
.wrapper { display: flex; }
.orphan { color: red; }
{% endstylesheet %}`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNUSED_STYLE_CLASS",
	);
	assert.equal(issue?.severity, "warning");
	assert.ok(issue.message.includes("orphan"));
	assert.equal(issue.span?.start.line, 4, "points at .orphan in the css");
});

test("style: bracket access reaches kebab-case classes", () => {
	const source = `<div class="{{ styles["hero-image"] }}"></div>
{% stylesheet styles %}
.hero-image { width: 100%; }
{% endstylesheet %}`;
	const result = compile(source);
	assert.ok(!codes(result).some((code) => code.includes("STYLE_CLASS")));
	const liquid = fileByPath(
		emitTheme(source, result, { name: "widget" }),
		"snippets/widget.liquid",
	)?.contents;
	assert.ok(liquid.includes('class="nz-widget__hero-image"'));
});

test("style: references inside control flow count and lower", () => {
	const source = `{% props { on: boolean.setting({ label: "On" }) } %}
{% if props.on %}<div class="{{ styles.wrapper }}"></div>{% endif %}
{% stylesheet styles %}
.wrapper { display: flex; }
{% endstylesheet %}`;
	const result = compile(source);
	assert.ok(!codes(result).some((code) => code.includes("STYLE_CLASS")));
	const liquid = fileByPath(
		emitTheme(source, result, { name: "widget" }),
		"snippets/widget.liquid",
	)?.contents;
	assert.ok(liquid.includes('class="nz-widget__wrapper"'));
});

test("style: styles.x as a render argument lowers to a quoted literal", () => {
	const readFile = (path) =>
		path === "link.nz.liquid"
			? `{% props { href: url.required(), text: string.required(), class: string.optional() } %}`
			: undefined;
	const source = `{% import Link from "./link.nz.liquid" %}
{% render Link { href: section.settings.u, text: "Go", class: styles.cta } %}
{% stylesheet styles %}
.cta { color: red; }
{% endstylesheet %}`;
	const result = compile(source, readFile);
	assert.ok(!codes(result).some((code) => code.includes("STYLE_CLASS")));
	const liquid = fileByPath(
		emitTheme(source, result, { name: "widget", readFile }),
		"snippets/widget.liquid",
	)?.contents;
	assert.ok(liquid.includes(`class: "nz-widget__cta"`));
});

test("style: declarations and urls never match as classes", () => {
	const result = compile(`<div class="{{ styles.w }}"></div>
{% stylesheet styles %}
.w { background: url(img.png); margin: 0.5rem; }
{% endstylesheet %}`);
	const unused = result.issues.filter(
		(issue) => issue.code === "CONSTRAINT_UNUSED_STYLE_CLASS",
	);
	assert.deepEqual(unused, [], "png/5rem are not class definitions");
});

test("style: media queries scope inner classes, keyframes pass through", () => {
	const source = `<div class="{{ styles.w }}"></div>
{% stylesheet styles %}
@media (min-width: 750px) {
  .w { gap: 2rem; }
}
@keyframes spin {
  from { transform: rotate(0); }
  to { transform: rotate(360deg); }
}
{% endstylesheet %}`;
	const css = fileByPath(emit(source), "assets/widget.css")?.contents;
	assert.ok(css.includes("@media (min-width: 750px)"));
	assert.ok(css.includes(".nz-widget__w { gap: 2rem; }"));
	assert.ok(css.includes("from { transform: rotate(0); }"));
});

test("style: capitalized stylesheet binding is an error", () => {
	const result = compile(`<div></div>
{% stylesheet Styles %}
.w { color: red; }
{% endstylesheet %}`);
	assert.ok(codes(result).includes("NAZARE_IMPORT_BINDING_CASE"));
});

test("style: malformed stylesheet binding is a parse error", () => {
	const result = compile(`<div></div>
{% stylesheet "styles" %}
.w { color: red; }
{% endstylesheet %}`);
	assert.ok(codes(result).includes("NAZARE_PARSE_STYLESHEET_BINDING"));
});

test("style: css braces do not confuse the liquid parser", () => {
	const source = `<div class="w"></div>
{% stylesheet %}
.w::before { content: "{{ not liquid }}"; }
{% endstylesheet %}`;
	const compiled = compile(source);
	const style = compiled.ir.syntax.find((node) => node.kind === "style");
	assert.ok(style?.source.includes('content: "{{ not liquid }}"'));
	assert.deepEqual(
		compiled.issues.filter((issue) => issue.severity === "error"),
		[],
	);
});
