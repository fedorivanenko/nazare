import assert from "node:assert/strict";
import test from "node:test";
import {
	buildNazareThemeWorkspace,
	compileNazareArtifact,
} from "../dist/index.js";

function buildWorkspaceFile(source, file, options = {}) {
	const built = buildNazareThemeWorkspace([{ path: file, contents: source }], {
		...options,
		scope: { kind: "file", path: file },
	});
	return {
		emitted: built.emitted,
		issues: built.issues,
	};
}

test("compile: nz-root is explicit syntax", () => {
	const result = compileNazareArtifact(
		`<div nz-root></div>`,
		"component.nz.liquid",
	);

	assert.equal(
		result.ast.nodes.filter((node) => node.type === "NazareRootMarker").length,
		1,
	);
	assert.equal(
		result.syntax.filter((node) => node.kind === "root-marker").length,
		1,
	);
	assert.ok(
		result.graph.edges.some(
			(edge) => edge.kind === "declares" && edge.to.includes("root-marker"),
		),
	);
});

test("emit: implicit single-root fallback is surfaced", () => {
	const source = `<div></div>
{% script %}
export default island(() => {});
{% endscript %}`;
	const built = buildWorkspaceFile(source, "component.nz.liquid", {
		name: "component",
	});

	assert.ok(
		built.issues.some((issue) => issue.code === "EMIT_IMPLICIT_ROOT_ELEMENT"),
	);
});

test("emit: nz-root selects explicit root and is stripped", () => {
	const source = `<section></section>
<div nz-root></div>
{% script %}
export default island(() => {});
{% endscript %}`;
	const built = buildWorkspaceFile(source, "component.nz.liquid", {
		name: "component",
	});
	const liquid = built.emitted.files.find(
		(file) => file.path === "snippets/component.liquid",
	)?.contents;

	assert.ok(
		!built.issues.some((issue) => issue.code === "EMIT_AMBIGUOUS_ROOT_ELEMENT"),
	);
	assert.match(liquid, /<div data-nz-component="component"><\/div>/);
	assert.doesNotMatch(liquid, /nz-root/);
});

test("emit: multiple nz-root markers warn and first wins", () => {
	const source = `<section nz-root></section>
<div nz-root></div>
{% script %}
export default island(() => {});
{% endscript %}`;
	const built = buildWorkspaceFile(source, "component.nz.liquid", {
		name: "component",
	});
	const liquid = built.emitted.files.find(
		(file) => file.path === "snippets/component.liquid",
	)?.contents;

	assert.ok(
		built.issues.some((issue) => issue.code === "EMIT_MULTIPLE_ROOT_MARKERS"),
	);
	assert.match(liquid, /<section data-nz-component="component"><\/section>/);
	assert.doesNotMatch(liquid, /<div data-nz-component/);
});
