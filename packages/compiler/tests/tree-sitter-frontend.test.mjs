import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	analyzeNazareTheme,
	buildNazareThemeWorkspace,
	compileArtifact,
	emitTheme,
} from "../dist/index.js";

function filesUnder(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path));
		else if (path.endsWith(".nz.liquid")) files.push(path);
	}
	return files;
}

function themeFilesUnder(directory, root = directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...themeFilesUnder(path, root));
		} else if (path.endsWith(".liquid") || path.endsWith(".json")) {
			files.push({
				path: relative(root, path),
				contents: readFileSync(path, "utf8"),
			});
		} else if (relative(root, path).startsWith("assets/")) {
			files.push({ path: relative(root, path), contents: "" });
		}
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
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

test("Tree-sitter selection propagates through workspace dependency closure", () => {
	const files = [
		{
			path: "components/button.nz.liquid",
			contents: `{% component snippet %}{% props { label: string.required() } %}<button>{{ props.label }}</button>`,
		},
		{
			path: "components/card.nz.liquid",
			contents: `{% component section %}{% import Button from "./button.nz.liquid" %}{% props { title: string.required() } %}<article>{% render Button { label: props.title } %}</article>`,
		},
	];
	const legacy = buildNazareThemeWorkspace(files);
	const treeSitter = buildNazareThemeWorkspace(files, {
		sourceFrontend: "tree-sitter",
	});

	assert.deepEqual(treeSitter.analysis.ir, legacy.analysis.ir);
	assert.deepEqual(treeSitter.analysis.facts, legacy.analysis.facts);
	assert.deepEqual(treeSitter.issues, legacy.issues);
	assert.deepEqual(treeSitter.emitted, legacy.emitted);
	assert.deepEqual(
		treeSitter.artifacts.map((artifact) => artifact.ir),
		legacy.artifacts.map((artifact) => artifact.ir),
	);
});

test("Tree-sitter theme source facts match the committed corpus", () => {
	const root = fileURLToPath(
		new URL("../../../fixtures/theme-corpus/", import.meta.url),
	);
	const files = themeFilesUnder(root);
	const metafields = {
		path: ".shopify/metafields.json",
		contents: readFileSync(join(root, ".shopify/metafields.json"), "utf8"),
	};
	const legacy = analyzeNazareTheme(files, { metafields });
	const treeSitter = analyzeNazareTheme(files, {
		metafields,
		sourceFrontend: "tree-sitter",
	});
	assert.deepEqual(treeSitter.ir, legacy.ir);
	assert.deepEqual(treeSitter.facts, legacy.facts);
	assert.deepEqual(treeSitter.issues, legacy.issues);
});

test("Tree-sitter Nazare malformed syntax diagnostics match legacy", () => {
	const sources = [
		`{% component widget %}`,
		`{% import Card "./card.nz.liquid" %}`,
		`{% render Card, title: "Hello" %}`,
		`{% blocks "Card" %}`,
		`{% stylesheet bad-name %}.x {}{% endstylesheet %}`,
		`{% script %}const broken = true;`,
		`{% stylesheet %}.broken { color: red; }`,
		`<div ref="{{ dynamic }}"></div>`,
		`<div island="not-valid!"></div>`,
	];
	for (const source of sources) {
		const legacy = compileArtifact({ source, file: "malformed.nz.liquid" });
		const treeSitter = compileArtifact({
			source,
			file: "malformed.nz.liquid",
			sourceFrontend: "tree-sitter",
		});
		assert.deepEqual(treeSitter.issues, legacy.issues, source);
	}
});

test("Tree-sitter malformed corpus fails closed without partial facts", () => {
	const sources = [
		`{% component %}`,
		`{% import Card %}`,
		`{% render Card %}`,
		`{% blocks Card, %}`,
		`{% props { title: } %}`,
		`{{ product.title`,
		`{% script %}const broken = true;`,
		`{% stylesheet %}.broken { color: red; }`,
	];
	for (const source of sources) {
		const compiled = compileArtifact({
			source,
			file: "malformed-corpus.nz.liquid",
			sourceFrontend: "tree-sitter",
		});
		assert.equal(compiled.canEmit, false, source);
		assert.ok(
			compiled.issues.some((issue) => issue.severity === "error"),
			source,
		);
		if (compiled.frontendMetadata.authoritative === false) {
			assert.deepEqual(compiled.ast.nodes, [], source);
		}
	}
});

test("Tree-sitter rejects unclosed Liquid that the tolerant legacy parser accepted", () => {
	const source = `{% if product %}<div>`;
	const legacy = compileArtifact({ source, file: "unclosed.nz.liquid" });
	const treeSitter = compileArtifact({
		source,
		file: "unclosed.nz.liquid",
		sourceFrontend: "tree-sitter",
	});
	assert.equal(legacy.canEmit, true);
	assert.equal(treeSitter.canEmit, false);
	assert.equal(treeSitter.frontendMetadata.authoritative, false);
	assert.deepEqual(treeSitter.ast.nodes, []);
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
		compiled.issues.some(
			(issue) => issue.code === "NAZARE_PARSE_UNCLOSED_RAW_BLOCK",
		),
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
