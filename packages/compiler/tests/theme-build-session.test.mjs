import assert from "node:assert/strict";
import test from "node:test";
import {
	buildNazareThemeWorkspace,
	ThemeBuildSession,
	ThemeProgram,
} from "../dist/index.js";

function emittedFile(build, path) {
	const file = build.emitted.files.find((candidate) => candidate.path === path);
	assert.ok(file, `Expected emitted output ${path}`);
	return file;
}

test("build session tracks output ownership and retains unchanged snapshots", () => {
	const session = new ThemeBuildSession([
		{ path: "a.nz.liquid", contents: "<span>A</span>" },
		{ path: "b.nz.liquid", contents: "<span>B</span>" },
	]);
	const initialA = emittedFile(session.getBuild(), "snippets/a.liquid");
	const initialB = emittedFile(session.getBuild(), "snippets/b.liquid");

	assert.deepEqual(session.getOwnedOutputPaths("./a.nz.liquid"), [
		"snippets/a.liquid",
	]);
	assert.deepEqual(session.getOutputOwners("./snippets/a.liquid"), [
		"a.nz.liquid",
	]);

	const update = session.updateFile({
		path: "a.nz.liquid",
		contents: "<span>Updated A</span>",
	});
	assert.deepEqual(update.recomputedPaths, ["a.nz.liquid"]);
	assert.deepEqual(update.changedOutputPaths, ["snippets/a.liquid"]);
	assert.notStrictEqual(
		emittedFile(session.getBuild(), "snippets/a.liquid"),
		initialA,
	);
	assert.strictEqual(
		emittedFile(session.getBuild(), "snippets/b.liquid"),
		initialB,
	);

	const finalFiles = [
		{ path: "a.nz.liquid", contents: "<span>Updated A</span>" },
		{ path: "b.nz.liquid", contents: "<span>B</span>" },
	];
	assert.deepEqual(session.getBuild(), buildNazareThemeWorkspace(finalFiles));
});

test("build session removes stale owned outputs and preserves retained outputs", () => {
	const session = new ThemeBuildSession([
		{ path: "a.nz.liquid", contents: "<span>A</span>" },
		{ path: "b.nz.liquid", contents: "<span>B</span>" },
	]);
	const retainedB = emittedFile(session.getBuild(), "snippets/b.liquid");

	const update = session.removeFile("a.nz.liquid");
	assert.deepEqual(update.removedOutputPaths, ["snippets/a.liquid"]);
	assert.deepEqual(session.getOwnedOutputPaths("a.nz.liquid"), []);
	assert.deepEqual(session.getOutputOwners("snippets/a.liquid"), []);
	assert.strictEqual(
		emittedFile(session.getBuild(), "snippets/b.liquid"),
		retainedB,
	);
	assert.deepEqual(
		session.getBuild(),
		buildNazareThemeWorkspace([
			{ path: "b.nz.liquid", contents: "<span>B</span>" },
		]),
	);
});

test("build session computes dependent closure without replacing unrelated outputs", () => {
	const session = new ThemeBuildSession([
		{
			path: "parent.nz.liquid",
			contents:
				'{% import Child from "./child.nz.liquid" %}<div>{% render Child {} %}</div>',
		},
		{ path: "child.nz.liquid", contents: "<span>Child</span>" },
		{ path: "unrelated.nz.liquid", contents: "<aside>Unrelated</aside>" },
	]);
	const unrelated = emittedFile(
		session.getBuild(),
		"snippets/unrelated.liquid",
	);
	const initialParentAst = session
		.getBuild()
		.artifacts.find((artifact) => artifact.path === "parent.nz.liquid")?.ast;
	const unrelatedAst = session
		.getBuild()
		.artifacts.find((artifact) => artifact.path === "unrelated.nz.liquid")?.ast;
	assert.ok(initialParentAst);
	assert.ok(unrelatedAst);

	const update = session.updateFile({
		path: "child.nz.liquid",
		contents: "<strong>Updated child</strong>",
	});
	assert.deepEqual(update.recomputedPaths, [
		"child.nz.liquid",
		"parent.nz.liquid",
	]);
	assert.strictEqual(
		emittedFile(session.getBuild(), "snippets/unrelated.liquid"),
		unrelated,
	);
	assert.notStrictEqual(
		session
			.getBuild()
			.artifacts.find((artifact) => artifact.path === "parent.nz.liquid")?.ast,
		initialParentAst,
	);
	assert.strictEqual(
		session
			.getBuild()
			.artifacts.find((artifact) => artifact.path === "unrelated.nz.liquid")
			?.ast,
		unrelatedAst,
	);
	assert.deepEqual(session.getOwnedOutputPaths("parent.nz.liquid"), [
		"snippets/parent.liquid",
	]);
});

test("build session reference-counts shared runtime assets", () => {
	const scripted = (label) =>
		`<div ref="root">${label}</div>\n{% script %}\nexport default island(({ refs }) => refs.root.remove());\n{% endscript %}`;
	const session = new ThemeBuildSession([
		{ path: "a.nz.liquid", contents: scripted("A") },
		{ path: "b.nz.liquid", contents: scripted("B") },
	]);
	assert.deepEqual(session.getOutputOwners("assets/nazare-runtime.js"), [
		"a.nz.liquid",
		"b.nz.liquid",
	]);

	session.removeFile("a.nz.liquid");
	assert.deepEqual(session.getOutputOwners("assets/nazare-runtime.js"), [
		"b.nz.liquid",
	]);
	assert.ok(
		session
			.getBuild()
			.emitted.files.some((file) => file.path === "assets/nazare-runtime.js"),
	);
});

test("build session and server-style program share one atomic revision", () => {
	const files = [{ path: "a.nz.liquid", contents: "<span>A</span>" }];
	const program = new ThemeProgram(files);
	const session = new ThemeBuildSession(files, {}, program);
	const update = session.updateFile({
		path: "a.nz.liquid",
		contents: "<strong>Updated</strong>",
	});
	assert.equal(update.graphUpdate.revision, 1);
	assert.strictEqual(update.graphUpdate.graph, program.getGraph());
	assert.equal(
		program.updateFile({
			path: "a.nz.liquid",
			contents: "<strong>Updated</strong>",
		}).revision,
		1,
	);
});

test("build session rejects collisions with retained outputs transactionally", () => {
	const files = [
		{
			path: "components/a/card.nz.liquid",
			contents: "<span>Original</span>",
		},
	];
	const program = new ThemeProgram(files);
	const session = new ThemeBuildSession(files, {}, program);
	const committed = session.getBuild();
	const committedGraph = program.getGraph();
	assert.throws(
		() =>
			session.updateFile({
				path: "components/b/card.nz.liquid",
				contents: "<strong>Collision</strong>",
			}),
		/Selective build output collision at snippets\/card\.liquid/,
	);
	assert.strictEqual(session.getBuild(), committed);
	assert.strictEqual(program.getGraph(), committedGraph);
});
