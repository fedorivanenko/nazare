import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileArtifact, emitTheme } from "../dist/index.js";

function filesUnder(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path));
		else if (path.endsWith(".nz.liquid")) files.push(path);
	}
	return files;
}

function compilePair(source, file) {
	const legacy = compileArtifact({ source, file });
	const treeSitter = compileArtifact({
		source,
		file,
		sourceFrontend: "tree-sitter",
	});
	assert.equal(legacy.ok, true);
	assert.equal(treeSitter.ok, true);
	assert.equal(treeSitter.frontend, "tree-sitter-nazare-liquid");
	return { legacy, treeSitter };
}

function assertParity(source, file) {
	const { legacy, treeSitter } = compilePair(source, file);
	assert.deepEqual(
		treeSitter.ast.nodes,
		legacy.ast.nodes,
		`${file}: AST nodes`,
	);
	assert.deepEqual(treeSitter.syntax, legacy.syntax, `${file}: syntax`);
	assert.deepEqual(treeSitter.ir, legacy.ir, `${file}: IR`);
	assert.deepEqual(treeSitter.graph, legacy.graph, `${file}: graph`);
	assert.deepEqual(treeSitter.issues, legacy.issues, `${file}: diagnostics`);
	assert.deepEqual(treeSitter.notes, legacy.notes, `${file}: notes`);
	assert.deepEqual(
		emitTheme(source, treeSitter, { name: "parity" }),
		emitTheme(source, legacy, { name: "parity" }),
		`${file}: emission`,
	);
}

test("Tree-sitter Nazare frontend matches committed fixture corpus", () => {
	const repository = fileURLToPath(new URL("../../../", import.meta.url));
	const roots = [
		fileURLToPath(new URL("./fixtures/", import.meta.url)),
		join(repository, "fixtures"),
		join(repository, "examples"),
	];
	const paths = roots.flatMap(filesUnder);
	assert.ok(paths.length > 0);
	for (const path of paths) {
		const file = relative(repository, path).replaceAll("\\", "/");
		assertParity(readFileSync(path, "utf8"), file);
	}
});

test("invalid Nazare CST cannot leak partial projected facts", () => {
	const source = `{% component snippet %}{% script lang="ts" %}const x = 1;`;
	const compiled = compileArtifact({
		source,
		file: "invalid.nz.liquid",
		sourceFrontend: "tree-sitter",
	});

	assert.equal(compiled.ok, true);
	assert.equal(compiled.canEmit, false);
	assert.deepEqual(compiled.ast.nodes, []);
	assert.equal(compiled.frontendMetadata.authoritative, false);
	assert.ok(
		compiled.issues.some((issue) => issue.message.includes("TREE_SITTER_")),
	);
});

test("Tree-sitter Nazare frontend matches scripts, styles, and HTML markers", () => {
	const source = `{% component snippet %}
{% props { title: string.required() } %}
<div ref="root" nz-root data-title="{{ props.title }}">{{ props.title }}</div>
{% stylesheet styles %}.root { color: red; }{% endstylesheet %}
<div class="{{ styles.root }}" island="behavior"></div>
{% script %}
export default island(({ refs, data }) => console.log(refs.root, data.root.title));
{% endscript %}`;
	assertParity(source, "parity.nz.liquid");
});
