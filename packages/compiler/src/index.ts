/**
 * Public API of the Nazare compiler.
 *
 * Explicit flow:
 * frontend → semantic facts → graph/check/validate. Workspace build is separate;
 * buildNazareThemeWorkspace analyzes theme files, selects a scope, emits, and aggregates issues.
 */
import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	ArtifactSyntaxNode,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import type {
	CompileInput,
	CompilerFrontend,
	ContractProvenance,
	FrontendResult,
	FrontendSupport,
} from "./frontend.js";
import { nazareLiquidFrontend } from "./frontends/nazare-liquid.js";
import {
	type PlainLiquidFrontendMetadata,
	plainLiquidFrontend,
} from "./frontends/plain-liquid.js";
import { artifactGraphFromIR } from "./graph.js";
import {
	type ProjectedArtifact,
	projectArtifact,
	projectIR,
} from "./pipeline.js";
import type {
	BuildPlainLiquidOptions,
	BuildPlainLiquidResult,
	CompilePlainLiquidResult,
	PlainLiquidAst,
} from "./plain-liquid.js";
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
	NazarePassedProp,
	NazarePropDeclaration,
	NazarePropsNode,
	NazareRenderNode,
	NazareRootMarkerNode,
	ParseDiagnostic,
} from "./ast.js";
export { importSpecifiers } from "./bundle.js";
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
export type {
	CompileInput,
	CompilerFrontend,
	ContractProvenance,
	FrontendResult,
	FrontendSupport,
} from "./frontend.js";
export { nazareLiquidFrontend } from "./frontends/nazare-liquid.js";
export {
	PLAIN_LIQUID_SUPPORT,
	type PlainLiquidFrontendMetadata,
	plainLiquidFrontend,
} from "./frontends/plain-liquid.js";
export { artifactGraphFromIR } from "./graph.js";
export { componentSymbolIdForFile } from "./ids.js";
export { mergeArtifactIR } from "./merge.js";
export { parseNazareLiquid } from "./parser.js";
export { baseNameOf, resolveImportPath } from "./paths.js";
export {
	type BuildPlainLiquidOptions,
	type BuildPlainLiquidResult,
	type CompilePlainLiquidResult,
	type PlainLiquidAst,
	type PlainLiquidDependency,
	type PlainLiquidDependencyKind,
	type PlainLiquidOptions,
	type PlainLiquidParseMode,
	parsePlainLiquid,
} from "./plain-liquid.js";
export {
	checkDependencies,
	createDependencyResolver,
	type DependencyResolver,
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
export {
	ThemeBuildSession,
	type ThemeBuildUpdate,
} from "./theme-build-session.js";
export {
	filterThemeCheckIssues,
	parseThemeCheckPolicy,
	type ThemeCheckPolicy,
	type ThemeCheckPolicyInput,
} from "./theme-check-policy.js";
export { matchesThemeGlob } from "./theme-exclusions.js";
export { ThemeFactIndex } from "./theme-fact-index.js";
export {
	ThemeFactStore,
	themeFactSourcePath,
} from "./theme-fact-store.js";
export type {
	AnalyzeNazareThemeOptions,
	BuildNazareThemeWorkspaceOptions,
	BuildThemeScope,
	InspectNazareThemeOptions,
	InspectNazareThemeResult,
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
	ThemeAnalysis,
	ThemeAnalysisCache,
	ThemeAnalysisCacheEntry,
	ThemeBlockInstanceRecord,
	ThemeBlockRecord,
	ThemeBlockSettingRecord,
	ThemeBuildResult,
	ThemeCapabilityRecord,
	ThemeCapabilitySignalRecord,
	ThemeClassificationRecord,
	ThemeDataAccessRecord,
	ThemeEvidenceRecord,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeGraphView,
	ThemeGraphViews,
	ThemeImpactSummary,
	ThemeInputFile,
	ThemeLocaleKeyRecord,
	ThemeLocaleReferenceRecord,
	ThemeLocaleTranslationRecord,
	ThemeMetafieldDefinitionRecord,
	ThemeMetafieldQueries,
	ThemeMetafieldReadRecord,
	ThemePageRecord,
	ThemeRenderArgumentRecord,
	ThemeRenderSiteRecord,
	ThemeSectionInstanceRecord,
	ThemeSemanticModel,
	ThemeSettingReadRecord,
} from "./theme-facts.js";
export { shareThemeGraphRecords } from "./theme-graph-output.js";
export {
	analyzeMetafields,
	metafieldDefinitionId,
	type ThemeMetafieldAnalysis,
	type ThemeMetafieldSnapshot,
} from "./theme-metafields.js";
export {
	getThemeAffectedPages,
	getThemeDependencies,
	getThemeDependents,
	getThemeEdgesFrom,
	getThemeEdgesTo,
	getThemeNode,
	summarizeThemeGraph,
	type ThemeGraphSummary,
	themeGraphToDot,
} from "./theme-queries.js";
export { ThemeResolverIndex } from "./theme-resolver-index.js";
export {
	ThemeSemanticStore,
	ThemeSemanticTransaction,
} from "./theme-semantic-store.js";
export {
	type ThemeGraphUpdate,
	ThemeWorkspaceSession,
} from "./theme-session.js";
export {
	analyzeNazareTheme,
	buildNazareThemeWorkspace,
	inspectNazareTheme,
	THEME_ANALYSIS_DEFAULTS,
	THEME_BUILD_DEFAULTS,
} from "./theme-workspace.js";
export { validateArtifactGraph, validateArtifactIR } from "./validate.js";

export type CompileNazareArtifactOptions = Pick<
	CompileInput,
	"readFile" | "strictness" | "dependencyResolver"
>;

export type CompileArtifactOptions = CompileInput & {
	/** Explicit frontend wins over registry selection. */
	frontend?: CompilerFrontend;
	/** Extra frontends checked before built-ins. */
	frontends?: CompilerFrontend[];
};

export type CompileArtifactSuccess = {
	ok: true;
	/** Frontend that translated source into compiler facts. */
	frontend: string;
	/** Frontend-owned AST, present for the built-in Nazare Liquid frontend. */
	ast?: NazareAst;
	/** Syntax facts produced by shared projection. */
	syntax: ArtifactSyntaxNode[];
	/** Bound symbols and resolutions produced by shared projection. */
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
	/** Source syntax features supported by selected frontend. */
	frontendSupport: FrontendSupport;
	/** Provenance of this artifact contract. */
	contractProvenance: ContractProvenance;
	/** Source text the current emitter should operate on. */
	sourceForEmit: string;
	/** Frontend-owned metadata for typed wrappers and tooling. */
	frontendMetadata?: unknown;
};

export type CompileArtifactFailure = {
	ok: false;
	frontend?: string;
	issues: Diagnostic[];
	notes: Diagnostic[];
	canEmit: false;
};

export type CompileArtifactResult =
	| CompileArtifactSuccess
	| CompileArtifactFailure;

export type CompileResult = CompileArtifactSuccess & {
	/** Nazare nodes plus the full LiquidHTML AST (unsupported syntax preserved). */
	ast: NazareAst;
};

/** Shortcut to a graph when diagnostics and contracts are not needed. */
export function artifactGraphFromAst(ast: NazareAst): ArtifactGraph {
	return artifactGraphFromIR(bindArtifactIR(syntaxFromAst(ast)));
}

export function compileArtifact(
	options: CompileArtifactOptions,
): CompileArtifactResult {
	const frontend = selectFrontend(options);
	if (!frontend) return unsupportedInput(options);

	const frontendResult = frontend.compile(options);
	switch (frontendResult.kind) {
		case "nazare-ast": {
			const projected = projectArtifact(frontendResult.ast, {
				contracts: frontendResult.contracts,
				mode: options.strictness,
				resolveIssues: frontendResult.resolveIssues,
			});
			return compileSuccess(frontend.name, frontendResult, projected);
		}
		case "direct-ir": {
			const projected = projectIR(frontendResult.syntax, frontendResult.ir, {
				contracts: frontendResult.contracts,
				mode: options.strictness,
				contractPath: frontendResult.contractPath,
				issues: frontendResult.issues,
			});
			return compileSuccess(frontend.name, frontendResult, projected);
		}
	}
}

/** Compiles one Nazare Liquid artifact, deriving imported components' contracts via readFile. */
export function compileNazareArtifact(
	source: string,
	file: string,
	options: CompileNazareArtifactOptions = {},
): CompileResult {
	const compiled = compileArtifact({
		source,
		file,
		...options,
		frontend: nazareLiquidFrontend,
	});
	if (!compiled.ok) {
		throw new Error(
			compiled.issues.map((issue) => issue.message).join("\n") ||
				"Nazare Liquid compile failed",
		);
	}
	if (!compiled.ast) {
		throw new Error("Nazare Liquid frontend did not return an AST");
	}
	return { ...compiled, ast: compiled.ast };
}

export function compilePlainLiquid(
	source: string,
	file: string,
	options: Pick<BuildPlainLiquidOptions, "parseMode"> = {},
): CompilePlainLiquidResult {
	const compiled = compileArtifact({
		source,
		file,
		frontend: plainLiquidFrontend,
		frontendOptions: options,
	});
	if (!compiled.ok) {
		throw new Error(
			compiled.issues[0]?.message ?? "Plain Liquid compile failed",
		);
	}
	const metadata = plainLiquidMetadata(compiled.frontendMetadata);
	return {
		ast: metadata.ast,
		issues: compiled.issues,
		dependencies: metadata.ast.dependencies,
		canEmit: compiled.canEmit,
	};
}

export function buildPlainLiquid(
	source: string,
	file: string,
	options: BuildPlainLiquidOptions = {},
): BuildPlainLiquidResult {
	const compiled = compilePlainLiquid(source, file, options);
	const emittedOnError = !compiled.canEmit && (options.emitOnError ?? false);
	const shouldEmit = compiled.canEmit || emittedOnError;
	return {
		...compiled,
		emitted: {
			files: shouldEmit ? [{ path: file, contents: source }] : [],
			issues: [],
		},
		issues: compiled.issues,
		emittedOnError,
	};
}

/**
 * The frontend is first-party and in-process; its metadata is typed with
 * `satisfies` at the construction site. This guards only the `unknown`
 * crossing of the frontend boundary — it identifies the shape, it does not
 * re-validate fields the type system already proved.
 */
function plainLiquidMetadata(metadata: unknown): PlainLiquidFrontendMetadata {
	const candidate = metadata as PlainLiquidFrontendMetadata | undefined;
	if (candidate && isPlainLiquidAst(candidate.ast)) return candidate;
	throw new Error("Plain Liquid frontend did not return its metadata shape");
}

function isPlainLiquidAst(value: unknown): value is PlainLiquidAst {
	const ast = value as PlainLiquidAst | undefined;
	return (
		!!ast &&
		typeof ast.file === "string" &&
		Array.isArray(ast.dependencies) &&
		(ast.parseMode === "strict" || ast.parseMode === "tolerant")
	);
}

function compileSuccess(
	frontend: string,
	frontendResult: FrontendResult,
	projected: ProjectedArtifact,
): CompileArtifactSuccess {
	return {
		ok: true,
		frontend,
		ast: frontendResult.kind === "nazare-ast" ? frontendResult.ast : undefined,
		syntax: projected.syntax,
		ir: projected.ir,
		graph: projected.graph,
		issues: projected.issues,
		notes: frontendResult.notes,
		canEmit: !hasErrors(projected.issues),
		contract: projected.contract,
		contracts: frontendResult.contracts,
		frontendSupport: frontendResult.frontendSupport,
		contractProvenance: frontendResult.contractProvenance,
		sourceForEmit: frontendResult.sourceForEmit,
		frontendMetadata: frontendResult.metadata,
	};
}

function selectFrontend(
	options: CompileArtifactOptions,
): CompilerFrontend | undefined {
	if (options.frontend) return options.frontend;
	for (const frontend of options.frontends ?? []) {
		if (frontend.accepts(options.file, options.source)) return frontend;
	}
	if (nazareLiquidFrontend.accepts(options.file, options.source)) {
		return nazareLiquidFrontend;
	}
	if (plainLiquidFrontend.accepts(options.file, options.source)) {
		return plainLiquidFrontend;
	}
	return undefined;
}

function unsupportedInput(
	options: CompileArtifactOptions,
): CompileArtifactFailure {
	return {
		ok: false,
		frontend: undefined,
		issues: [
			{
				severity: "error",
				code: "UNSUPPORTED_COMPILER_INPUT",
				message: `No compiler frontend accepts ${options.file}`,
				phase: "parse",
			},
		],
		notes: [],
		canEmit: false,
	};
}

function hasErrors(issues: Diagnostic[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}
