import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	createDefaultSourceParserRegistry,
	liquidSyntaxFacts,
	parseSourceDocument,
} from "../dist/index.js";

const corpusRoot = fileURLToPath(
	new URL("../../../fixtures/theme-corpus/", import.meta.url),
);
const registry = createDefaultSourceParserRegistry();

function liquidFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...liquidFiles(path));
		else if (path.endsWith(".liquid") && !path.endsWith(".nz.liquid"))
			files.push(path);
	}
	return files;
}

test("committed Liquid corpus produces authoritative Tree-sitter facts", () => {
	const files = liquidFiles(corpusRoot);
	assert.ok(files.length > 0);
	for (const path of files) {
		const source = readFileSync(path, "utf8");
		const file = relative(corpusRoot, path);
		const document = parseSourceDocument(registry, file, "liquid", source);
		assert.deepEqual(document.issues, [], `Tree-sitter rejected ${file}`);
		assert.equal(liquidSyntaxFacts(document).authoritative, true);
	}
});

test("all mechanical fact families cover focused syntax", () => {
	const source = `{% doc %}
@param {string} title - Card title
@param [image]
{% enddoc %}
{% assign title = title | default: settings.fallback_title %}
{% if optional %}{% render 'card', title: title %}{% endif %}
{% render 'product' with product as item %}
{% render 'price' for collection.products as card_product %}
{{ 'theme.css' | asset_url }}
{{ 'cards.title' | t }}`;
	const document = parseSourceDocument(
		registry,
		"focused.liquid",
		"liquid",
		source,
	);
	assert.deepEqual(document.issues, []);
	const facts = liquidSyntaxFacts(document);
	assert.equal(facts.authoritative, true);
	assert.equal(facts.docParams.length, 2);
	assert.equal(
		facts.localBindings.some((binding) => binding.name === "title"),
		true,
	);
	assert.equal(facts.conditionals.length, 1);
	assert.equal(
		facts.guards.some((guard) => guard.name === "optional"),
		true,
	);
	assert.equal(facts.dependencies.length, 3);
	assert.equal(facts.renderArguments.length, 3);
	assert.equal(
		facts.renderArguments.some(
			(argument) =>
				argument.argumentName === "card_product" &&
				argument.valueExpression === "collection.products",
		),
		true,
	);
	assert.equal(
		facts.settingsReads.some((read) => read.name === "fallback_title"),
		true,
	);
	assert.equal(facts.assetReferences[0]?.value, "theme.css");
	assert.equal(facts.localeReferences[0]?.value, "cards.title");
	assert.equal(
		facts.reads.some((read) => read.root === "collection"),
		true,
	);
});

test("production Liquid extensions remain authoritative", () => {
	const source = `{% liquid
# generated theme comment
assign _menu = linklists[section.settings.menu]
for image in product.images limit: 3
render 'card', class: classes | strip
endfor
%}
{{- -}}
{% case kind %}{% when 'a' %}A{% endcase-%}`;
	const document = parseSourceDocument(
		registry,
		"production.liquid",
		"liquid",
		source,
	);
	assert.deepEqual(document.issues, []);
	const facts = liquidSyntaxFacts(document);
	assert.equal(facts.authoritative, true);
	assert.equal(
		facts.localBindings.some((binding) => binding.name === "_menu"),
		true,
	);
	assert.equal(
		facts.renderArguments.some((argument) => argument.argumentName === "class"),
		true,
	);
});

test("invalid CST never produces authoritative facts", () => {
	const document = parseSourceDocument(
		registry,
		"x.liquid",
		"liquid",
		"{% render 'card'",
	);
	const facts = liquidSyntaxFacts(document);
	assert.equal(facts.authoritative, false);
	assert.deepEqual(facts.dependencies, []);
	assert.deepEqual(facts.settingsReads, []);
	assert.deepEqual(facts.blocks, []);
	assert.deepEqual(facts.conditionals, []);
	assert.deepEqual(facts.localBindings, []);
	assert.deepEqual(facts.renderArguments, []);
	assert.deepEqual(facts.reads, []);
});
