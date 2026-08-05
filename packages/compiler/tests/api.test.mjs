import assert from "node:assert/strict";
import test from "node:test";
import {
	checkComponentAuthoringConstraints,
	checkContractConstraints,
	checkScriptConstraints,
	checkStyleConstraints,
	compileArtifact,
	compileNazareArtifact,
	emitCssFiles,
	emitLiquidFile,
	emitScriptFiles,
	emitTheme,
	importSpecifiers,
	projectTreeSitterNazareAst,
	resolveAssetImports,
	treeSitterNazareLiquidFrontend,
} from "../dist/index.js";

function buildWorkspaceFile(source, file, options = {}) {
	const compiled = compileArtifact({
		source,
		file,
		...(options.strictness ? { strictness: options.strictness } : {}),
		...(options.readFile ? { readFile: options.readFile } : {}),
	});
	if (!compiled.ok || !compiled.ast) {
		return {
			emitted: { files: [], issues: [] },
			issues: compiled.issues,
			emittedOnError: false,
			canEmit: false,
		};
	}
	const emittedOnError = !compiled.canEmit && options.emitOnError === true;
	const emitted =
		compiled.canEmit || emittedOnError
			? emitTheme(
					source,
					{ ...compiled, ast: compiled.ast },
					{
						name: options.name ?? "component",
					},
				)
			: { files: [], issues: [] };
	return {
		...compiled,
		emitted,
		issues: [...compiled.issues, ...emitted.issues],
		emittedOnError,
	};
}

test("generic compileArtifact defaults to the Tree-sitter Nazare frontend", () => {
	const source = `{% props { title: string } %}<h1>{{ props.title }}</h1>`;
	const compiled = compileArtifact({
		source,
		file: "component.nz.liquid",
	});

	assert.equal(compiled.ok, true);
	assert.equal(compiled.frontend, "tree-sitter-nazare-liquid");
	assert.equal(compiled.canEmit, true);
	assert.equal(compiled.contract.path, "component.nz.liquid");
	assert.equal(compiled.frontendSupport.explicitPropsSyntax, true);
	assert.equal(compiled.contractProvenance, "explicit");
	assert.ok(compiled.ast);
});

test("Nazare Liquid contract provenance reports no explicit contract syntax", () => {
	const compiled = compileArtifact({
		source: "<div></div>",
		file: "component.nz.liquid",
	});

	assert.equal(compiled.ok, true);
	assert.equal(compiled.contractProvenance, "none");
});

test("compileArtifact reports unsupported input when no frontend matches", () => {
	const compiled = compileArtifact({
		source: "plain",
		file: "component.txt",
	});

	assert.equal(compiled.ok, false);
	assert.equal(compiled.frontend, undefined);
	assert.equal(compiled.canEmit, false);
	assert.equal(compiled.issues[0].code, "UNSUPPORTED_COMPILER_INPUT");
	assert.equal("contract" in compiled, false);
});

test("Tree-sitter Nazare selection projects through the shared AST boundary", () => {
	const source = `{% component snippet %}
{% props { title: string.required() } %}
<div ref="root" nz-root data-title="{{ props.title }}">{{ props.title }}</div>`;
	const compiled = compileArtifact({ source, file: "component.nz.liquid" });

	assert.equal(compiled.ok, true);
	assert.equal(compiled.frontend, "tree-sitter-nazare-liquid");
	assert.ok(compiled.ast);
	assert.ok(compiled.ir);
});

test("Nazare frontend rejects every unsupported option", () => {
	const compiled = compileArtifact({
		source: "<div></div>",
		file: "card.nz.liquid",
		frontendOptions: { parseMode: "strict" },
	});
	assert.equal(compiled.ok, false);
	assert.equal(compiled.canEmit, false);
	assert.ok(
		compiled.issues.some(
			(issue) => issue.code === "NAZARE_LIQUID_UNKNOWN_FRONTEND_OPTION",
		),
	);
});

test("compileArtifact honors an explicit frontend", () => {
	const source = `<div></div>`;
	const compiled = compileArtifact({
		source,
		file: "component.liquid",
		frontend: treeSitterNazareLiquidFrontend,
	});

	assert.equal(compiled.ok, true);
	assert.equal(compiled.frontend, "tree-sitter-nazare-liquid");
	assert.ok(compiled.ast);
});

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

test("emitLiquidFile reports overlapping emit edits as a diagnostic", () => {
	const source = `<div ref="root"></div>`;
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	const ref = compiled.ir.syntax.find((node) => node.kind === "element-ref");
	assert.ok(ref);
	compiled.ir.syntax.push({
		...ref,
		id: `${ref.id}:duplicate`,
	});

	const emitted = emitLiquidFile(source, compiled, { name: "component" });
	const theme = emitTheme(source, compiled, { name: "component" });

	assert.deepEqual(emitted.files, []);
	assert.equal(emitted.issues.length, 1);
	assert.equal(emitted.issues[0].code, "EMIT_OVERLAPPING_EDITS");
	assert.deepEqual(theme.files, []);
	assert.ok(
		theme.issues.some((issue) => issue.code === "EMIT_OVERLAPPING_EDITS"),
	);
});

test("artifact emission aggregates emit diagnostics", () => {
	const source = `{% script %}\nconsole.log("no default export");\n{% endscript %}`;
	const built = buildWorkspaceFile(source, "component.nz.liquid", {
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
	assert.ok(
		built.issues
			.filter((issue) => issue.code.startsWith("EMIT_"))
			.every((issue) => issue.phase === "emit"),
	);
});

test("artifact emission skips emit on compile errors by default", () => {
	const source = `{% import Missing from "./missing.nz.liquid" %}\n{% render Missing {} %}`;
	const built = buildWorkspaceFile(source, "component.nz.liquid", {
		name: "component",
	});

	assert.equal(built.canEmit, false);
	assert.equal(built.emittedOnError, false);
	assert.deepEqual(built.emitted.files, []);
	assert.ok(built.issues.some((issue) => issue.phase === "resolve"));
});

test("artifact emission emits on compile errors only when explicitly requested", () => {
	const source = `{% import Missing from "./missing.nz.liquid" %}\n{% render Missing {} %}`;
	const built = buildWorkspaceFile(source, "component.nz.liquid", {
		name: "component",
		emitOnError: true,
	});

	assert.equal(built.canEmit, false);
	assert.equal(built.emittedOnError, true);
	assert.ok(built.emitted.files.length > 0);
	assert.ok(built.issues.some((issue) => issue.phase === "resolve"));
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
	assert.deepEqual(loose, [
		"contract-constraints",
		"script-constraints",
		"emit-name-constraints",
	]);
	assert.ok(strict.includes("component-authoring-constraints"));
	assert.ok(strict.includes("style-constraints"));
});

test("check category APIs expose the strict check groups", () => {
	const source = `<div></div>\n{% script %}\nconst refs = {};\nexport default island(({ refs }) => refs.missing);\n{% endscript %}`;
	const compiled = compileNazareArtifact(source, "component.nz.liquid");

	assert.deepEqual(
		checkContractConstraints(compiled.ir, [], {
			reportUncheckedExpressionTypes: true,
		}),
		[],
	);
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

test("checking dependencies is an explicit call, not a compile-time policy", async () => {
	const { checkDependencies, projectTreeSitterNazareAst: project } =
		await import("../dist/index.js");
	const parse = (source, file) => project(source, file).ast;
	const source = `{% import Child from "./child.nz.liquid" %}\n{% render Child {} %}`;
	const files = {
		"child.nz.liquid": `{% props { title: string.requried() } %}<span>{{ props.title }}</span>`,
	};
	const readFile = (path) => files[path];
	const hasChildError = (issues) =>
		issues.some((issue) => issue.code === "NAZARE_PARSE_TYPE_EXPRESSION");

	// A plain compile derives the child's contract but never checks the child.
	const compiled = compileNazareArtifact(source, "component.nz.liquid", {
		readFile,
	});
	assert.equal(hasChildError(compiled.issues), false);

	// checkDependencies surfaces the child's own diagnostics, on demand.
	assert.equal(
		hasChildError(
			checkDependencies(parse(source, "component.nz.liquid"), readFile),
		),
		true,
	);
});

test("dependency checking surfaces nested import graph failures", async () => {
	const { checkDependencies, projectTreeSitterNazareAst: project } =
		await import("../dist/index.js");
	const parse = (source, file) => project(source, file).ast;
	const source = `{% import Child from "./child.nz.liquid" %}\n{% render Child {} %}`;
	const files = {
		"child.nz.liquid": `{% import Grandchild from "./missing.nz.liquid" %}\n<span>child</span>`,
	};
	const readFile = (path) => files[path];
	const issues = checkDependencies(
		parse(source, "component.nz.liquid"),
		readFile,
	);

	assert.ok(issues.some((issue) => issue.code === "IMPORT_NOT_FOUND"));
	assert.ok(
		issues.some((issue) => issue.message.includes("missing.nz.liquid")),
	);
});

test("dependency checking reports import cycles per requester", async () => {
	const { checkDependencies, projectTreeSitterNazareAst: project } =
		await import("../dist/index.js");
	const parse = (source, file) => project(source, file).ast;
	const source = `{% import A from "./a.nz.liquid" %}\n{% import B from "./b.nz.liquid" %}`;
	const files = {
		"a.nz.liquid": `{% import B from "./b.nz.liquid" %}`,
		"b.nz.liquid": `{% import A from "./a.nz.liquid" %}`,
	};
	const readFile = (path) => files[path];

	const issues = checkDependencies(
		parse(source, "component.nz.liquid"),
		readFile,
	);

	assert.equal(
		issues.filter((issue) => issue.code === "IMPORT_CYCLE").length,
		2,
	);
});

test("dependency checking reuses parsed transitive imports", async () => {
	const { checkDependencies, projectTreeSitterNazareAst: project } =
		await import("../dist/index.js");
	const parse = (source, file) => project(source, file).ast;
	const source = `{% import A from "./a.nz.liquid" %}\n{% import B from "./b.nz.liquid" %}`;
	const files = {
		"a.nz.liquid": `{% import C from "./c.nz.liquid" %}\n{% render C {} %}`,
		"b.nz.liquid": `{% import C from "./c.nz.liquid" %}\n{% render C {} %}`,
		"c.nz.liquid": `<span>C</span>`,
	};
	const reads = new Map();
	const readFile = (path) => {
		reads.set(path, (reads.get(path) ?? 0) + 1);
		return files[path];
	};

	const issues = checkDependencies(
		parse(source, "component.nz.liquid"),
		readFile,
	);

	assert.deepEqual(
		issues.filter((issue) => issue.severity === "error"),
		[],
	);
	assert.equal(reads.get("a.nz.liquid"), 1);
	assert.equal(reads.get("b.nz.liquid"), 1);
	assert.equal(reads.get("c.nz.liquid"), 1);
});

test("missing asset imports remain resolve diagnostics", () => {
	const compiled = compileNazareArtifact(
		`{% import behavior from "./missing.js" %}\n<div></div>`,
		"component.nz.liquid",
	);
	const issue = compiled.issues.find(
		(candidate) => candidate.code === "IMPORT_NOT_FOUND",
	);

	assert.equal(issue?.phase, "resolve");
});

test("resolveAssetImports returns a resolved AST without mutating parse output", () => {
	const source = `{% import behavior from "./behavior.js" %}\n<div></div>`;
	const ast = projectTreeSitterNazareAst(source, "component.nz.liquid").ast;
	const resolved = resolveAssetImports(
		ast,
		() => `export default island(() => {});`,
	);

	assert.equal(ast.nodes[0].type, "NazareAssetImport");
	assert.equal(resolved.ast.nodes[0].type, "NazareScript");
	assert.equal(resolved.issues.length, 0);
});

test("malformed imported JavaScript produces a resolve diagnostic", () => {
	const source = `{% import behavior from "./behavior.js" %}\n<div></div>`;
	const ast = projectTreeSitterNazareAst(source, "component.nz.liquid").ast;
	const resolved = resolveAssetImports(ast, () => "export default ;");

	assert.equal(resolved.issues.length, 1);
	assert.equal(resolved.issues[0].code, "SCRIPT_JAVASCRIPT_PARSE_ERROR");
	assert.equal(resolved.issues[0].phase, "resolve");
});

test("importSpecifiers rejects malformed JavaScript", () => {
	assert.throws(
		() => importSpecifiers("import {"),
		/Cannot read JavaScript imports/,
	);
});
