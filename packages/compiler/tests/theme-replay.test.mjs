import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeNazareTheme,
	buildNazareThemeWorkspace,
	inspectNazareTheme,
	ThemeBuildSession,
	ThemeImpactIndex,
	ThemeProgram,
} from "../dist/index.js";

function replaceFile(files, file) {
	return [
		...files.filter((candidate) => candidate.path !== file.path),
		file,
	].sort((a, b) => a.path.localeCompare(b.path));
}

function removeFile(files, path) {
	return files.filter((file) => file.path !== path);
}

function assertProgramEqualsCold(program, files, options = {}) {
	const coldAnalysis = analyzeNazareTheme(files, options);
	const coldGraph = inspectNazareTheme(files, options);
	assert.deepEqual(program.getModel(), coldAnalysis.ir);
	assert.deepEqual(program.getFacts(), coldAnalysis.facts);
	assert.deepEqual(program.getGraph(), coldGraph);
	assert.deepEqual(program.getGraph().evidence, coldGraph.evidence);
	assert.deepEqual(program.getModel().issues, coldAnalysis.ir.issues);
	const coldImpact = new ThemeImpactIndex(coldGraph);
	for (const node of coldGraph.nodes) {
		assert.deepEqual(
			program.getDependencies(node.id),
			coldImpact.getDependencies(node.id),
		);
		assert.deepEqual(
			program.getDependents(node.id),
			coldImpact.getDependents(node.id),
		);
		assert.deepEqual(
			program.getAffectedPages(node.id),
			coldImpact.getAffectedPages(node.id),
		);
	}
}

function assertBuildEqualsCold(session, files) {
	assert.deepEqual(session.getBuild(), buildNazareThemeWorkspace(files));
}

test("file replay matrix equals cold semantic, graph, query, and output rebuilds", () => {
	let files = [
		{
			path: "parent.nz.liquid",
			contents:
				'{% import Child from "./child.nz.liquid" %}<div>{% render Child {} %}</div>',
		},
		{ path: "child.nz.liquid", contents: "<span>Child</span>" },
		{ path: "sections/main.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "Card" },
	];
	const program = new ThemeProgram(files);
	const build = new ThemeBuildSession(files);
	const verify = () => {
		assertProgramEqualsCold(program, files);
		assertBuildEqualsCold(build, files);
	};
	verify();

	const edit = { path: "child.nz.liquid", contents: "<strong>Edited</strong>" };
	files = replaceFile(files, edit);
	program.updateFile(edit);
	build.updateFile(edit);
	verify();

	const added = { path: "extra.nz.liquid", contents: "<aside>Added</aside>" };
	files = replaceFile(files, added);
	program.updateFile(added);
	build.updateFile(added);
	verify();

	files = removeFile(files, "extra.nz.liquid");
	program.removeFile("extra.nz.liquid");
	build.removeFile("extra.nz.liquid");
	verify();

	files = removeFile(files, "snippets/card.liquid");
	program.removeFile("snippets/card.liquid");
	build.removeFile("snippets/card.liquid");
	const renamed = { path: "snippets/tile.liquid", contents: "Card" };
	files = replaceFile(files, renamed);
	program.updateFile(renamed);
	build.updateFile(renamed);
	verify();

	const imported = {
		path: "parent.nz.liquid",
		contents:
			'{% import Child from "./replacement.nz.liquid" %}<div>{% render Child {} %}</div>',
	};
	const replacement = {
		path: "replacement.nz.liquid",
		contents: "<em>Replacement</em>",
	};
	files = replaceFile(replaceFile(files, replacement), imported);
	program.updateFile(replacement);
	build.updateFile(replacement);
	program.updateFile(imported);
	build.updateFile(imported);
	verify();

	const malformed = {
		path: "replacement.nz.liquid",
		contents: "{% props title: %}<em>Broken</em>",
	};
	files = replaceFile(files, malformed);
	program.updateFile(malformed);
	build.updateFile(malformed);
	verify();

	files = replaceFile(files, replacement);
	program.updateFile(replacement);
	build.updateFile(replacement);
	verify();
});

test("external artifact replay matrix equals cold rebuilds", () => {
	const files = [
		{
			path: "sections/product.liquid",
			contents: "{{ product.metafields.custom.subtitle }}",
		},
		{ path: "snippets/card.liquid", contents: "{% render 'missing' %}" },
	];
	let options = {};
	const program = new ThemeProgram(files, options);
	const verify = () => assertProgramEqualsCold(program, files, options);
	verify();

	const metafields = {
		path: ".shopify/metafields.json",
		contents: JSON.stringify([
			{
				ownerType: "product",
				namespace: "custom",
				key: "subtitle",
				type: "single_line_text_field",
			},
		]),
	};
	options = { ...options, metafields };
	program.updateExternalArtifacts({ metafields });
	verify();

	const changedMetafields = {
		...metafields,
		contents: metafields.contents.replace(
			"single_line_text_field",
			"multi_line_text_field",
		),
	};
	options = { ...options, metafields: changedMetafields };
	program.updateExternalArtifacts({ metafields: changedMetafields });
	verify();

	const malformedMetafields = { ...metafields, contents: "{" };
	options = { ...options, metafields: malformedMetafields };
	program.updateExternalArtifacts({ metafields: malformedMetafields });
	verify();

	options = { ...options, metafields: undefined };
	program.updateExternalArtifacts({ metafields: undefined });
	verify();

	const themeCheck = {
		path: ".theme-check.yml",
		contents: "ignore:\n  - UnresolvedReference\n",
	};
	options = { ...options, themeCheck };
	program.updateExternalArtifacts({ themeCheck });
	verify();

	const malformedThemeCheck = { ...themeCheck, contents: "ignore: [" };
	options = { ...options, themeCheck: malformedThemeCheck };
	program.updateExternalArtifacts({ themeCheck: malformedThemeCheck });
	verify();

	options = { ...options, themeCheck };
	program.updateExternalArtifacts({ themeCheck });
	verify();

	options = { ...options, exclude: ["snippets/**"] };
	program.updateExternalArtifacts({ exclude: options.exclude });
	verify();

	options = { ...options, exclude: undefined };
	program.updateExternalArtifacts({ exclude: undefined });
	verify();
});
