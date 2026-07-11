import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact } from "../dist/index.js";

function compile(script, readAsset) {
	return compileNazareArtifact(
		`<div ref="root"></div>\n${script}`,
		"components/widget/widget.nz.liquid",
		{ readAsset },
	);
}

function moduleIssues(result) {
	return result.issues.filter(
		(issue) => issue.code === "SCRIPT_MODULE_SYNTAX_UNSUPPORTED",
	);
}

test("module-syntax: a real import in a behavior script is an error", () => {
	const result = compile(`{% script lang="ts" %}
import { debounce } from "./utils.ts";
export default island(({ refs }) => refs.root.remove());
{% endscript %}`);
	const issues = moduleIssues(result);
	assert.equal(issues.length, 1);
	assert.equal(issues[0].severity, "error");
	assert.ok(issues[0].message.includes("./utils.ts"));
});

test("module-syntax: named exports are an error", () => {
	const result = compile(`{% script lang="ts" %}
export const helper = () => {};
export default island(() => {});
{% endscript %}`);
	assert.equal(moduleIssues(result).length, 1);
});

test("module-syntax: type-only imports are allowed", () => {
	const result = compile(`{% script lang="ts" %}
import type { Foo } from "./types.ts";
export default island(({ root }) => root.remove());
{% endscript %}`);
	assert.deepEqual(moduleIssues(result), []);
});

test("module-syntax: import inside a string or comment is not flagged", () => {
	const result = compile(`{% script lang="ts" %}
// import { fake } from "./nope.ts";
const s = 'import { also } from "./nope.ts"';
export default island(({ root }) => root.setAttribute("s", s));
{% endscript %}`);
	assert.deepEqual(moduleIssues(result), []);
});

test("module-syntax: sidecar behavior files are checked too, with sidecar spans", () => {
	const result = compile(
		`{% import "./widget.ts" %}`,
		(path) =>
			path === "./widget.ts"
				? `import { x } from "./dep.ts";\nexport default island(() => {});\n`
				: undefined,
	);
	const issues = moduleIssues(result);
	assert.equal(issues.length, 1);
	assert.equal(issues[0].span?.file, "components/widget/widget.ts");
	assert.equal(issues[0].span?.start.line, 1);
});
