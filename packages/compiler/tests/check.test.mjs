import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact } from "../dist/index.js";

const linkSource = `{% props {
  href: url.required(),
  text: string.required(),
} %}`;

const linkContract = compileNazareArtifact(linkSource, "link.nz.liquid", {
	packageId: "@test/link",
}).contract;

function compileConsumer(renderBody) {
	const source = `{% import Link from "@test/link" %}
{% props {
  link: url.setting({ label: "Link" }),
} %}
{% render Link {${renderBody}} %}`;
	return compileNazareArtifact(source, "consumer.nz.liquid", {
		contracts: [linkContract],
	});
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

test("check: valid render produces bindings and no constraint errors", () => {
	const result = compileConsumer(`href: section.settings.link, text: "Go"`);
	assert.deepEqual(
		codes(result).filter((code) => code.startsWith("CONSTRAINT_")),
		[],
	);
	assert.equal(
		result.ir.resolutions.filter((r) => r.kind === "prop-binding").length,
		2,
	);
});

test("check: missing required prop reported", () => {
	const result = compileConsumer(`href: section.settings.link`);
	assert.ok(codes(result).includes("CONSTRAINT_REQUIRED_PROP_MISSING"));
});

test("check: unknown prop argument reported", () => {
	const result = compileConsumer(
		`href: section.settings.link, text: "Go", bogus: "1"`,
	);
	assert.ok(codes(result).includes("CONSTRAINT_UNKNOWN_PROP_ARGUMENT"));
});

test("check: prop type mismatch reported but binding still created", () => {
	const result = compileConsumer(`href: section.settings.link, text: 42`);
	assert.ok(codes(result).includes("CONSTRAINT_PROP_TYPE_MISMATCH"));
	assert.equal(
		result.ir.resolutions.filter((r) => r.kind === "prop-binding").length,
		2,
	);
});

test("check: unresolved contract downgrades to warning", () => {
	const source = `{% import Card from "@test/card" %}
{% render Card {title: "Hi"} %}`;
	const result = compileNazareArtifact(source, "consumer.nz.liquid");
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNRESOLVED_EXTERNAL_CONTRACT",
	);
	assert.equal(issue?.severity, "warning");
});
