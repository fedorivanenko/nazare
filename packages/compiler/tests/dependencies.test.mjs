import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact } from "../dist/index.js";

function compile(source, dependencies) {
	return compileNazareArtifact(source, "component.nz.liquid", {
		dependencies,
	});
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

test("dependencies: undeclared liquid import is an error", () => {
	const result = compile(
		`{% import Link from "@nazare/link" %}
{% render Link { href: "x", text: "y" } %}`,
		[],
	);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNDECLARED_DEPENDENCY",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("@nazare/link"));
});

test("dependencies: undeclared script package import is an error", () => {
	const result = compile(
		`<div ref="root"></div>
{% script %}
import { cn } from "@nazare/cn";
export default island(({ root }) => { root.className = cn("a"); });
{% endscript %}`,
		[],
	);
	assert.ok(codes(result).includes("CONSTRAINT_UNDECLARED_DEPENDENCY"));
});

test("dependencies: declared and used is clean", () => {
	const result = compile(
		`{% import Link from "@nazare/link" %}
{% render Link { href: "x", text: "y" } %}
{% script %}
import { cn } from "@nazare/cn";
export default island(({ root }) => { root.className = cn("a"); });
{% endscript %}`,
		["@nazare/link", "@nazare/cn"],
	);
	assert.ok(
		!codes(result).some((code) => code.includes("DEPENDENCY")),
	);
});

test("dependencies: declared but unused warns", () => {
	const result = compile(`<div>static</div>`, ["@nazare/link"]);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNUSED_DEPENDENCY",
	);
	assert.equal(issue?.severity, "warning");
});

test("dependencies: relative script imports are not dependencies", () => {
	const result = compile(
		`{% import "./widget.ts" %}
<div ref="root"></div>`,
		[],
	);
	assert.ok(!codes(result).includes("CONSTRAINT_UNDECLARED_DEPENDENCY"));
});

test("dependencies: no manifest context means no checks", () => {
	const result = compile(
		`{% import Link from "@nazare/link" %}
{% render Link { href: "x", text: "y" } %}`,
		undefined,
	);
	assert.ok(!codes(result).some((code) => code.includes("DEPENDENCY")));
});
