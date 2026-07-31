// Equivalence over the committed theme in fixtures/canonical-theme.
//
// theme-replay.test.mjs proves the same properties over hand-written file sets
// of a few files each. This proves them over a theme that exercises every file
// kind, every classification rule, and the metafield and locale paths — the
// scale at which the incremental machinery and the batch pipeline are actually
// allowed to disagree.
//
// Every deletion of a duplicate implementation is justified by these three
// assertions, so they run in CI on every change.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	CANONICAL_THEME_ROOT,
	loadThemeFixture,
} from "../../../fixtures/theme-fixture.mjs";
import { ThemeProgram } from "../dist/index.js";
import { assertProgramEqualsCold } from "./theme-equivalence.mjs";

const canonicalFiles = () => loadThemeFixture(CANONICAL_THEME_ROOT);
const options = {
	metafields: {
		path: ".shopify/metafields.json",
		contents: readFileSync(
			join(CANONICAL_THEME_ROOT, ".shopify/metafields.json"),
			"utf8",
		),
	},
};

test("canonical theme covers structural graph and rich semantic families", () => {
	const files = canonicalFiles();
	const program = new ThemeProgram(files, options);
	const graph = program.getGraph();
	const kinds = new Set(graph.nodes.map((node) => node.kind));
	for (const kind of [
		"file",
		"section",
		"sectionGroup",
		"snippet",
		"themeBlock",
		"template",
		"page",
		"layout",
		"locale",
		"asset",
		"component",
		"metafieldDefinition",
	]) {
		assert.ok(kinds.has(kind), `canonical theme produced no ${kind} node`);
	}
	const edgeKinds = new Set(graph.edges.map((edge) => edge.kind));
	for (const kind of [
		"declares",
		"renders",
		"readsSetting",
		"readsMetafield",
	]) {
		assert.ok(edgeKinds.has(kind), `canonical theme produced no ${kind} edge`);
	}
	const model = program.getModel();
	assert.ok(model.behavior.length > 0);
	assert.ok(model.capabilities.length > 0);
	assert.ok(model.classifications.length > 0);
	assert.ok(model.expectedInputs.length > 0);
	assert.ok(model.evidence.length > 0);
});

test("batch and program agree on the canonical theme", () => {
	const files = canonicalFiles();
	assertProgramEqualsCold(new ThemeProgram(files, options), files, options);
});

test("batch and program deduplicate references that share one stable ID", () => {
	const files = [
		{
			path: "templates/index.json",
			contents: JSON.stringify({
				sections: {
					first: { type: "featured-collection" },
					second: { type: "featured-collection" },
				},
				order: ["first", "second"],
			}),
		},
		{
			path: "sections/featured-collection.liquid",
			contents: '{% schema %}{"name":"Featured collection"}{% endschema %}',
		},
	];
	const program = new ThemeProgram(files);
	assertProgramEqualsCold(program, files);
	assert.equal(program.getModel().references.length, 1);
	assert.equal(program.getModel().sectionInstances.length, 2);
});

test("incremental edits converge on the cold canonical graph", () => {
	const files = canonicalFiles();
	const program = new ThemeProgram(files, options);

	// Edit a leaf snippet every page depends on transitively.
	const price = files.find((file) => file.path === "snippets/price.liquid");
	const editedPrice = {
		path: price.path,
		contents: `${price.contents}\n<span data-edit="1"></span>\n`,
	};
	program.updateFile(editedPrice);
	const afterEdit = files.map((file) =>
		file.path === price.path ? editedPrice : file,
	);
	assertProgramEqualsCold(program, afterEdit, options);

	// Remove a section and converge again.
	program.removeFile("sections/unused-promo.liquid");
	const afterRemoval = afterEdit.filter(
		(file) => file.path !== "sections/unused-promo.liquid",
	);
	assertProgramEqualsCold(program, afterRemoval, options);

	// Restore both and land back on the original graph.
	program.updateFile(price);
	program.updateFile(
		files.find((file) => file.path === "sections/unused-promo.liquid"),
	);
	assertProgramEqualsCold(program, files, options);
});
