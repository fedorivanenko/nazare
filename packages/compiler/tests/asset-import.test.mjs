import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

const sidecars = {
	"./widget.ts": `export default island(({ refs }) => {
  refs.trigger.disabled = true;
});
`,
	"./widget.css": `.widget { color: red; }
`,
};

function compile(source, readAsset = (path) => sidecars[path]) {
	return compileNazareArtifact(source, "components/widget/widget.nz.liquid", {
		readAsset,
	});
}

test("asset-import: ts sidecar becomes a script node with sidecar spans", () => {
	const result = compile(`{% import "./widget.ts" %}
<button ref="trigger">Go</button>`);
	const script = result.ir.syntax.find((node) => node.kind === "script");
	assert.equal(script?.lang, "ts");
	assert.ok(script.source.includes("refs.trigger"));
	assert.equal(script.bodySpan?.file, "components/widget/widget.ts");

	const bindings = result.ir.resolutions.filter(
		(r) => r.kind === "ref-binding",
	);
	assert.equal(bindings.length, 1);
});

test("asset-import: css sidecar becomes a style node and scoped asset", () => {
	const source = `{% import "./widget.css" %}
<div class="widget"></div>`;
	const result = compile(source);
	const style = result.ir.syntax.find((node) => node.kind === "style");
	assert.ok(style?.source.includes(".widget { color: red; }"));

	const emitted = emitTheme(source, result, { name: "widget" });
	const css = emitted.files.find((f) => f.path === "assets/widget.css");
	assert.ok(css?.contents.includes('[data-nz-component="widget"] .widget'));
	const liquid = emitted.files.find(
		(f) => f.path === "snippets/widget.liquid",
	);
	assert.ok(!liquid.contents.includes("{% import"));
});

test("asset-import: unreadable sidecar is an error", () => {
	const result = compile(`{% import "./missing.ts" %}
<div></div>`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "ASSET_IMPORT_NOT_FOUND",
	);
	assert.equal(issue?.severity, "error");
});

test("asset-import: escaping the component directory is a parse error", () => {
	const result = compile(`{% import "../shared/util.ts" %}
<div></div>`);
	assert.ok(
		result.issues.some((i) => i.code === "NAZARE_PARSE_ASSET_IMPORT"),
	);
});

test("asset-import: unsupported extension is a parse error", () => {
	const result = compile(`{% import "./data.json" %}
<div></div>`);
	assert.ok(
		result.issues.some((i) => i.code === "NAZARE_PARSE_ASSET_IMPORT"),
	);
});

test("asset-import: declaration order is mount order across inline and imported", () => {
	const result = compile(`{% import "./widget.ts" %}
<button ref="trigger">Go</button>
{% script %}
export default island(({ refs }) => refs.trigger.focus());
{% endscript %}`);
	const scripts = result.ir.syntax.filter((node) => node.kind === "script");
	assert.equal(scripts.length, 2);
	assert.ok(scripts[0].source.includes("disabled"), "imported script first");
	assert.ok(scripts[1].source.includes("focus"), "inline script second");
});
