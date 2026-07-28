import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeThemeSource,
	getThemeFileImpact,
	inspectNazareTheme,
	ThemeProgram,
} from "../dist/index.js";

const files = [
	{
		path: "templates/index.liquid",
		contents: `{% render 'card' %}
{{ 'theme.css' | asset_url | stylesheet_tag }}
<script src="{{ 'theme.js' | asset_url }}"></script>`,
	},
	{
		path: "snippets/card.liquid",
		contents: `<product-card class="card {{ settings.card_class }}" data-product-id="{{ product.id }}"></product-card>`,
	},
	{
		path: "assets/theme.css",
		contents: `:root { --card-accent: red; }
.card[data-product-id] { color: var(--card-accent); }`,
	},
	{
		path: "assets/theme.js",
		contents: `const card = document.querySelector(".card[data-product-id]");
card?.classList.add("is-active");
document.addEventListener("card:ready", () => {});
document.dispatchEvent(new CustomEvent("card:ready"));
customElements.define("product-card", class extends HTMLElement {});`,
	},
];

const context = {
	strictness: "strict",
	plainLiquidParseMode: "liquid-only",
};

test("theme compiler links Liquid, CSS, and JavaScript behavior", () => {
	const graph = inspectNazareTheme(files);
	const node = (kind, name) =>
		graph.nodes.find(
			(candidate) => candidate.kind === kind && candidate.name === name,
		);

	assert.ok(node("domHook", "card"));
	assert.ok(node("domHook", "data-product-id"));
	assert.ok(node("domHook", "is-active"));
	assert.ok(node("customProperty", "--card-accent"));
	assert.ok(node("customEvent", "card:ready"));
	assert.ok(node("customElement", "product-card"));

	for (const kind of [
		"emitsHook",
		"selectsHook",
		"queriesHook",
		"mutatesHook",
		"definesCustomProperty",
		"readsCustomProperty",
		"dispatchesEvent",
		"listensForEvent",
		"definesCustomElement",
		"usesCustomElement",
	]) {
		assert.ok(
			graph.edges.some((edge) => edge.kind === kind),
			kind,
		);
	}

	const impact = getThemeFileImpact(graph, "snippets/card.liquid");
	assert.deepEqual(impact.dependents, [
		"assets/theme.css",
		"assets/theme.js",
		"templates/index.liquid",
	]);
	assert.deepEqual(impact.affectedPages, ["templates/index.liquid"]);
});

test("behavior consumers do not make unreachable Liquid files used", () => {
	const graph = inspectNazareTheme([
		{
			path: "sections/orphan.liquid",
			contents: '<div class="orphan"></div>',
		},
		{ path: "assets/theme.css", contents: ".orphan {}" },
	]);
	const impact = getThemeFileImpact(graph, "sections/orphan.liquid");
	assert.deepEqual(impact.dependents, ["assets/theme.css"]);
	assert.equal(impact.usage, "unused");
	assert.deepEqual(impact.affectedPages, []);
});

test("dynamic markup and script selectors expose explicit uncertainty", () => {
	const liquid = analyzeThemeSource(
		{
			path: "snippets/card.liquid",
			contents: '<div class="card {{ dynamic_class }}"></div>',
			fileKind: "snippet",
		},
		context,
	);
	assert.equal(liquid.completeness, "partial");
	assert.ok(
		liquid.uncertainty.some(
			(boundary) => boundary.code === "THEME_DYNAMIC_MARKUP_HOOK",
		),
	);
	const graph = inspectNazareTheme([
		{
			path: "snippets/card.liquid",
			contents: '<div class="card {{ dynamic_class }}"></div>',
		},
	]);
	const impact = getThemeFileImpact(graph, "snippets/card.liquid");
	assert.equal(impact.certainty, "partial");
	assert.ok(
		impact.uncertainty.some((message) =>
			message.includes("Dynamic class markup"),
		),
	);
	assert.ok(
		liquid.facts.some(
			(fact) =>
				fact.kind === "behavior" &&
				fact.subjectKind === "domHook" &&
				fact.name === "card",
		),
	);

	const script = analyzeThemeSource(
		{
			path: "assets/theme.js",
			contents: "document.querySelector(selector);",
			fileKind: "asset",
		},
		context,
	);
	assert.equal(script.completeness, "partial");
	assert.ok(
		script.uncertainty.some(
			(boundary) => boundary.code === "THEME_DYNAMIC_SCRIPT_SELECTOR",
		),
	);
});

test("malformed CSS and JavaScript fail their source frontends", () => {
	const css = analyzeThemeSource(
		{ path: "assets/theme.css", contents: ".card {", fileKind: "asset" },
		context,
	);
	assert.equal(css.completeness, "failed");
	assert.equal(css.issues[0].code, "THEME_CSS_PARSE_ERROR");

	const script = analyzeThemeSource(
		{ path: "assets/theme.js", contents: "const = ;", fileKind: "asset" },
		context,
	);
	assert.equal(script.completeness, "failed");
	assert.equal(script.issues[0].code, "THEME_SCRIPT_PARSE_ERROR");
});

test("behavior graph updates converge with a cold theme compile", () => {
	const program = new ThemeProgram(files);
	const updated = files.map((file) =>
		file.path === "assets/theme.js"
			? {
					...file,
					contents: file.contents.replaceAll("card", "product-card"),
				}
			: file,
	);
	program.updateFile(updated.find((file) => file.path === "assets/theme.js"));

	assert.deepEqual(program.getGraph(), inspectNazareTheme(updated));
});
