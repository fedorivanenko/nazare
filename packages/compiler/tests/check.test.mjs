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

// Intentional strictness: a string literal is not a url. Accepting strings
// for a prop requires the contract to say so (future union type, url | string).
test("check: string literal is not assignable to url prop", () => {
	const result = compileConsumer(`href: "https://x.dev", text: "Go"`);
	assert.ok(codes(result).includes("CONSTRAINT_PROP_TYPE_MISMATCH"));
});

test("check: union prop accepts any member type", () => {
	const flexibleLink = compileNazareArtifact(
		`{% props {
  href: url.or(string).required(),
  align: string.enum("left", "right"),
} %}`,
		"flexible.nz.liquid",
		{ packageId: "@test/flexible" },
	).contract;

	const compile = (body) =>
		compileNazareArtifact(
			`{% import Flexible from "@test/flexible" %}
{% render Flexible {${body}} %}`,
			"consumer.nz.liquid",
			{ contracts: [flexibleLink] },
		);

	const ok = compile(`href: "https://x.dev", align: "left"`);
	assert.deepEqual(
		codes(ok).filter((code) => code === "CONSTRAINT_PROP_TYPE_MISMATCH"),
		[],
	);

	const badEnum = compile(`href: "https://x.dev", align: "middle"`);
	assert.ok(codes(badEnum).includes("CONSTRAINT_PROP_TYPE_MISMATCH"));
});

test("check: number literal checked against range constraints", () => {
	const gauge = compileNazareArtifact(
		`{% props {
  size: number.min(0).max(100).step(5).required(),
} %}`,
		"gauge.nz.liquid",
		{ packageId: "@test/gauge" },
	).contract;

	const compile = (body) =>
		compileNazareArtifact(
			`{% import Gauge from "@test/gauge" %}
{% render Gauge {${body}} %}`,
			"consumer.nz.liquid",
			{ contracts: [gauge] },
		);

	assert.deepEqual(
		codes(compile(`size: 25`)).filter((code) =>
			code.startsWith("CONSTRAINT_"),
		),
		[],
	);
	assert.ok(
		codes(compile(`size: 150`)).includes("CONSTRAINT_PROP_VALUE_OUT_OF_RANGE"),
	);
	assert.ok(
		codes(compile(`size: 27`)).includes("CONSTRAINT_PROP_VALUE_OUT_OF_RANGE"),
	);
	assert.ok(
		codes(compile(`size: -5`)).includes("CONSTRAINT_PROP_VALUE_OUT_OF_RANGE"),
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
