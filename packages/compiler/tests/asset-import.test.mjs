import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

const files = {
	"components/widget/widget.ts": `export default island(({ refs }) => {
  refs.trigger.disabled = true;
});
`,
	"components/widget/widget.css": `.widget { color: red; }
`,
	"shared/util.ts": `export const noop = () => {};
`,
};

function compile(source, readFile = (path) => files[path]) {
	return compileNazareArtifact(source, "components/widget/widget.nz.liquid", {
		readFile,
	});
}

test("asset-import: ts import becomes a script node with its own spans", () => {
	const result = compile(`{% import widget from "./widget.ts" %}
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

test("asset-import: css import becomes a bound style node and scoped asset", () => {
	const source = `{% import styles from "./widget.css" %}
<div class="{{ styles.widget }}"></div>`;
	const result = compile(source);
	const style = result.ir.syntax.find((node) => node.kind === "style");
	assert.ok(style?.source.includes(".widget { color: red; }"));
	assert.equal(style?.bindingName, "styles");

	const emitted = emitTheme(source, result, { name: "widget" });
	const css = emitted.files.find((f) => f.path === "assets/widget.css");
	assert.ok(css?.contents.includes(".nz-widget__widget { color: red; }"));
	const liquid = emitted.files.find(
		(f) => f.path === "snippets/widget.liquid",
	);
	assert.ok(!liquid.contents.includes("{% import"));
	assert.ok(liquid.contents.includes('class="nz-widget__widget"'));
});

test("asset-import: unreadable file is an error", () => {
	const result = compile(`{% import missing from "./missing.ts" %}
<div></div>`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "IMPORT_NOT_FOUND",
	);
	assert.equal(issue?.severity, "error");
});

test("asset-import: reaching another project directory is allowed", () => {
	const result = compile(`{% import util from "../../shared/util.ts" %}
<div></div>`);
	assert.deepEqual(
		result.issues.filter((i) => i.severity === "error"),
		[],
	);
	const script = result.ir.syntax.find((node) => node.kind === "script");
	assert.equal(script?.bodySpan?.file, "shared/util.ts");
});

test("asset-import: escaping the project root is an error", () => {
	const result = compile(`{% import util from "../../../outside/util.ts" %}
<div></div>`);
	assert.ok(
		result.issues.some((i) => i.code === "NAZARE_IMPORT_OUTSIDE_PROJECT"),
	);
});

test("asset-import: side-effect form is a parse error", () => {
	const result = compile(`{% import "./widget.ts" %}
<div></div>`);
	assert.ok(result.issues.some((i) => i.code === "NAZARE_PARSE_IMPORT"));
});

test("asset-import: bare specifier is an error", () => {
	const result = compile(`{% import widget from "widget" %}
<div></div>`);
	assert.ok(
		result.issues.some((i) => i.code === "NAZARE_IMPORT_BARE_SPECIFIER"),
	);
});

test("asset-import: unsupported extension is an error", () => {
	const result = compile(`{% import data from "./data.json" %}
<div></div>`);
	assert.ok(
		result.issues.some(
			(i) => i.code === "NAZARE_IMPORT_UNSUPPORTED_EXTENSION",
		),
	);
});

test("asset-import: capitalized behavior binding is an error", () => {
	const result = compile(`{% import Widget from "./widget.ts" %}
<div></div>`);
	assert.ok(
		result.issues.some((i) => i.code === "NAZARE_IMPORT_BINDING_CASE"),
	);
});

test("asset-import: lowercase component binding is an error", () => {
	const result = compile(`{% import card from "./card.nz.liquid" %}
<div></div>`);
	assert.ok(
		result.issues.some((i) => i.code === "NAZARE_IMPORT_COMPONENT_CASE"),
	);
});

test("asset-import: declaration order is mount order across inline and imported", () => {
	const result = compile(`{% import widget from "./widget.ts" %}
<button ref="trigger">Go</button>
{% script %}
export default island(({ refs }) => refs.trigger.focus());
{% endscript %}`);
	const scripts = result.ir.syntax.filter((node) => node.kind === "script");
	assert.equal(scripts.length, 2);
	assert.ok(scripts[0].source.includes("disabled"), "imported script first");
	assert.ok(scripts[1].source.includes("focus"), "inline script second");
});
