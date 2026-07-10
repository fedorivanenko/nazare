import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

function emitLiquid(source) {
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	return emitTheme(source, compiled, { name: "widget" }).files.find(
		(file) => file.path === "snippets/widget.liquid",
	)?.contents;
}

test("provenance: setting props lower to section.settings.x", () => {
	const liquid = emitLiquid(`{% props {
  text: string.setting({ label: "Text" }),
} %}
<span>{{ props.text }}</span>`);
	assert.ok(liquid.includes("{{ section.settings.text }}"));
	assert.ok(!liquid.includes("props.text"));
});

test("provenance: render-passed props lower to bare names", () => {
	const liquid = emitLiquid(`{% props {
  href: url.required(),
} %}
<a href="{{ props.href }}">go</a>`);
	assert.ok(liquid.includes('href="{{ href }}"'));
});

test("provenance: control-flow reads lower too", () => {
	const liquid = emitLiquid(`{% props {
  link: url.setting({ label: "Link" }),
} %}
{% if props.link != blank %}<a href="{{ props.link }}">go</a>{% endif %}`);
	assert.ok(liquid.includes("{% if section.settings.link != blank %}"));
});

test("provenance: undeclared props read is an error", () => {
	const result = compileNazareArtifact(
		`{% props { text: string.required() } %}
<span>{{ props.ghost }}</span>`,
		"component.nz.liquid",
	);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNKNOWN_PROPS_REFERENCE",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("ghost"));
});

test("provenance: props.x in render args carries the prop type", () => {
	const link = compileNazareArtifact(
		`{% props { href: url.required(), text: string.required() } %}`,
		"link.nz.liquid",
		{ packageId: "@test/link" },
	).contract;

	const ok = compileNazareArtifact(
		`{% import Link from "@test/link" %}
{% props { url: url.setting({ label: "URL" }) } %}
{% render Link {href: props.url, text: "Go"} %}`,
		"consumer.nz.liquid",
		{ contracts: [link] },
	);
	assert.ok(
		!ok.issues.some((i) => i.code === "CONSTRAINT_PROP_TYPE_MISMATCH"),
	);

	const bad = compileNazareArtifact(
		`{% import Link from "@test/link" %}
{% props { count: number.required() } %}
{% render Link {href: props.count, text: "Go"} %}`,
		"consumer.nz.liquid",
		{ contracts: [link] },
	);
	assert.ok(
		bad.issues.some((i) => i.code === "CONSTRAINT_PROP_TYPE_MISMATCH"),
	);
});
