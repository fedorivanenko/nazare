// Equivalence over the committed corpus theme in fixtures/theme-corpus.
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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	analyzeNazareTheme,
	inspectNazareTheme,
	ThemeImpactIndex,
	ThemeProgram,
} from "../dist/index.js";

const corpusRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../fixtures/theme-corpus",
);

/** The same file-selection policy the CLI applies, kept deliberately simple. */
function readsContents(path) {
	return (
		path.endsWith(".nz.liquid") ||
		/^sections\/[^/]+\.(json|liquid)$/.test(path) ||
		/^snippets\/[^/]+\.liquid$/.test(path) ||
		/^blocks\/[^/]+\.liquid$/.test(path) ||
		/^templates\/.+\.(json|liquid)$/.test(path) ||
		/^layout\/[^/]+\.liquid$/.test(path) ||
		/^locales\/[^/]+\.json$/.test(path) ||
		path === "config/settings_schema.json" ||
		path === "config/settings_data.json"
	);
}

function corpusFiles() {
	const files = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory)) {
			const absolute = join(directory, entry);
			if (statSync(absolute).isDirectory()) {
				walk(absolute);
				continue;
			}
			const path = relative(corpusRoot, absolute).split(sep).join("/");
			if (readsContents(path)) {
				files.push({ path, contents: readFileSync(absolute, "utf8") });
			} else if (path.startsWith("assets/")) {
				files.push({ path, contents: "" });
			}
		}
	};
	walk(corpusRoot);
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

const options = {
	metafields: {
		path: ".shopify/metafields.json",
		contents: readFileSync(
			join(corpusRoot, ".shopify/metafields.json"),
			"utf8",
		),
	},
};

function assertProgramEqualsCold(program, files) {
	const cold = analyzeNazareTheme(files, options);
	const coldGraph = inspectNazareTheme(files, options);
	assert.deepEqual(program.getModel(), cold.ir);
	assert.deepEqual(program.getFacts(), cold.facts);
	assert.deepEqual(program.getGraph(), coldGraph);
	const coldImpact = new ThemeImpactIndex(coldGraph);
	for (const node of coldGraph.nodes) {
		assert.deepEqual(
			program.getDependencies(node.id),
			coldImpact.getDependencies(node.id),
			`dependencies diverged for ${node.id}`,
		);
		assert.deepEqual(
			program.getAffectedPages(node.id),
			coldImpact.getAffectedPages(node.id),
			`affected pages diverged for ${node.id}`,
		);
	}
}

test("corpus fixture covers every theme file kind", () => {
	const graph = inspectNazareTheme(corpusFiles(), options);
	const kinds = new Set(graph.nodes.map((node) => node.kind));
	for (const kind of [
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
		"classification",
		"capability",
		"expectedInput",
	]) {
		assert.ok(kinds.has(kind), `corpus produced no ${kind} node`);
	}
});

test("batch and program agree on the corpus", () => {
	const files = corpusFiles();
	assertProgramEqualsCold(new ThemeProgram(files, options), files);
});

test("incremental edits converge on the cold corpus graph", () => {
	const files = corpusFiles();
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
	assertProgramEqualsCold(program, afterEdit);

	// Remove a section and converge again.
	program.removeFile("sections/unused-promo.liquid");
	const afterRemoval = afterEdit.filter(
		(file) => file.path !== "sections/unused-promo.liquid",
	);
	assertProgramEqualsCold(program, afterRemoval);

	// Restore both and land back on the original graph.
	program.updateFile(price);
	program.updateFile(
		files.find((file) => file.path === "sections/unused-promo.liquid"),
	);
	assertProgramEqualsCold(program, files);
});
