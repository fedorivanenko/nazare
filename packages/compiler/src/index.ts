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
import { type CompilerMode, checkArtifactIR } from "./check.js";
import { checkVanillaSchema } from "./check-vanilla.js";
import { type EmitResult, type EmitThemeOptions, emitTheme } from "./emit.js";
import { artifactGraphFromIR } from "./graph.js";
import { parseNazareLiquid } from "./parser.js";
import {
	type ReadFile,
	checkDependencies,
	resolveAssetImports,
	resolveComponentContracts,
} from "./resolver.js";
import { bindArtifactIR, contractFromIR } from "./symbols.js";
import { syntaxFromAst } from "./syntax.js";
import { validateArtifactGraph, validateArtifactIR } from "./validate.js";

export type {
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
export { artifactGraphFromIR } from "./graph.js";
export { componentSymbolIdForFile } from "./ids.js";
export { parseNazareLiquid } from "./parser.js";
export {
	type ReadFile,
	checkDependencies,
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
	/** This artifact's own contract, keyed by its file path. */
	contract: ArtifactContract;
	/** Contracts of the imported component files (needed for hoisting at emit time). */
	contracts: ArtifactContract[];
};

export type BuildNazareThemeOptions = CompileNazareArtifactOptions &
	EmitThemeOptions;

export type BuildResult = CompileResult & {
	/** Theme files emitted from the compiled artifact. */
	emitted: EmitResult;
	/** Compile and emit diagnostics, in order. */
	issues: Diagnostic[];
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

	const syntax = syntaxFromAst(ast);
	const ir = bindArtifactIR(syntax, { contracts });
	const graph = artifactGraphFromIR(ir);
	const issues = [
		...contractResolution.issues,
		...ast.diagnostics,
		...checkVanillaSchema(ast),
		...checkArtifactIR(ir, contracts, { mode: options.strictness }),
		...validateArtifactIR(ir),
		...validateArtifactGraph(graph),
	];
	const contract = contractFromIR(ir, file, contracts);

	return {
		ast,
		syntax,
		ir,
		graph,
		issues,
		notes: ast.notes,
		contract,
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
	const emitted = emitTheme(source, compiled, options);
	return {
		...compiled,
		emitted,
		issues: [...compiled.issues, ...dependencyIssues, ...emitted.issues],
	};
}
