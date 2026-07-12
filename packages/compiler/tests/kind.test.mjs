import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact } from "../dist/index.js";

// Kind is declared in the source; snippet is the default (no marker).
function compile(props, kind) {
	const marker = kind && kind !== "snippet" ? `{% component ${kind} %}\n` : "";
	return compileNazareArtifact(
		`${marker}{% props {${props}} %}\n<div>x</div>`,
		"component.nz.liquid",
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

test("kind: snippet with a setting prop is clean (it hoists)", () => {
	const result = compile(
		`label: string.setting({ label: "Label" }),`,
		"snippet",
	);
	assert.ok(!codes(result).includes("CONSTRAINT_SECTION_PROP_NOT_SETTING"));
});

test("kind: snippet with render-arg props is clean", () => {
	const result = compile(`href: url.required(),`, "snippet");
	assert.ok(!codes(result).includes("CONSTRAINT_SECTION_PROP_NOT_SETTING"));
});

test("kind: default kind is snippet, so provenance rules don't fire", () => {
	const result = compile(`start: number.default(0),`, undefined);
	assert.ok(!codes(result).includes("CONSTRAINT_SECTION_PROP_NOT_SETTING"));
	assert.equal(result.contract.kind, "snippet");
});

test("kind: declared kind lands on the contract", () => {
	const result = compile(`x: string.setting({ label: "X" }),`, "section");
	assert.equal(result.contract.kind, "section");
});

test("kind: an explicit snippet marker is legal and redundant", () => {
	const explicit = compileNazareArtifact(
		`{% component snippet %}\n{% props { href: url.required() } %}\n<div>x</div>`,
		"component.nz.liquid",
	);
	assert.deepEqual(
		explicit.issues.filter((issue) => issue.severity === "error"),
		[],
	);
	assert.equal(explicit.contract.kind, "snippet");
});

test("kind: an unknown kind is a parse error", () => {
	const result = compileNazareArtifact(
		`{% component widget %}\n<div>x</div>`,
		"component.nz.liquid",
	);
	assert.ok(codes(result).includes("NAZARE_PARSE_COMPONENT_KIND"));
});

test("kind: declaring the kind twice is an error", () => {
	const result = compileNazareArtifact(
		`{% component section %}\n{% component block %}\n<div>x</div>`,
		"component.nz.liquid",
	);
	assert.ok(codes(result).includes("NAZARE_PARSE_DUPLICATE_COMPONENT"));
	// the first declaration still wins
	assert.equal(result.contract.kind, "section");
});

test("kind: rendering a section is an error, rendering a snippet is not", () => {
	const readFile = (path) =>
		({
			"card.nz.liquid": `{% component section %}\n{% props { h: string.setting({ label: "H" }) } %}\n<section>{{ props.h }}</section>`,
			"link.nz.liquid": `{% props { href: url.required(), text: string.required() } %}`,
		})[path];

	const section = compileNazareArtifact(
		`{% import Card from "./card.nz.liquid" %}\n{% render Card {} %}`,
		"page.nz.liquid",
		{ readFile },
	);
	const issue = section.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_RENDER_TARGET_NOT_SNIPPET",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("section"));

	const snippet = compileNazareArtifact(
		`{% import Link from "./link.nz.liquid" %}\n{% render Link { href: "x", text: "y" } %}`,
		"page.nz.liquid",
		{ readFile },
	);
	assert.ok(
		!codes(snippet).includes("CONSTRAINT_RENDER_TARGET_NOT_SNIPPET"),
	);
});
