import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact } from "../dist/index.js";

function compile(source) {
	return compileNazareArtifact(source, "component.nz.liquid");
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

const validComponent = `<div ref="root">
  <button ref="trigger">Open</button>
</div>

{% script lang="ts" %}
component(({ refs }) => {
  refs.trigger.addEventListener("click", () => refs.root.remove());
});
{% endscript %}`;

test("refs: valid component links script accesses to markup refs", () => {
	const result = compile(validComponent);
	assert.deepEqual(
		codes(result).filter((code) => code.includes("REF")),
		[],
	);

	const refSymbols = result.ir.symbols.filter((s) => s.kind === "ref");
	assert.deepEqual(refSymbols.map((s) => s.name).sort(), ["root", "trigger"]);

	const bindings = result.ir.resolutions.filter(
		(r) => r.kind === "ref-binding",
	);
	assert.equal(bindings.length, 2);
});

test("refs: script access without a matching element is an error", () => {
	const result = compile(`<div ref="root"></div>
{% script %}
component(({ refs }) => {
  refs.root.remove();
  refs.panel.hidden = false;
});
{% endscript %}`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNKNOWN_REF",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("panel"));
});

test("refs: duplicate ref names are an error", () => {
	const result = compile(`<div ref="item"></div>
<span ref="item"></span>
{% script %}
component(({ refs }) => refs.item.remove());
{% endscript %}`);
	assert.ok(codes(result).includes("CONSTRAINT_DUPLICATE_REF"));
});

test("refs: declared but never accessed ref warns when a script exists", () => {
	const result = compile(`<div ref="root"></div>
<div ref="ghost"></div>
{% script %}
component(({ refs }) => refs.root.remove());
{% endscript %}`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNUSED_REF",
	);
	assert.equal(issue?.severity, "warning");
	assert.ok(issue.message.includes("ghost"));
});

test("refs: no unused warnings when component has no script", () => {
	const result = compile(`<div ref="root"></div>`);
	assert.ok(!codes(result).includes("CONSTRAINT_UNUSED_REF"));
});

test("refs: dynamic ref values are skipped with a parse warning", () => {
	const result = compile(`<div ref="{{ dynamic }}"></div>`);
	assert.ok(codes(result).includes("NAZARE_PARSE_REF_ATTRIBUTE"));
	assert.equal(
		result.ir.syntax.filter((node) => node.kind === "element-ref").length,
		0,
	);
});

test("refs: script body with comparisons does not confuse the liquid parser", () => {
	const result = compile(`<div ref="root"></div>
{% script %}
component(({ refs }) => {
  const n = 1;
  if (n < 2 && n > 0) refs.root.remove();
});
{% endscript %}`);
	assert.deepEqual(
		codes(result).filter((code) => code.includes("REF")),
		[],
	);
	const script = result.ir.syntax.find((node) => node.kind === "script");
	assert.ok(script?.source.includes("n < 2"));
});
