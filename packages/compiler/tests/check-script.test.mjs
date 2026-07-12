import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkComponentScripts,
	compileNazareArtifact,
} from "../dist/index.js";

function scriptIssues(source) {
	const result = compileNazareArtifact(source, "component.nz.liquid");
	return checkComponentScripts(result.ir);
}

test("script-check: valid typed script passes", () => {
	const issues = scriptIssues(`<div ref="root">
  <button ref="trigger">Go</button>
</div>
{% script lang="ts" %}
export default island(({ refs }) => {
  refs.trigger.disabled = true;
  refs.root.classList.add("open");
});
{% endscript %}`);
	assert.deepEqual(issues, []);
});

test("script-check: refs are typed from tag names", () => {
	// disabled exists on HTMLButtonElement but not on HTMLDivElement
	const issues = scriptIssues(`<div ref="panel"></div>
{% script lang="ts" %}
export default island(({ refs }) => {
  refs.panel.disabled = true;
});
{% endscript %}`);
	const issue = issues.find((i) => i.code === "SCRIPT_TYPE_ERROR");
	assert.ok(issue);
	assert.ok(issue.message.includes("disabled"));
	assert.equal(issue.severity, "error");
});

test("script-check: diagnostic spans map back into the liquid file", () => {
	const issues = scriptIssues(`<div ref="panel"></div>
{% script lang="ts" %}
export default island(({ refs }) => {
  refs.panel.disabled = true;
});
{% endscript %}`);
	const issue = issues.find((i) => i.code === "SCRIPT_TYPE_ERROR");
	assert.equal(issue?.span?.file, "component.nz.liquid");
	// refs.panel.disabled is on line 4 of the component file
	assert.equal(issue?.span?.start.line, 4);
});

test("script-check: unknown ref is not double-reported", () => {
	const source = `<div ref="root"></div>
{% script lang="ts" %}
export default island(({ refs }) => {
  refs.ghost.remove();
});
{% endscript %}`;
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	assert.ok(
		compiled.issues.some((i) => i.code === "CONSTRAINT_UNKNOWN_REF"),
	);
	assert.ok(
		!checkComponentScripts(compiled.ir).some(
			(i) => i.code === "SCRIPT_TYPE_ERROR" && i.message.includes("ghost"),
		),
	);
});

test("script-check: general type errors are caught", () => {
	const issues = scriptIssues(`<div ref="root"></div>
{% script lang="ts" %}
export default island(({ refs }) => {
  const n: number = "not a number";
  refs.root.remove();
});
{% endscript %}`);
	assert.ok(issues.some((i) => i.message.includes("TS2322")));
});

test("script-check: js scripts are skipped", () => {
	const issues = scriptIssues(`<div ref="root"></div>
{% script lang="js" %}
export default island(({ refs }) => {
  refs.root.whatever();
});
{% endscript %}`);
	assert.deepEqual(issues, []);
});

test("script-check: types flow across relative imports", () => {
	const readFile = (path) =>
		path === "format.ts"
			? `export function format(value: number): string { return String(value); }`
			: undefined;
	const source = `<output ref="value"></output>
{% script lang="ts" %}
import { format } from "./format.ts";
export default island(({ refs }) => {
  refs.value.textContent = format("not a number");
});
{% endscript %}`;
	const result = compileNazareArtifact(source, "component.nz.liquid", {
		readFile,
	});
	const issues = checkComponentScripts(result.ir, { readFile });
	assert.ok(
		issues.some(
			(issue) =>
				issue.code === "SCRIPT_TYPE_ERROR" && issue.message.includes("TS2345"),
		),
		"argument type error crosses the module boundary",
	);
});

test("script-check: custom element tags fall back to HTMLElement", () => {
	const issues = scriptIssues(`<my-widget ref="widget"></my-widget>
{% script lang="ts" %}
export default island(({ refs }) => {
  refs.widget.setAttribute("data-x", "1");
});
{% endscript %}`);
	assert.deepEqual(issues, []);
});
