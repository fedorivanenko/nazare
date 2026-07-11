import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact } from "../dist/index.js";

function compile(props, kind) {
	return compileNazareArtifact(
		`{% props {${props}} %}\n<div>x</div>`,
		"component.nz.liquid",
		{ kind },
	);
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

test("kind: section with a render-arg prop is an error", () => {
	const result = compile(`start: number.default(0),`, "section");
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_SECTION_PROP_NOT_SETTING",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("start"));
});

test("kind: section with only settings is clean", () => {
	const result = compile(
		`start: number.setting({ label: "Start" }),`,
		"section",
	);
	assert.ok(!codes(result).includes("CONSTRAINT_SECTION_PROP_NOT_SETTING"));
});

test("kind: snippet with a setting prop warns", () => {
	const result = compile(
		`label: string.setting({ label: "Label" }),`,
		"snippet",
	);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_SNIPPET_SETTING_PROP",
	);
	assert.equal(issue?.severity, "warning");
});

test("kind: snippet with render-arg props is clean", () => {
	const result = compile(`href: url.required(),`, "snippet");
	assert.ok(!codes(result).includes("CONSTRAINT_SNIPPET_SETTING_PROP"));
});

test("kind: no kind means no provenance rules", () => {
	const result = compile(`start: number.default(0),`, undefined);
	assert.ok(!codes(result).includes("CONSTRAINT_SECTION_PROP_NOT_SETTING"));
});
