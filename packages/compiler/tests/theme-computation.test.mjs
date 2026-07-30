import assert from "node:assert/strict";
import test from "node:test";
import {
	computeNazareTheme,
	getThemeFileImpact,
	getThemeFileImpacts,
	inspectNazareTheme,
} from "../dist/index.js";

const files = [
	{
		path: "templates/product.json",
		contents: JSON.stringify({
			sections: { main: { type: "main-product" } },
			order: ["main"],
		}),
	},
	{
		path: "sections/main-product.liquid",
		contents:
			'{% render \'card\', product: product %}{% schema %}{"name":"Main product"}{% endschema %}',
	},
	{
		path: "snippets/card.liquid",
		contents: "{{ product.title }}",
	},
];

test("computation owns direct queries and lazily projects the public graph", () => {
	const computation = computeNazareTheme(files);
	const direct = computation.getFileImpact("snippets/card.liquid");
	const graph = computation.toInspectGraph();
	assert.deepEqual(direct, getThemeFileImpact(graph, "snippets/card.liquid"));
	assert.deepEqual(computation.getFileImpacts(), getThemeFileImpacts(graph));
	assert.strictEqual(computation.toInspectGraph(), graph);
	assert.deepEqual(graph, inspectNazareTheme(files));
});

test("direct impact queries do not require a public graph snapshot", () => {
	const computation = computeNazareTheme(files);
	assert.deepEqual(
		computation.getImpactSummary().affectedPages["snippets/card.liquid"],
		["templates/product.json"],
	);
	assert.equal(
		computation.getFileImpact("snippets/card.liquid")?.usage,
		"used",
	);
	assert.equal(computation.getFileImpact("missing.liquid"), undefined);
});
