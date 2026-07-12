import assert from "node:assert/strict";
import test from "node:test";
import {
	buildNazareTheme,
	checkComponentAuthoringConstraints,
	checkContractConstraints,
	checkScriptConstraints,
	checkStyleConstraints,
	compileNazareArtifact,
	emitCssFiles,
	emitLiquidFile,
	emitScriptFiles,
	parseNazareLiquid,
	resolveAssetImports,
} from "../dist/index.js";

test("emit sub-pass APIs are exported", () => {
	const source = `<div></div>
{% stylesheet styles %}
.wrapper { color: red; }
{% endstylesheet %}
{% script %}
export default island(() => {});
{% endscript %}`;
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	const options = { name: "component" };

	assert.equal(emitLiquidFile(source, compiled, options).files.length, 1);
	assert.equal(emitCssFiles(compiled, options).files.length, 1);
	assert.equal(emitScriptFiles(compiled, options).files.length, 2);
});

test("buildNazareTheme aggregates emit diagnostics", () => {
	const source = `{% script %}\nconsole.log("no default export");\n{% endscript %}`;
	const built = buildNazareTheme(source, "component.nz.liquid", {
		name: "component",
	});
	assert.ok(
		built.issues.some(
			(issue) => issue.code === "EMIT_SCRIPT_WITHOUT_ROOT_ELEMENT",
		),
	);
	assert.ok(
		built.issues.some(
			(issue) => issue.code === "EMIT_SCRIPT_WITHOUT_DEFAULT_EXPORT",
		),
	);
});

test("compile strictness: loose mode skips component-author linkage checks", () => {
	const source = `{% script %}\nexport default island(({ refs }) => refs.missing);\n{% endscript %}\n<div></div>`;
	const strict = compileNazareArtifact(source, "component.nz.liquid");
	const loose = compileNazareArtifact(source, "component.nz.liquid", {
		strictness: "loose",
	});

	assert.ok(
		strict.issues.some((issue) => issue.code === "CONSTRAINT_UNKNOWN_REF"),
	);
	assert.ok(
		!loose.issues.some((issue) => issue.code === "CONSTRAINT_UNKNOWN_REF"),
	);
});

test("IR coverage notices live on the notes channel, not issues", () => {
	const source = `{% if true %}<div>{{ props.title }}</div>{% endif %}`;
	const strict = compileNazareArtifact(source, "component.nz.liquid");
	const loose = compileNazareArtifact(source, "component.nz.liquid", {
		strictness: "loose",
	});

	// Notes are a separate channel, never mixed into issues and never filtered.
	assert.ok(!strict.issues.some((issue) => issue.code.startsWith("IR_")));
	assert.ok(
		strict.notes.some(
			(note) => note.code === "IR_PARTIAL_LOWERING_CONTROL_FLOW",
		),
	);
	assert.ok(
		strict.notes.some((note) => note.code === "IR_NODE_NOT_PROMOTED_HTML"),
	);
	// Notes are not mode-dependent — the same regardless of strictness.
	assert.deepEqual(
		loose.notes.map((note) => note.code).sort(),
		strict.notes.map((note) => note.code).sort(),
	);
});

test("CHECK_RULES is the single source of truth for what each mode checks", async () => {
	const { CHECK_RULES } = await import("../dist/check.js");
	const loose = CHECK_RULES.filter((rule) => rule.modes.includes("loose")).map(
		(rule) => rule.name,
	);
	const strict = CHECK_RULES.filter((rule) =>
		rule.modes.includes("strict"),
	).map((rule) => rule.name);
	assert.deepEqual(loose, ["contract-constraints", "script-constraints"]);
	assert.ok(strict.includes("component-authoring-constraints"));
	assert.ok(strict.includes("style-constraints"));
});

test("check category APIs expose the strict check groups", () => {
	const source = `<div></div>\n{% script %}\nconst refs = {};\nexport default island(({ refs }) => refs.missing);\n{% endscript %}`;
	const compiled = compileNazareArtifact(source, "component.nz.liquid");

	assert.deepEqual(checkContractConstraints(compiled.ir), []);
	assert.ok(
		checkComponentAuthoringConstraints(compiled.ir).some(
			(issue) => issue.code === "CONSTRAINT_UNKNOWN_REF",
		),
	);
	assert.ok(
		checkScriptConstraints(compiled.ir).some(
			(issue) => issue.code === "SCRIPT_RESERVED_CONTEXT_SHADOWED",
		),
	);
	assert.deepEqual(checkStyleConstraints(compiled.ir), []);
});

test("dependency diagnostics policy defaults and overrides are explicit", () => {
	const source = `{% import Child from "./child.nz.liquid" %}\n{% render Child {} %}`;
	const files = {
		"child.nz.liquid": `{% props { title: string.requried() } %}<span>{{ props.title }}</span>`,
	};
	const readFile = (path) => files[path];
	const hasDependencyParseError = (result) =>
		result.issues.some(
			(issue) => issue.code === "NAZARE_PARSE_TYPE_EXPRESSION",
		);

	assert.equal(
		hasDependencyParseError(
			compileNazareArtifact(source, "component.nz.liquid", { readFile }),
		),
		false,
	);
	assert.equal(
		hasDependencyParseError(
			compileNazareArtifact(source, "component.nz.liquid", {
				readFile,
				dependencyDiagnostics: "surface",
			}),
		),
		true,
	);
	assert.equal(
		hasDependencyParseError(
			buildNazareTheme(source, "component.nz.liquid", {
				name: "component",
				readFile,
			}),
		),
		true,
	);
	assert.equal(
		hasDependencyParseError(
			buildNazareTheme(source, "component.nz.liquid", {
				name: "component",
				readFile,
				dependencyDiagnostics: "hidden",
			}),
		),
		false,
	);
});

test("resolveAssetImports returns a resolved AST without mutating parse output", () => {
	const source = `{% import behavior from "./behavior.ts" %}\n<div></div>`;
	const ast = parseNazareLiquid(source, "component.nz.liquid");
	const resolved = resolveAssetImports(
		ast,
		() => `export default island(() => {});`,
	);

	assert.equal(ast.nodes[0].type, "NazareAssetImport");
	assert.equal(resolved.ast.nodes[0].type, "NazareScript");
	assert.equal(resolved.issues.length, 0);
});
