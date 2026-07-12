import assert from "node:assert/strict";
import { test } from "node:test";
import {
	compileNazareArtifact,
	emitTheme,
	themeSchemaFromIR,
} from "../dist/index.js";

// Dependencies are snippets (default kind) — they get rendered, so they must
// be. The consuming files declare {% component section %}.
const files = {
	"link.nz.liquid": `{% props {
  href: url.setting({ label: "Link" }),
  label: string.setting({ label: "Label", default: "Shop now" }),
  text: string.required(),
} %}`,
	"button.nz.liquid": `{% props { label: string.setting({ label: "Button label" }) } %}`,
	"card.nz.liquid": `{% import Button from "./button.nz.liquid" %}
{% render Button {} %}`,
};

const readFile = (path) => files[path];

function compileSection(body) {
	return compileNazareArtifact(
		`{% component section %}\n${body}`,
		"promo.nz.liquid",
		{ readFile },
	);
}

test("hoist: unfilled setting-props land in the section schema under a header", () => {
	const result = compileSection(`{% import PromoLink from "./link.nz.liquid" %}
{% render PromoLink { text: "Go" } %}`);
	const schema = themeSchemaFromIR(result.ir, {
		name: "promo",
		contracts: result.contracts,
	});

	assert.deepEqual(schema.settings, [
		{ type: "header", content: "Promo link" },
		{
			type: "url",
			id: "promo_link_href",
			label: "Link",
			info: "From link.nz.liquid",
		},
		{
			type: "text",
			id: "promo_link_label",
			label: "Label",
			default: "Shop now",
			info: "From link.nz.liquid",
		},
	]);
});

test("hoist: filling the argument is the opt-out", () => {
	const result = compileSection(`{% import PromoLink from "./link.nz.liquid" %}
{% props { url: url.setting({ label: "URL" }) } %}
{% render PromoLink { text: "Go", href: props.url, label: "Buy" } %}`);
	const schema = themeSchemaFromIR(result.ir, {
		name: "promo",
		contracts: result.contracts,
	});
	assert.deepEqual(
		schema.settings.map((setting) => setting.id ?? setting.type),
		["url"],
	);
});

test("hoist: render site gains generated pass-through arguments", () => {
	const source = `{% component section %}
{% import PromoLink from "./link.nz.liquid" %}
{% render PromoLink { text: "Go" } %}`;
	const result = compileNazareArtifact(source, "promo.nz.liquid", { readFile });
	const liquid = emitTheme(source, result, { name: "promo" }).files.find(
		(file) => file.path === "sections/promo.liquid",
	)?.contents;

	assert.ok(
		liquid.includes(
			`{% render 'link', text: "Go", href: section.settings.promo_link_href, label: section.settings.promo_link_label %}`,
		),
	);
});

test("hoist: unfilled setting-props do not trigger required-prop errors", () => {
	const result = compileSection(`{% import PromoLink from "./link.nz.liquid" %}
{% render PromoLink { text: "Go" } %}`);
	assert.ok(
		!result.issues.some(
			(issue) => issue.code === "CONSTRAINT_REQUIRED_PROP_MISSING",
		),
	);
});

test("hoist: chains propagate through intermediate snippet contracts", () => {
	// button (leaf) → card (intermediate snippet) → section
	const card = compileNazareArtifact(
		files["card.nz.liquid"],
		"card.nz.liquid",
		{ readFile },
	);
	assert.deepEqual(card.contract.hoisted, [
		{
			name: "button_label",
			sourcePath: "button.nz.liquid",
			sourcePropName: "label",
			typeInfo: {
				valueType: { kind: "string" },
				setting: { label: "Button label", default: undefined },
			},
		},
	]);

	// The intermediate snippet reads its own implicit render arg.
	const cardLiquid = emitTheme(files["card.nz.liquid"], card, {
		name: "card",
	}).files.find((file) => file.path === "snippets/card.liquid")?.contents;
	assert.ok(cardLiquid.includes(`{% render 'button', label: button_label %}`));

	// The section hoists the accumulated id and supplies it from its schema.
	const sectionSource = `{% component section %}
{% import Card from "./card.nz.liquid" %}
{% render Card {} %}`;
	const section = compileNazareArtifact(sectionSource, "hero.nz.liquid", {
		readFile,
	});
	const schema = themeSchemaFromIR(section.ir, {
		name: "hero",
		contracts: section.contracts,
	});
	assert.ok(
		schema.settings.some((setting) => setting.id === "card_button_label"),
	);
	const sectionLiquid = emitTheme(sectionSource, section, {
		name: "hero",
	}).files.find((file) => file.path === "sections/hero.liquid")?.contents;
	assert.ok(
		sectionLiquid.includes(
			`{% render 'card', button_label: section.settings.card_button_label %}`,
		),
	);
});

test("hoist: explicitly filling a dependency's hoisted arg is legal", () => {
	const result = compileSection(`{% import Card from "./card.nz.liquid" %}
{% render Card { button_label: "Buy" } %}`);
	assert.ok(
		!result.issues.some(
			(issue) => issue.code === "CONSTRAINT_UNKNOWN_PROP_ARGUMENT",
		),
	);
});

test("hoist: same alias twice with unfilled settings is an error", () => {
	const result = compileSection(`{% import PromoLink from "./link.nz.liquid" %}
{% render PromoLink { text: "A" } %}
{% render PromoLink { text: "B" } %}`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_HOISTED_ALIAS_REUSED",
	);
	assert.equal(issue?.severity, "error");
});

test("hoist: two aliases of the same file resolve cleanly", () => {
	const result = compileSection(`{% import PromoLink from "./link.nz.liquid" %}
{% import FooterLink from "./link.nz.liquid" %}
{% render PromoLink { text: "A" } %}
{% render FooterLink { text: "B" } %}`);
	assert.ok(
		!result.issues.some((issue) =>
			issue.code.startsWith("CONSTRAINT_HOISTED"),
		),
	);
	const schema = themeSchemaFromIR(result.ir, {
		name: "promo",
		contracts: result.contracts,
	});
	const ids = schema.settings.map((setting) => setting.id).filter(Boolean);
	assert.ok(ids.includes("promo_link_href"));
	assert.ok(ids.includes("footer_link_href"));
});

test("hoist: collision with an own setting id is an error", () => {
	const result = compileSection(`{% import PromoLink from "./link.nz.liquid" %}
{% props { promo_link_href: url.setting({ label: "Mine" }) } %}
{% render PromoLink { text: "Go" } %}`);
	assert.ok(
		result.issues.some(
			(issue) => issue.code === "CONSTRAINT_HOISTED_SETTING_COLLISION",
		),
	);
});
