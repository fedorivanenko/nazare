import assert from "node:assert/strict";
import test from "node:test";
import { lowerPropsReads, lowerStyleReads } from "../dist/liquid-lowering.js";

const ir = {
	syntax: [
		{
			kind: "prop-declaration",
			name: "title",
			typeInfo: { valueType: { kind: "string" }, setting: { label: "Title" } },
		},
		{
			kind: "prop-declaration",
			name: "href",
			typeInfo: { valueType: { kind: "url" } },
		},
		{
			kind: "style",
			bindingName: "styles",
		},
	],
};

test("liquid lowering: props are textual by design", () => {
	assert.equal(
		lowerPropsReads(
			`{{ props.title }} {% if props.href %}props.missing{% endif %}`,
			ir,
			"section",
		),
		`{{ section.settings.title }} {% if href %}props.missing{% endif %}`,
	);
});

test("liquid lowering: styles output and expression positions lower differently", () => {
	assert.equal(
		lowerStyleReads(
			`<div class="{{ styles.wrapper }}" data-class="{{ styles["hero-image"] }}">{% render 'x', class: styles.wrapper %}</div>`,
			ir,
			"hero",
		),
		`<div class="nz-hero__wrapper" data-class="nz-hero__hero-image">{% render 'x', class: "nz-hero__wrapper" %}</div>`,
	);
});
