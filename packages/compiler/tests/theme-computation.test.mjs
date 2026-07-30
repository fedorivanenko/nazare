import assert from "node:assert/strict";
import test from "node:test";
import {
	computeNazareTheme,
	getThemeFileImpact,
	getThemeFileImpacts,
	inspectNazareTheme,
	ThemeProgram,
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

test("ThemeProgram keeps graph projection lazy until a graph caller opts in", () => {
	const program = new ThemeProgram(files);
	const changed = files.map((file) =>
		file.path === "snippets/card.liquid"
			? { ...file, contents: "{{ product.title }} {{ product.price }}" }
			: file,
	);
	const semanticUpdate = program.updateFile(changed[2]);
	assert.equal(semanticUpdate.graph, undefined);
	assert.equal(semanticUpdate.telemetry.graphRecordsReplaced, 0);
	assert.deepEqual(program.getGraph(), inspectNazareTheme(changed));

	const second = { ...changed[2], contents: "{{ product.handle }}" };
	const graphUpdate = program.updateFile(second);
	assert.ok(graphUpdate.graph);
	assert.ok(graphUpdate.telemetry.graphRecordsReplaced > 0);
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
