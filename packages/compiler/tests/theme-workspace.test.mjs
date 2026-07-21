import assert from "node:assert/strict";
import test from "node:test";
import {
	buildNazareThemeWorkspace,
	inspectNazareTheme,
} from "../dist/index.js";

const hasIssue = (result, code) =>
	result.issues.some((issue) => issue.code === code);

test("inspectNazareTheme keeps unresolved references navigable", () => {
	const graph = inspectNazareTheme([
		{ path: "sections/main.liquid", contents: `{% render 'missing' %}` },
	]);

	assert.equal(hasIssue(graph, "THEME_UNRESOLVED_REFERENCE"), true);
	assert.ok(
		graph.nodes.some(
			(node) => node.kind === "unresolved" && node.name === "missing",
		),
	);
});

test("impact summary follows template dependencies and Shopify-owned entries", () => {
	const graph = inspectNazareTheme([
		{
			path: "templates/product.json",
			contents: JSON.stringify({
				sections: { main: { type: "main-product" } },
			}),
		},
		{ path: "sections/main-product.liquid", contents: `{% render 'price' %}` },
		{ path: "snippets/price.liquid", contents: `{{ product.price }}` },
		{ path: "snippets/unused.liquid", contents: "Unused" },
		{ path: "config/settings_schema.json", contents: "[]" },
		{ path: "config/settings_data.json", contents: "{}" },
	]);

	assert.deepEqual(graph.impact.dependencies["templates/product.json"], [
		"sections/main-product.liquid",
	]);
	assert.ok(
		graph.impact.affectedPages["snippets/price.liquid"].includes(
			"templates/product.json",
		),
	);
	assert.deepEqual(graph.impact.unusedFiles, ["snippets/unused.liquid"]);
});

test("buildNazareThemeWorkspace reports invalid file scopes", () => {
	const missing = buildNazareThemeWorkspace([], {
		scope: { kind: "file", path: "missing.nz.liquid" },
	});
	assert.equal(hasIssue(missing, "THEME_SCOPE_FILE_NOT_FOUND"), true);
	assert.deepEqual(missing.artifacts, []);
	assert.deepEqual(missing.emitted.files, []);

	const unsupported = buildNazareThemeWorkspace(
		[{ path: "sections/main.liquid", contents: "<section>Main</section>" }],
		{ scope: { kind: "file", path: "sections/main.liquid" } },
	);
	assert.equal(
		hasIssue(unsupported, "THEME_SCOPE_UNSUPPORTED_FILE_KIND"),
		true,
	);
	assert.deepEqual(unsupported.artifacts, []);
	assert.deepEqual(unsupported.emitted.files, []);
});

test("buildNazareThemeWorkspace file scope emits only its import closure", () => {
	const scoped = buildNazareThemeWorkspace(
		[
			{
				path: "a.nz.liquid",
				contents: `{% import Child from "./child.nz.liquid" %}<div>A</div>`,
			},
			{ path: "child.nz.liquid", contents: `<span>Child</span>` },
			{
				path: "b.nz.liquid",
				contents: `{% import Missing from "./missing.nz.liquid" %}`,
			},
		],
		{ scope: { kind: "file", path: "a.nz.liquid" }, name: "a" },
	);

	assert.equal(scoped.artifacts.length, 1);
	assert.equal(hasIssue(scoped, "IMPORT_NOT_FOUND"), false);
	assert.ok(
		scoped.emitted.files.some((file) => file.path === "snippets/a.liquid"),
	);
});

test("closure scope emits every imported component output", () => {
	const built = buildNazareThemeWorkspace(
		[
			{
				path: "entry.nz.liquid",
				contents:
					'{% import Child from "./child.nz.liquid" %}<div>{% render Child {} %}</div>',
			},
			{ path: "child.nz.liquid", contents: "<span>Child</span>" },
		],
		{ scope: { kind: "closure", path: "entry.nz.liquid" }, name: "entry" },
	);
	assert.deepEqual(built.emitted.files.map((file) => file.path).sort(), [
		"snippets/child.liquid",
		"snippets/entry.liquid",
	]);
	assert.equal(hasIssue(built, "THEME_UNRESOLVED_REFERENCE"), false);
});

test("workspace strictly checks plain Liquid and component scripts before emit", () => {
	const liquid = buildNazareThemeWorkspace([
		{ path: "sections/broken.liquid", contents: "{% if %}" },
		{ path: "valid.nz.liquid", contents: "<span>Valid</span>" },
	]);
	assert.equal(hasIssue(liquid, "NAZARE_PARSE_LIQUID"), true);
	assert.deepEqual(liquid.emitted.files, []);

	const scripts = buildNazareThemeWorkspace([
		{
			path: "invalid.nz.liquid",
			contents:
				'<div ref="panel"></div>{% script lang="ts" %}export default island(({ refs }) => { refs.panel.disabled = true; });{% endscript %}',
		},
	]);
	assert.equal(hasIssue(scripts, "SCRIPT_TYPE_ERROR"), true);
	assert.equal(scripts.artifacts[0]?.canEmit, false);
	assert.deepEqual(scripts.emitted.files, []);
});

test("invalid script emission is an error and clean-only output is empty", () => {
	const built = buildNazareThemeWorkspace([
		{
			path: "invalid.nz.liquid",
			contents: "{% script %}console.log('missing export'){% endscript %}",
		},
	]);
	assert.equal(hasIssue(built, "EMIT_SCRIPT_WITHOUT_DEFAULT_EXPORT"), true);
	assert.equal(built.artifacts[0]?.canEmit, false);
	assert.deepEqual(built.emitted.files, []);
});

test("workspace errors prevent all default emission", () => {
	const built = buildNazareThemeWorkspace([
		{ path: "snippets/valid.nz.liquid", contents: "{% component snippet %}ok" },
		{ path: "templates/index.json", contents: "{" },
	]);

	assert.equal(hasIssue(built, "THEME_JSON_PARSE_ERROR"), true);
	assert.deepEqual(built.emitted.files, []);
	assert.equal(built.emittedOnError, false);
});
