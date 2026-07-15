/**
 * Public API of the Nazare compiler.
 *
 * Explicit flow:
 * parse → resolve component contracts → resolve asset imports → syntax → bind
 * → graph → check → validate. Emit is separate; buildNazareTheme runs compile
 * plus emit and aggregates all issues.
 */
import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	ArtifactSyntaxNode,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import type { CompilerMode } from "./check.js";
import { type EmitResult, type EmitThemeOptions, emitTheme } from "./emit.js";
import { artifactGraphFromIR } from "./graph.js";
import { parseNazareLiquid } from "./parser.js";
import { markDiagnostics, projectArtifact } from "./pipeline.js";
import {
	checkDependencies,
	type ReadFile,
	resolveAssetImports,
	resolveComponentContracts,
} from "./resolver.js";
import { bindArtifactIR } from "./symbols.js";
import { syntaxFromAst } from "./syntax.js";

// Fact types re-exported for extension authors (a single @nazare/compiler
// entrypoint). These are the shapes on NazareComponent and mergeArtifactIR.
export type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	ArtifactResolution,
	ArtifactSymbol,
	ArtifactSyntaxNode,
} from "@nazare/core";
export type {
	AuthoredSchema,
	NazareAst,
	NazareImportNode,
	NazareNode,
	NazareOpaqueNode,
	NazarePassedProp,
	NazarePropDeclaration,
	NazarePropsNode,
	NazareRenderNode,
	NazareRootMarkerNode,
	ParseDiagnostic,
} from "./ast.js";
export {
	CHECK_RULES,
	type CheckArtifactIROptions,
	type CheckRule,
	type CompilerMode,
	checkArtifactIR,
	checkComponentAuthoringConstraints,
	checkContractConstraints,
	checkScriptConstraints,
	checkStyleConstraints,
} from "./check.js";
export { checkComponentScripts } from "./check-script.js";
export {
	type CompiledComponent,
	checkEmitPreconditions,
	type EmitResult,
	type EmitThemeOptions,
	type EmittedFile,
	emitCssFiles,
	emitLiquidFile,
	emitScriptFiles,
	emitTheme,
} from "./emit.js";
export type {
	NazareComponent,
	NazareExtension,
	NazareExtensionContext,
	NazareExtensionRegistration,
} from "./extensions.js";
export { artifactGraphFromIR } from "./graph.js";
export { componentSymbolIdForFile } from "./ids.js";
export { mergeArtifactIR } from "./merge.js";
export { parseNazareLiquid } from "./parser.js";
export {
	checkDependencies,
	type ReadFile,
	resolveAssetImports,
	resolveComponentContracts,
} from "./resolver.js";
export {
	type ThemeSchemaFromIROptions,
	themeSchemaFromIR,
} from "./schema.js";
export {
	bindArtifactIR,
	componentKindFromIR,
	contractFromIR,
} from "./symbols.js";
export { syntaxFromAst } from "./syntax.js";
export { validateArtifactGraph, validateArtifactIR } from "./validate.js";

export type CompileNazareArtifactOptions = {
	/** Without a reader, every import diagnoses as unreadable. */
	readFile?: ReadFile;
	/** strict is current package-author behavior; loose keeps migration checks minimal. */
	strictness?: CompilerMode;
};

export type CompileResult = {
	/** Nazare nodes plus the full LiquidHTML AST (unsupported syntax preserved). */
	ast: NazareAst;
	/** Flat syntax nodes, symbols, and resolutions — facts only, no judgments. */
	syntax: ArtifactSyntaxNode[];
	/** Flat syntax nodes, symbols, and resolutions — facts only, no judgments. */
	ir: ArtifactIR;
	/** IR projected into nodes and typed edges for queries and visualization. */
	graph: ArtifactGraph;
	/** All diagnostics from every compile pass; emit diagnostics are separate. */
	issues: Diagnostic[];
	/**
	 * Informational notices about unmodeled Liquid (control flow, HTML) — a
	 * separate channel from issues, not mode-dependent. Consumers surface them
	 * if they want; they never affect whether a compile fails.
	 */
	notes: Diagnostic[];
	/** True when no error-severity compile diagnostics were produced. */
	canEmit: boolean;
	/** This artifact's own contract, keyed by its file path. */
	contract: ArtifactContract;
	/** Contracts of the imported component files (needed for hoisting at emit time). */
	contracts: ArtifactContract[];
};

export type BuildNazareThemeOptions = CompileNazareArtifactOptions &
	EmitThemeOptions & {
		/** Defaults to true for tooling previews; set false to skip emit when compile/dependency errors exist. */
		emitOnError?: boolean;
	};

export type BuildResult = CompileResult & {
	/** Theme files emitted from the compiled artifact. */
	emitted: EmitResult;
	/** Compile and emit diagnostics, in order. */
	issues: Diagnostic[];
	/** True when emit ran despite compile/dependency errors. */
	emittedOnError: boolean;
};

/** Shortcut to a graph when diagnostics and contracts are not needed. */
export function artifactGraphFromAst(ast: NazareAst): ArtifactGraph {
	return artifactGraphFromIR(bindArtifactIR(syntaxFromAst(ast)));
}

/** Compiles one artifact, deriving imported components' contracts via readFile. */
export function compileNazareArtifact(
	source: string,
	file: string,
	options: CompileNazareArtifactOptions = {},
): CompileResult {
	const parsedAst = parseNazareLiquid(source, file);
	const contractResolution = resolveComponentContracts(
		parsedAst,
		options.readFile,
	);
	const assetResolution = resolveAssetImports(parsedAst, options.readFile);
	const ast = assetResolution.ast;
	const contracts = contractResolution.contracts;

	const projected = projectArtifact(ast, {
		contracts,
		mode: options.strictness,
		resolveIssues: contractResolution.issues,
	});

	return {
		ast,
		syntax: projected.syntax,
		ir: projected.ir,
		graph: projected.graph,
		issues: projected.issues,
		notes: markDiagnostics(ast.notes, "parse"),
		canEmit: !hasErrors(projected.issues),
		contract: projected.contract,
		contracts,
	};
}

/**
 * Compiles and emits theme files with one aggregated diagnostic list. A build
 * validates its dependencies, so it checks every imported file explicitly —
 * the one difference from a plain compile.
 */
export function buildNazareTheme(
	source: string,
	file: string,
	options: BuildNazareThemeOptions,
): BuildResult {
	const compiled = compileNazareArtifact(source, file, options);
	const dependencyIssues = checkDependencies(compiled.ast, options.readFile, {
		mode: options.strictness,
	});
	const preEmitIssues = [...compiled.issues, ...dependencyIssues];
	const shouldEmit = (options.emitOnError ?? true) || !hasErrors(preEmitIssues);
	const emitted = shouldEmit
		? emitTheme(source, compiled, options)
		: { files: [], issues: [] };
	const issues = [...preEmitIssues, ...markDiagnostics(emitted.issues, "emit")];
	return {
		...compiled,
		canEmit: !hasErrors(preEmitIssues),
		emitted,
		emittedOnError: shouldEmit && hasErrors(preEmitIssues),
		issues,
	};
}

function hasErrors(issues: Diagnostic[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}
