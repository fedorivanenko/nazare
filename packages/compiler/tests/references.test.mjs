// The reference node replaces the old textual lowering. These guard the two
// things that model buys: references are located only inside Liquid
// expression regions (so literal text can never be clobbered), and lowering
// is a span projection of those located nodes.
import assert from "node:assert/strict";
import test from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

function build(source) {
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	const liquid = emitTheme(source, compiled, { name: "w" }).files.find(
		(f) => f.path === "snippets/w.liquid",
	)?.contents;
	return { compiled, liquid };
}

test("references: located from output tags and control-flow conditions", () => {
	const { compiled } = build(
		`{% props { title: string.setting({ label: "T" }), href: url.required() } %}\n<a href="{{ props.href }}">{% if props.href != blank %}{{ props.title }}{% endif %}</a>`,
	);
	const refs = compiled.ir.syntax.filter((n) => n.kind === "reference");
	assert.deepEqual(
		refs.map((r) => r.name).sort(),
		["href", "href", "title"],
		"both the output and the condition read of href are located",
	);
	assert.ok(refs.every((r) => r.target === "prop" && r.span));
});

test("references: a declared prop name in literal text is NOT lowered", () => {
	// The old regex over emitted output would clobber this; the scanner only
	// sees Liquid expression regions, so literal text is untouched.
	const { liquid } = build(
		`{% props { title: string.setting({ label: "T" }) } %}\n<p>Type props.title to insert the {{ props.title }}.</p>`,
	);
	assert.ok(
		liquid.includes("Type props.title to insert the"),
		"literal 'props.title' survives",
	);
	assert.ok(
		liquid.includes("{{ section.settings.title }}."),
		"the real read lowers",
	);
	assert.ok(!liquid.includes("section.settings.title to insert"));
});

test("references: a styles-looking token in literal text is NOT scoped", () => {
	const { liquid } = build(
		`<p>see styles.wrapper in the docs</p>\n<div class="{{ styles.wrapper }}"></div>\n{% stylesheet styles %}\n.wrapper { display: flex; }\n{% endstylesheet %}`,
	);
	assert.ok(liquid.includes("see styles.wrapper in the docs"));
	assert.ok(liquid.includes('class="nz-w__styles__wrapper"'));
});

test("references: style output drops braces, render-arg style is quoted", () => {
	const readFile = (path) =>
		path === "link.nz.liquid"
			? `{% props { href: url.required(), text: string.required(), class: string.optional() } %}`
			: undefined;
	const source = `{% import Link from "./link.nz.liquid" %}
<div class="{{ styles.box }}"></div>
{% render Link { href: section.settings.u, text: "Go", class: styles.cta } %}
{% stylesheet styles %}
.box { color: red; }
.cta { color: blue; }
{% endstylesheet %}`;
	const compiled = compileNazareArtifact(source, "component.nz.liquid", {
		readFile,
	});
	const liquid = emitTheme(source, compiled, {
		name: "w",
		readFile,
	}).files.find((f) => f.path === "snippets/w.liquid")?.contents;
	assert.ok(liquid.includes('class="nz-w__styles__box"'), "output: bare class");
	assert.ok(
		liquid.includes(`class: "nz-w__styles__cta"`),
		"render arg: quoted class",
	);
});
