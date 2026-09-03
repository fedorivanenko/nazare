import assert from "node:assert/strict";
import test from "node:test";
import { CssParserProvider } from "../dist/parsers/css/parser.js";
import { GraphqlParserProvider } from "../dist/parsers/graphql/parser.js";
import { HtmlParserProvider } from "../dist/parsers/html/parser.js";
import { JavaScriptParserProvider } from "../dist/parsers/javascript/parser.js";
import { JsonParserProvider } from "../dist/parsers/json/parser.js";
import { LiquidParserProvider } from "../dist/parsers/liquid/parser.js";
import { createDefaultParserProviders } from "../dist/parsers/providers.js";

test("Liquid parser provider returns CST with source diagnostics", () => {
	const provider = new LiquidParserProvider();
	assert.equal(provider.accepts("sections/product.liquid"), true);

	const result = provider.parse({
		path: "sections/product.liquid",
		source: "<div>{{ product.title }}</div>",
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.document.syntax.rootNode.type, "program");
	assert.deepEqual(result.document.diagnostics, []);
});

test("JSON parser provider accepts Shopify comments and trailing commas", () => {
	const provider = new JsonParserProvider();
	const result = provider.parse({
		path: "templates/product.json",
		source: '/* Shopify-generated */ {"sections": {},}',
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.document.syntax.type, "object");
	assert.deepEqual(result.document.diagnostics, []);
});

test("HTML parser provider returns HTML CST", () => {
	const result = new HtmlParserProvider().parse({
		path: "fragment.html",
		source: '<product-card data-product="example"></product-card>',
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.document.syntax.rootNode.type, "document");
});

test("JavaScript parser provider returns ESTree program", () => {
	const result = new JavaScriptParserProvider().parse({
		path: "assets/theme.js",
		source: 'customElements.define("product-card", ProductCard);',
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.document.syntax.type, "Program");
});

test("CSS parser provider selects SCSS parser by extension", () => {
	const result = new CssParserProvider().parse({
		path: "assets/theme.scss",
		source: ".card { &.is-active { color: red; } }",
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.document.language, "scss");
	assert.equal(result.document.syntax.type, "root");
});

test("GraphQL parser provider returns GraphQL document", () => {
	const result = new GraphqlParserProvider().parse({
		path: "queries/product.graphql",
		source: "query Product { product { id } }",
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.document.syntax.kind, "Document");
});

test("default provider set covers supported source families", () => {
	assert.deepEqual(
		createDefaultParserProviders().map((provider) => provider.id),
		[
			"tree-sitter-liquid",
			"tree-sitter-html",
			"acorn",
			"jsonc-parser",
			"postcss",
			"graphql",
		],
	);
});
