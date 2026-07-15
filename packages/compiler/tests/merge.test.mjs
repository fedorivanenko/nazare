import assert from "node:assert/strict";
import test from "node:test";
import {
	artifactGraphFromIR,
	compileNazareArtifact,
	componentSymbolIdForFile,
	mergeArtifactIR,
} from "../dist/index.js";

// A parent that imports a child by the child's canonical build path (the
// identity model: import path == file path). Both compile independently.
function compilePair() {
	const files = {
		"child.nz.liquid": `{% props { title: string.required() } %}<span>{{ props.title }}</span>`,
	};
	const readFile = (path) => files[path];
	const parent = compileNazareArtifact(
		`{% import Child from "./child.nz.liquid" %}\n{% render Child { title: "hi" } %}`,
		"parent.nz.liquid",
		{ readFile },
	);
	const child = compileNazareArtifact(
		files["child.nz.liquid"],
		"child.nz.liquid",
	);
	return { parent, child };
}

test("mergeArtifactIR connects a cross-file import edge", () => {
	const { parent, child } = compilePair();
	const merged = mergeArtifactIR([parent.ir, child.ir]);

	const childSymbolId = componentSymbolIdForFile("child.nz.liquid");

	// Dedupe: exactly one component symbol node for the child across both IRs.
	const childSymbols = merged.symbols.filter((s) => s.id === childSymbolId);
	assert.equal(childSymbols.length, 1);

	// The most-resolved copy wins: the child's own compile makes it local, not
	// the parent's external stub.
	assert.notEqual(childSymbols[0].resolution, "external-unresolved");

	// The graph over the merged IR carries an `imports` edge into the child node,
	// and the child node exists — cross-file connectivity.
	const graph = artifactGraphFromIR(merged);
	const importEdge = graph.edges.find(
		(e) => e.kind === "imports" && e.to === childSymbolId,
	);
	assert.ok(importEdge, "expected an imports edge into the child symbol");
	assert.ok(
		graph.nodes.some((n) => n.id === childSymbolId),
		"expected the child symbol to be a node in the merged graph",
	);
});

test("mergeArtifactIR keeps an unresolved import as a dangling node", () => {
	// Parent imports a component that never compiled (no readFile entry).
	const parent = compileNazareArtifact(
		`{% import Missing from "./missing.nz.liquid" %}\n{% render Missing {} %}`,
		"parent.nz.liquid",
	);
	const merged = mergeArtifactIR([parent.ir]);
	const missingId = componentSymbolIdForFile("missing.nz.liquid");
	const missing = merged.symbols.find((s) => s.id === missingId);
	assert.ok(missing, "unresolved import should still appear as a symbol");
	assert.equal(missing.resolution, "external-unresolved");

	// A dangling node, not a crash: the graph builds and has no outbound edge
	// declaring the missing component.
	const graph = artifactGraphFromIR(merged);
	assert.ok(graph.nodes.some((n) => n.id === missingId));
});

test("mergeArtifactIR tolerates an import cycle", () => {
	const files = {
		"a.nz.liquid": `{% import B from "./b.nz.liquid" %}\n{% render B {} %}`,
		"b.nz.liquid": `{% import A from "./a.nz.liquid" %}\n{% render A {} %}`,
	};
	const readFile = (path) => files[path];
	const a = compileNazareArtifact(files["a.nz.liquid"], "a.nz.liquid", {
		readFile,
	});
	const b = compileNazareArtifact(files["b.nz.liquid"], "b.nz.liquid", {
		readFile,
	});

	const merged = mergeArtifactIR([a.ir, b.ir]);
	assert.ok(
		merged.symbols.some(
			(s) => s.id === componentSymbolIdForFile("a.nz.liquid"),
		),
	);
	assert.ok(
		merged.symbols.some(
			(s) => s.id === componentSymbolIdForFile("b.nz.liquid"),
		),
	);

	// The graph is a fact, not a validated tree: a cycle builds fine.
	const graph = artifactGraphFromIR(merged);
	assert.ok(graph.edges.some((e) => e.kind === "imports"));
});

test("mergeArtifactIR dedupes identical resolutions", () => {
	const { parent } = compilePair();
	// Merging an IR with itself must not double its resolutions or symbols.
	const once = mergeArtifactIR([parent.ir]);
	const twice = mergeArtifactIR([parent.ir, parent.ir]);
	assert.equal(twice.resolutions.length, once.resolutions.length);
	assert.equal(twice.symbols.length, once.symbols.length);
	assert.equal(twice.syntax.length, once.syntax.length);
});
