import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

function emit(source) {
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	return emitTheme(source, compiled, { name: "widget" });
}

function fileByPath(result, path) {
	return result.files.find((file) => file.path === path);
}

test("style: stylesheet block becomes a scoped css asset", () => {
	const result = emit(`<div ref="root" class="widget">
  <button ref="trigger">Go</button>
</div>

{% stylesheet %}
.widget { display: flex; }
.widget button, .widget a { color: red; }
{% endstylesheet %}`);

	const css = fileByPath(result, "assets/widget.css")?.contents;
	assert.ok(css);
	assert.ok(css.includes('[data-nz-component="widget"] .widget,'));
	assert.ok(css.includes('[data-nz-component="widget"]:is(.widget)'));
	assert.ok(css.includes('[data-nz-component="widget"] .widget button'));

	const liquid = fileByPath(result, "snippets/widget.liquid")?.contents;
	assert.ok(!liquid.includes("{% stylesheet"));
	assert.ok(liquid.includes("'widget.css' | asset_url | stylesheet_tag"));
	assert.ok(liquid.includes('data-nz-component="widget"'));
});

test("style: media queries recurse, keyframes pass through", () => {
	const result = emit(`<div class="w"></div>
{% stylesheet %}
@media (min-width: 750px) {
  .w { gap: 2rem; }
}
@keyframes spin {
  from { transform: rotate(0); }
  to { transform: rotate(360deg); }
}
{% endstylesheet %}`);

	const css = fileByPath(result, "assets/widget.css")?.contents;
	assert.ok(css.includes("@media (min-width: 750px)"));
	assert.ok(css.includes('[data-nz-component="widget"] .w,'));
	assert.ok(css.includes("gap: 2rem"));
	assert.ok(css.includes("from { transform: rotate(0); }"));
	assert.ok(!css.includes('[data-nz-component="widget"] from'));
});

test("style: :root selector becomes the component scope", () => {
	const result = emit(`<div class="w"></div>
{% stylesheet %}
:root { --w-gap: 1rem; }
{% endstylesheet %}`);
	const css = fileByPath(result, "assets/widget.css")?.contents;
	assert.ok(css.includes('[data-nz-component="widget"] { --w-gap: 1rem; }'));
});

test("style: style-only component still gets the scope attribute, no js", () => {
	const result = emit(`<div class="w">static</div>
{% stylesheet %}
.w { color: blue; }
{% endstylesheet %}`);
	assert.deepEqual(
		result.files.map((file) => file.path).sort(),
		["assets/widget.css", "snippets/widget.liquid"],
	);
	const liquid = fileByPath(result, "snippets/widget.liquid")?.contents;
	assert.ok(liquid.includes('data-nz-component="widget"'));
	assert.ok(!liquid.includes("script_tag"));
});

test("style: css braces do not confuse the liquid parser", () => {
	const source = `<div class="w"></div>
{% stylesheet %}
.w::before { content: "{{ not liquid }}"; }
{% endstylesheet %}`;
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	const style = compiled.ir.syntax.find((node) => node.kind === "style");
	assert.ok(style?.source.includes('content: "{{ not liquid }}"'));
	assert.deepEqual(
		compiled.issues.filter((issue) => issue.severity === "error"),
		[],
	);
});
