import assert from "node:assert/strict";
import { test } from "node:test";
import {
	compileNazareArtifact,
	emitTheme,
	themeSchemaFromIR,
} from "../dist/index.js";

const linkContract = compileNazareArtifact(
	`{% props {
  href: url.setting({ label: "Link" }),
  label: string.setting({ label: "Label", default: "Shop now" }),
  text: string.required(),
} %}`,
	"link.nz.liquid",
	{ packageId: "@test/link" },
).contract;

function compileSection(source, contracts = [linkContract]) {
	return compileNazareArtifact(source, "promo.nz.liquid", {
		contracts,
		kind: "section",
		packageId: "@test/promo",
	});
}

test("hoist: unfilled setting-props land in the section schema under a header", () => {
	const source = `{% import PromoLink from "@test/link" %}
{% render PromoLink { text: "Go" } %}`;
	const result = compileSection(source);
	const schema = themeSchemaFromIR(result.ir, {
		name: "promo",
		contracts: result.contracts,
	});

	assert.deepEqual(schema.settings, [
		{ type: "header", content: "Promo link" },
		{ type: "url", id: "promo_link_href", label: "Link" },
		{
			type: "text",
			id: "promo_link_label",
			label: "Label",
			default: "Shop now",
		},
	]);
});

test("hoist: filling the argument is the opt-out", () => {
	const source = `{% import PromoLink from "@test/link" %}
{% props { url: url.setting({ label: "URL" }) } %}
{% render PromoLink { text: "Go", href: props.url, label: "Buy" } %}`;
	const result = compileSection(source);
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
	const source = `{% import PromoLink from "@test/link" %}
{% render PromoLink { text: "Go" } %}`;
	const result = compileSection(source);
	const liquid = emitTheme(source, result, {
		name: "promo",
		kind: "section",
	}).files.find((file) => file.path === "sections/promo.liquid")?.contents;

	assert.ok(
		liquid.includes(
			`{% render 'link', text: "Go", href: section.settings.promo_link_href, label: section.settings.promo_link_label %}`,
		),
	);
});

test("hoist: unfilled setting-props do not trigger required-prop errors", () => {
	const source = `{% import PromoLink from "@test/link" %}
{% render PromoLink { text: "Go" } %}`;
	const result = compileSection(source);
	assert.ok(
		!result.issues.some(
			(issue) => issue.code === "CONSTRAINT_REQUIRED_PROP_MISSING",
		),
	);
});

test("hoist: chains propagate through intermediate snippet contracts", () => {
	// button (leaf) → card (intermediate snippet) → section
	const buttonContract = compileNazareArtifact(
		`{% props { label: string.setting({ label: "Button label" }) } %}`,
		"button.nz.liquid",
		{ packageId: "@test/button" },
	).contract;

	const cardSource = `{% import Button from "@test/button" %}
{% render Button {} %}`;
	const card = compileNazareArtifact(cardSource, "card.nz.liquid", {
		contracts: [buttonContract],
		kind: "snippet",
		packageId: "@test/card",
	});
	assert.deepEqual(card.contract.hoisted, [
		{
			name: "button_label",
			sourcePackageId: "@test/button",
			sourcePropName: "label",
			typeInfo: {
				valueType: { kind: "string" },
				setting: { label: "Button label", default: undefined },
			},
		},
	]);

	// The intermediate snippet reads its own implicit render arg.
	const cardLiquid = emitTheme(cardSource, card, {
		name: "card",
		kind: "snippet",
	}).files.find((file) => file.path === "snippets/card.liquid")?.contents;
	assert.ok(cardLiquid.includes(`{% render 'button', label: button_label %}`));

	// The section hoists the accumulated id and supplies it from its schema.
	const sectionSource = `{% import Card from "@test/card" %}
{% render Card {} %}`;
	const section = compileNazareArtifact(sectionSource, "hero.nz.liquid", {
		contracts: [card.contract],
		kind: "section",
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
		kind: "section",
	}).files.find((file) => file.path === "sections/hero.liquid")?.contents;
	assert.ok(
		sectionLiquid.includes(
			`{% render 'card', button_label: section.settings.card_button_label %}`,
		),
	);
});

test("hoist: explicitly filling a dependency's hoisted arg is legal", () => {
	const cardContract = {
		packageId: "@test/card",
		componentSymbolId: "symbol:component:@test/card#default",
		props: [],
		hoisted: [
			{
				name: "button_label",
				sourcePackageId: "@test/button",
				sourcePropName: "label",
				typeInfo: { valueType: { kind: "string" } },
			},
		],
	};
	const result = compileSection(
		`{% import Card from "@test/card" %}
{% render Card { button_label: "Buy" } %}`,
		[cardContract],
	);
	assert.ok(
		!result.issues.some(
			(issue) => issue.code === "CONSTRAINT_UNKNOWN_PROP_ARGUMENT",
		),
	);
});

test("hoist: same alias twice with unfilled settings is an error", () => {
	const result = compileSection(`{% import PromoLink from "@test/link" %}
{% render PromoLink { text: "A" } %}
{% render PromoLink { text: "B" } %}`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_HOISTED_ALIAS_REUSED",
	);
	assert.equal(issue?.severity, "error");
});

test("hoist: two aliases of the same package resolve cleanly", () => {
	const source = `{% import PromoLink from "@test/link" %}
{% import FooterLink from "@test/link" %}
{% render PromoLink { text: "A" } %}
{% render FooterLink { text: "B" } %}`;
	const result = compileSection(source);
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
	const result = compileSection(`{% import PromoLink from "@test/link" %}
{% props { promo_link_href: url.setting({ label: "Mine" }) } %}
{% render PromoLink { text: "Go" } %}`);
	assert.ok(
		result.issues.some(
			(issue) => issue.code === "CONSTRAINT_HOISTED_SETTING_COLLISION",
		),
	);
});
