import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeThemeSource,
	DEFAULT_THEME_SOURCE_FRONTENDS,
} from "../dist/index.js";

const context = {
	strictness: "strict",
	plainLiquidParseMode: "liquid-only",
};

function analyze(path, contents, fileKind, frontends) {
	return analyzeThemeSource({ path, contents, fileKind }, context, frontends);
}

test("theme source registry assigns one frontend to every existing source family", () => {
	const cases = [
		[
			"components/card.nz.liquid",
			"<div></div>",
			"nazareComponent",
			"nazare-liquid",
		],
		["snippets/card.liquid", "<div></div>", "snippet", "liquid"],
		["templates/index.json", '{"sections":{}}', "templateJson", "json"],
		["assets/theme.css", ".card {}", "asset", "css"],
		[
			"assets/theme.js",
			'document.querySelector(".card")',
			"asset",
			"javascript",
		],
		["README.md", "theme", "other", "other"],
	];

	for (const [path, contents, fileKind, language] of cases) {
		const result = analyze(path, contents, fileKind);
		assert.equal(result.language, language, path);
		assert.notEqual(result.frontend, "none", path);
		assert.equal(result.facts[0].kind, "file", path);
		assert.equal(result.facts[0].path, path, path);
	}
});

test("theme source frontends own file-kind declarations", () => {
	const asset = analyze("assets/theme.css", "", "asset");
	assert.deepEqual(
		asset.facts.filter((fact) => fact.kind === "declaresAsset"),
		[{ kind: "declaresAsset", path: "assets/theme.css", name: "theme.css" }],
	);

	const layout = analyze("layout/theme.liquid", "", "layout");
	assert.deepEqual(
		layout.facts.filter((fact) => fact.kind === "declaresLayout"),
		[{ kind: "declaresLayout", path: "layout/theme.liquid", name: "theme" }],
	);
});

test("theme source registry rejects ambiguous frontend ownership", () => {
	const acceptsEverything = (name) => ({
		name,
		accepts: () => true,
		analyze: () => {
			throw new Error("ambiguous frontends must not run");
		},
	});
	const result = analyze("snippets/card.liquid", "", "snippet", [
		acceptsEverything("second"),
		acceptsEverything("first"),
	]);

	assert.equal(result.completeness, "failed");
	assert.equal(result.frontend, "none");
	assert.equal(result.issues[0].code, "THEME_SOURCE_FRONTEND_AMBIGUOUS");
	assert.match(result.issues[0].message, /first, second$/);
});

test("theme source registry rejects unsupported recognized input", () => {
	const result = analyze("scripts/cart.js", "", "other", []);

	assert.equal(result.completeness, "failed");
	assert.equal(result.frontend, "none");
	assert.equal(result.issues[0].code, "THEME_SOURCE_FRONTEND_UNSUPPORTED");
});

test("default theme source frontend ownership is unambiguous", () => {
	const inputs = [
		{
			path: "components/card.nz.liquid",
			contents: "",
			fileKind: "nazareComponent",
		},
		{ path: "snippets/card.liquid", contents: "", fileKind: "snippet" },
		{ path: "templates/index.json", contents: "{}", fileKind: "templateJson" },
		{ path: "assets/data.json", contents: "{}", fileKind: "asset" },
		{ path: "README.md", contents: "", fileKind: "other" },
	];

	for (const input of inputs) {
		assert.equal(
			DEFAULT_THEME_SOURCE_FRONTENDS.filter((frontend) =>
				frontend.accepts(input),
			).length,
			1,
			input.path,
		);
	}
});
