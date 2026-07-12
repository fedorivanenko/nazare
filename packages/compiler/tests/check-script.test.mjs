// Typed-refs pass: the virtual TypeScript program that checks {% script %}
// blocks. This is the compiler's most fragile machinery (rootless-file and
// directoryExists resolution bugs both lived here), so it runs every change
// — but kept to a few load-bearing cases, since each boots a TS program and
// is by far the slowest thing in the suite.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkComponentScripts,
	compileNazareArtifact,
} from "../dist/index.js";

test("check-script: refs are typed from tag names, misuse is an error", () => {
	// disabled exists on HTMLButtonElement, not HTMLDivElement
	const result = compileNazareArtifact(
		`<div ref="panel"></div>\n{% script lang="ts" %}\nexport default island(({ refs }) => { refs.panel.disabled = true; });\n{% endscript %}`,
		"component.nz.liquid",
	);
	const issue = checkComponentScripts(result.ir).find(
		(i) => i.code === "SCRIPT_TYPE_ERROR",
	);
	assert.ok(issue?.message.includes("disabled"));
	assert.equal(issue.span?.file, "component.nz.liquid");
});

test("check-script: the data channel is typed, and valid usage passes", () => {
	const good = `{% props {
  step: number.default(1),
  currency: string.setting({ label: "Currency" }),
} %}
<div ref="root" data-currency="{{ props.currency }}">
  <button ref="increment" data-step="{{ props.step }}">+</button>
</div>
{% script lang="ts" %}
export default island(({ refs, data }) => {
  let total = 0;
  refs.increment.addEventListener("click", () => {
    total += data.increment.step;
    refs.root.textContent = data.root.currency + total.toFixed(2);
  });
});
{% endscript %}`;
	assert.deepEqual(
		checkComponentScripts(
			compileNazareArtifact(good, "component.nz.liquid").ir,
		),
		[],
	);

	// number channel used as a string is a type error
	const bad = good.replace(
		"total += data.increment.step",
		"data.increment.step.toUpperCase()",
	);
	assert.ok(
		checkComponentScripts(
			compileNazareArtifact(bad, "component.nz.liquid").ir,
		).some(
			(i) =>
				i.code === "SCRIPT_TYPE_ERROR" && i.message.includes("toUpperCase"),
		),
	);
});

test("check-script: types flow across a relative import", () => {
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
	assert.ok(
		checkComponentScripts(result.ir, { readFile }).some(
			(i) =>
				i.code === "SCRIPT_TYPE_ERROR" && i.message.includes("TS2345"),
		),
		"argument type error crosses the module boundary",
	);
});

test("check-script: js scripts are skipped", () => {
	const result = compileNazareArtifact(
		`<div ref="root"></div>\n{% script lang="js" %}\nexport default island(({ refs }) => refs.root.whatever());\n{% endscript %}`,
		"component.nz.liquid",
	);
	assert.deepEqual(checkComponentScripts(result.ir), []);
});
