import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact } from "../dist/index.js";

function compile(source) {
	return compileNazareArtifact(source, "sections/banner.liquid");
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

const validSection = `<div class="banner">
  {% if section.settings.link != blank %}
    <a href="{{ section.settings.link }}">{{ section.settings.title }}</a>
  {% endif %}
</div>

{% schema %}
{
  "name": "Banner",
  "settings": [
    { "type": "text", "id": "title", "label": "Title" },
    { "type": "url", "id": "link", "label": "Link" }
  ]
}
{% endschema %}`;

test("vanilla: valid section passes with no setting-read errors", () => {
	const result = compile(validSection);
	assert.ok(!codes(result).includes("CONSTRAINT_UNKNOWN_SETTING_READ"));
});

test("vanilla: typo'd settings read is an error, control flow included", () => {
	const result = compile(validSection.replace(
		"section.settings.link != blank",
		"section.settings.lnik != blank",
	));
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNKNOWN_SETTING_READ",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("lnik"));
	assert.equal(issue.span?.start.line, 2, "points into the {% if %} line");
});

test("vanilla: classic block settings reads are checked", () => {
	const result = compile(`<div>
{% for block in section.blocks %}
  {{ block.settings.heading }}
  {{ block.settings.ghost }}
{% endfor %}
</div>
{% schema %}
{
  "name": "Slides",
  "settings": [],
  "blocks": [
    { "type": "slide", "settings": [{ "type": "text", "id": "heading" }] }
  ]
}
{% endschema %}`);
	const unknown = result.issues.filter(
		(issue) => issue.code === "CONSTRAINT_UNKNOWN_SETTING_READ",
	);
	assert.equal(unknown.length, 1);
	assert.ok(unknown[0].message.includes("ghost"));
});

test("vanilla: theme-block sections skip block-read checks", () => {
	const result = compile(`<div>{{ block.settings.anything }}</div>
{% schema %}
{ "name": "S", "settings": [], "blocks": [{ "type": "@theme" }] }
{% endschema %}`);
	assert.ok(!codes(result).includes("CONSTRAINT_UNKNOWN_SETTING_READ"));
});

test("vanilla: invalid schema json is an error", () => {
	const result = compile(`<div></div>
{% schema %}
{ "name": "S", trailing garbage }
{% endschema %}`);
	assert.ok(codes(result).includes("NAZARE_SCHEMA_INVALID_JSON"));
});

test("vanilla: no schema block means no setting-read checks", () => {
	const result = compile(`<div>{{ section.settings.whatever }}</div>`);
	assert.ok(!codes(result).includes("CONSTRAINT_UNKNOWN_SETTING_READ"));
});

test("vanilla: hyphenated setting ids work", () => {
	const result = compile(`<div>{{ section.settings.main-title }}</div>
{% schema %}
{ "name": "S", "settings": [{ "type": "text", "id": "main-title" }] }
{% endschema %}`);
	assert.ok(!codes(result).includes("CONSTRAINT_UNKNOWN_SETTING_READ"));
});

test("vanilla: broken liquid is a diagnostic, not a crash", () => {
	const result = compile(`<div>{% if %}{% endunless %}</div>`);
	assert.ok(
		codes(result).includes("NAZARE_PARSE_LIQUID"),
		`got: ${codes(result).join(", ")}`,
	);
});
