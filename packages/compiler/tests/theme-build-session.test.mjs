import assert from "node:assert/strict";
import test from "node:test";
import { buildNazareThemeWorkspace, ThemeBuildSession } from "../dist/index.js";

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
	const unrelatedAst = session
		.getBuild()
		.artifacts.find((artifact) => artifact.path === "unrelated.nz.liquid")?.ast;
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
