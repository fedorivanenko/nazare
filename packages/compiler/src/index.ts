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
import { DEFAULT_COMPILER_MODE } from "./check.js";
import type {
	CompileInput,
	CompilerFrontend,
	ContractProvenance,
	FrontendResult,
	FrontendSupport,
} from "./frontend.js";
import type { PlainLiquidFrontendMetadata } from "./frontends/plain-liquid.js";
import { treeSitterNazareLiquidFrontend } from "./frontends/tree-sitter-nazare-liquid.js";
import { treeSitterPlainLiquidFrontend } from "./frontends/tree-sitter-plain-liquid.js";
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
	DEFAULT_COMPILER_MODE,
} from "./check.js";
export {
	type CachedComputation,
	type CachedComputationDependency,
	type Capability,
	type CapabilityProvider,
	type CapabilityRegistry,
	type Computation,
	type ComputationCache,
	type ComputationCodec,
	type ComputationContext,
	ComputationCycleError,
	type ComputationGraph,
	type ComputationGraphOptions,
	type ComputationGraphUpdate,
	type ComputationMetadata,
	type ComputationPriority,
	type ComputationRegistrar,
	type ComputationRequestOptions,
	type ComputationUncertainty,
	canonicalProductKey,
	createCapabilityRegistry,
	createComputationGraph,
	createFileSystemComputationCache,
	createMemoryComputationCache,
	defineCapability,
	defineCapabilityProvider,
	defineComputation,
	defineComputationRegistrar,
	definePipeline,
	defineProduct,
	fingerprintProductKey,
	jsonComputationCodec,
	type NazarePipeline,
	ObsoleteComputationRevisionError,
	type Product,
	type ProductDefinition,
	type ProductIdentity,
	type ProductKey,
	pipelineIdentity,
	productKeyCodec,
	registerPipelineComputations,
	registrarIdentity,
} from "./computation/index.js";
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
export {
	DEFAULT_PLAIN_LIQUID_PARSE_MODE,
	PLAIN_LIQUID_SUPPORT,
	type PlainLiquidFrontendMetadata,
	resolvePlainLiquidOptions,
} from "./frontends/plain-liquid.js";
export { treeSitterNazareLiquidFrontend } from "./frontends/tree-sitter-nazare-liquid.js";
export { treeSitterPlainLiquidFrontend } from "./frontends/tree-sitter-plain-liquid.js";
export { artifactGraphFromIR } from "./graph.js";
export { componentSymbolIdForFile } from "./ids.js";
export { mergeArtifactIR } from "./merge.js";
export { baseNameOf, resolveImportPath } from "./paths.js";
export type {
	BuildPlainLiquidOptions,
	BuildPlainLiquidResult,
	CompilePlainLiquidResult,
	PlainLiquidAst,
	PlainLiquidDependency,
	PlainLiquidDependencyKind,
	PlainLiquidOptions,
	PlainLiquidParseMode,
} from "./plain-liquid.js";
export {
	definePortableOutputProvider,
	type PortableApplicationModel,
	type PortableApplicationPlan,
	type PortableAsset,
	type PortableComponent,
	type PortableContract,
	type PortableDataRequirement,
	type PortableOutput,
	type PortableRenderEdge,
	type PortableRenderTree,
	type PortableRoute,
	portableApplicationModel,
	portableOutputCapability,
} from "./portable-application.js";
export {
	coalesceInputChanges,
	compareProjectFileIds,
	createFileSystemInputProvider,
	createFileSystemProjectHost,
	createProjectSession,
	defineInputProvider,
	defineProjectHost,
	diffProjectFileSnapshots,
	discoverProjectFiles,
	type ExternalProjectInputId,
	type ExternalProjectInputProvider,
	type ExternalProjectInputSnapshot,
	externalProjectInput,
	type InputChange,
	type InputProvider,
	type InputSnapshot,
	mergeAsyncIterables,
	normalizeProjectPath,
	type ProjectChangeBatch,
	type ProjectFile,
	type ProjectFileFingerprint,
	type ProjectFileId,
	type ProjectHost,
	type ProjectSession,
	type ProjectSessionUpdate,
	ProjectSessionValidationError,
	type ProjectSessionValidator,
	type ProjectSnapshot,
	projectFileId,
	projectFileRevisionInput,
	sameProjectFileId,
	serializeProjectFileId,
} from "./project/index.js";
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
	assetSourceFrontend,
	type ClassifiedSourceFile,
	createDefaultSourceFrontendRegistry,
	createSourceFrontendRegistry,
	createSourceProductRegistrar,
	cssSourceFrontend,
	DEFAULT_SOURCE_FRONTENDS,
	defineSourceFrontend,
	javaScriptSourceFrontend,
	jsonSourceFrontend,
	type LanguageId,
	liquidSourceFrontend,
	nazareLiquidSourceFrontend,
	opaqueSourceFrontend,
	type ParsedSourceFile,
	type ParsedSourceSyntax,
	type ReachableSourceClosure,
	type SourceAnalysisPlan,
	type SourceDependencyEdge,
	type SourceFact,
	type SourceFacts,
	type SourceFrontend,
	type SourceFrontendContext,
	type SourceFrontendRegistry,
	sourceProducts,
} from "./source-products/index.js";
export {
	bindArtifactIR,
	componentKindFromIR,
	contractFromIR,
} from "./symbols.js";
export { syntaxFromAst } from "./syntax.js";
export {
	type PersistedThemeInspection,
	parsePersistedThemeInspection,
	serializePersistedThemeInspection,
} from "./theme-analysis-cache.js";
export {
	type ThemeBehaviorConnection,
	type ThemeBehaviorConnectionsResult,
	ThemeBehaviorIndex,
	type ThemeBehaviorQuery,
	type ThemeBehaviorQueryResult,
	type ThemeBehaviorQueryRole,
	type ThemeBehaviorUncertainSource,
} from "./theme-behavior-index.js";
export {
	ThemeBuildSession,
	type ThemeBuildUpdate,
} from "./theme-build-session.js";
export {
	createThemeCapabilityPass,
	deriveThemeCapabilities,
	type ThemeCapabilityPassContext,
} from "./theme-capability-pass.js";
export {
	capabilitySignalId,
	collectThemeCapabilitySignals,
	createThemeCapabilitySignalPass,
	type ThemeCapabilitySignalPassContext,
} from "./theme-capability-signal-pass.js";
export {
	parseThemeCheckPolicy,
	type ThemeCheckPolicy,
	type ThemeCheckPolicyInput,
} from "./theme-check-policy.js";
export {
	createThemeClassificationPass,
	deriveThemeClassifications,
	type ThemeClassificationPassContext,
} from "./theme-classification-pass.js";
export {
	THEME_METAFIELD_IMPACT_SCOPE,
	ThemeComputation,
	type ThemeFileImpact,
	type ThemeMetafieldImpact,
	type ThemeMetafieldImpactScope,
	type ThemeRenderOccurrence,
} from "./theme-computation.js";
export { ThemeRenderDependencyIndex } from "./theme-data-flow-index.js";
export {
	collectThemeDataFlowInputs,
	createThemeDataFlowFixedPointPass,
	createThemeDataFlowInputPass,
	dataFlowGroupKey,
	dataFlowWorkKey,
	deriveRenderArgumentDataAccesses,
	deriveThemeRenderSites,
	type ThemeDataFlowDerivedRecord,
	type ThemeDataFlowFixedPointContext,
	type ThemeDataFlowGroupDelta,
	type ThemeDataFlowGroupKey,
	type ThemeDataFlowIds,
	type ThemeDataFlowInputPassContext,
	type ThemeDataFlowInputPassResult,
	type ThemeDataFlowInputRecord,
	type ThemeDataFlowWorkKey,
} from "./theme-data-flow-pass.js";
export {
	collectThemeDeclarations,
	createThemeDeclarationPass,
	type ThemeDeclarationPassContext,
	type ThemeDeclarationPassRecord,
	type ThemeDeclarationPassResult,
} from "./theme-declaration-pass.js";
export {
	type OwnedThemeDiagnostic,
	type ThemeDiagnosticOwner,
	ThemeDiagnosticStore,
} from "./theme-diagnostic-store.js";
export {
	createThemeEvidencePass,
	deriveThemeEvidence,
	deriveThemeEvidenceRecords,
	type ThemeEvidenceInputs,
	type ThemeEvidencePassContext,
} from "./theme-evidence-pass.js";
export {
	strongerThemeEvidence,
	type ThemeEvidenceStrength,
} from "./theme-evidence-strength.js";
export { matchesThemeGlob } from "./theme-exclusions.js";
export {
	deriveThemeExpectedInputs,
	docParamEvidenceId,
	expectedInputId,
	themeDocContractIssues,
} from "./theme-expected-input-pass.js";
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
	ThemeBehaviorFact,
	ThemeBehaviorRecord,
	ThemeBlockInstanceRecord,
	ThemeBlockRecord,
	ThemeBlockSettingRecord,
	ThemeBuildResult,
	ThemeCapabilityRecord,
	ThemeCapabilitySignalRecord,
	ThemeClassificationRecord,
	ThemeDataAccessRecord,
	ThemeDomHookKind,
	ThemeEvidenceRecord,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeGraphView,
	ThemeGraphViews,
	ThemeImpactSummary,
	ThemeInputFile,
	ThemeJavaScriptOwner,
	ThemeLocaleKeyRecord,
	ThemeLocaleReferenceRecord,
	ThemeLocaleTranslationRecord,
	ThemeMetafieldDefinitionRecord,
	ThemeMetafieldQueries,
	ThemeMetafieldReadRecord,
	ThemeNetworkAccessRecord,
	ThemeNetworkMetafieldReference,
	ThemePageRecord,
	ThemeRenderArgumentRecord,
	ThemeRenderSiteRecord,
	ThemeSectionInstanceRecord,
	ThemeSemanticModel,
	ThemeSettingReadRecord,
	ThemeSourceAnalysisRecord,
	ThemeSourceLanguage,
} from "./theme-facts.js";
export { shareThemeGraphRecords } from "./theme-graph-output.js";
export {
	THEME_GRAPH_METAFIELD_SCHEMA_OWNER,
	ThemeGraphStore,
	type ThemeGraphStoreDelta,
} from "./theme-graph-store.js";
export {
	ThemeImpactIndex,
	type ThemeImpactIndexDelta,
} from "./theme-impact-index.js";
export {
	collectThemeInstances,
	createThemeInstancePass,
	type ThemeInstanceIds,
	type ThemeInstancePassContext,
	type ThemeInstancePassResult,
	type ThemeInstanceRecord,
} from "./theme-instance-pass.js";
// A single plain-Liquid file's facts, without standing up a theme session:
// `{% doc %}` @param declarations are the author's own statement of a
// component's interface, and tooling outside the graph (the preview's controls)
// needs them for one file at a time.
export { collectPlainLiquidThemeFacts } from "./theme-liquid-facts.js";
export {
	collectThemeLocales,
	createThemeLocalePass,
	type ThemeLocaleIds,
	type ThemeLocalePassContext,
	type ThemeLocalePassResult,
	type ThemeLocaleRecord,
} from "./theme-locale-pass.js";
export {
	type ThemeMetafieldIdentity,
	ThemeMetafieldIndex,
	type ThemeMetafieldQueryResult,
} from "./theme-metafield-index.js";
export {
	createThemeMetafieldPass,
	type ThemeMetafieldPassContext,
	type ThemeMetafieldRecord,
} from "./theme-metafield-pass.js";
export {
	analyzeMetafields,
	collectMetafieldDefinitions,
	collectMetafieldReads,
	joinMetafieldReads,
	metafieldDefinitionId,
	metafieldJoinKey,
	type ThemeMetafieldAnalysis,
	type ThemeMetafieldDefinitionCollection,
	type ThemeMetafieldSnapshot,
} from "./theme-metafields.js";
export {
	type FixedPointPass,
	type FixedPointStep,
	fixedPointThemePass,
	type IncrementalPass,
	incrementalThemePass,
	type PassChange,
	type PassChangeKind,
	type PassDelta,
	type PassRoute,
	THEME_PASS_CONVERGENCE_BUDGET,
	THEME_PASS_ORDER,
	type ThemePassConvergenceBudget,
	type ThemePassConvergenceDiagnostic,
	ThemePassConvergenceError,
	ThemePassScheduler,
	type ThemePassStage,
	type ThemePassTrace,
	type ThemeSchedulerResult,
} from "./theme-pass-scheduler.js";
export {
	getThemeAffectedPages,
	getThemeDependencies,
	getThemeDependents,
	getThemeEdgesFrom,
	getThemeEdgesTo,
	getThemeFileImpact,
	getThemeFileImpacts,
	getThemeNode,
	summarizeThemeGraph,
	type ThemeGraphSummary,
	themeGraphToDot,
} from "./theme-queries.js";
export {
	collectThemeReferences,
	createThemeReferencePass,
	materializeShopifyDefaultLayoutReferences,
	referenceTargetKeys,
	type ThemeReferencePassContext,
} from "./theme-reference-pass.js";
export {
	createThemeResolutionPass,
	resolveThemeDeclarationsAndReferences,
	type ThemeIncrementalResolutionContext,
	type ThemeResolutionPassResult,
} from "./theme-resolution-pass.js";
export { ThemeResolverIndex } from "./theme-resolver-index.js";
export {
	type ThemeRecordResolution,
	ThemeSchemaIndex,
	type ThemeSchemaIndexInput,
} from "./theme-schema-index.js";
export {
	collectThemeSchemaSettings,
	createThemeSchemaSettingPass,
	type ThemeSchemaSettingIds,
	type ThemeSchemaSettingPassContext,
	type ThemeSchemaSettingPassResult,
	type ThemeSchemaSettingRecord,
} from "./theme-schema-setting-pass.js";
export {
	ThemeSemanticStore,
	ThemeSemanticTransaction,
} from "./theme-semantic-store.js";
export {
	THEME_PROGRAM_DEFAULTS,
	type ThemeGraphUpdate,
	ThemeProgram,
	type ThemeProgramOptions,
	type ThemeUpdateTelemetry,
	ThemeWorkspaceSession,
} from "./theme-session.js";
export type {
	ThemeSourceAnalysis,
	ThemeSourceCompleteness,
	ThemeSourceFrontend,
	ThemeSourceFrontendContext,
	ThemeSourceInput,
	ThemeSourceUncertainty,
} from "./theme-source-frontend.js";
export {
	analyzeThemeSource,
	assetThemeSourceFrontend,
	cssThemeSourceFrontend,
	DEFAULT_THEME_SOURCE_FRONTENDS,
	javaScriptThemeSourceFrontend,
	jsonThemeSourceFrontend,
	nazareLiquidThemeSourceFrontend,
	opaqueThemeSourceFrontend,
	plainLiquidThemeSourceFrontend,
} from "./theme-source-frontends.js";
export {
	analyzeNazareTheme,
	buildNazareThemeWorkspace,
	computeNazareTheme,
	inspectNazareTheme,
	THEME_ANALYSIS_DEFAULTS,
	THEME_BUILD_DEFAULTS,
} from "./theme-workspace.js";
export {
	projectTreeSitterNazareAst,
	type TreeSitterNazareProjection,
} from "./tree-sitter-nazare-projector.js";
export {
	validateArtifactGraph,
	validateArtifactIR,
	validateNazareAst,
} from "./validate.js";

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
	const strictness = options.strictness ?? DEFAULT_COMPILER_MODE;
	const normalizedOptions = { ...options, strictness };

	const frontendResult = frontend.compile(normalizedOptions);
	switch (frontendResult.kind) {
		case "nazare-ast": {
			const projected = projectArtifact(frontendResult.ast, {
				contracts: frontendResult.contracts,
				mode: strictness,
				resolveIssues: frontendResult.resolveIssues,
			});
			return compileSuccess(frontend.name, frontendResult, projected);
		}
		case "direct-ir": {
			const projected = projectIR(frontendResult.syntax, frontendResult.ir, {
				contracts: frontendResult.contracts,
				mode: strictness,
				contractPath: frontendResult.contractPath,
				issues: frontendResult.issues,
			});
			return compileSuccess(frontend.name, frontendResult, projected);
		}
		case "failure":
			return {
				ok: false,
				frontend: frontend.name,
				issues: frontendResult.issues,
				notes: frontendResult.notes,
				canEmit: false,
			};
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
	const compiled = compilePlainLiquid(source, file, {
		parseMode: options.parseMode,
	});
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
		(ast.parseMode === "strict" || ast.parseMode === "liquid-only")
	);
}

function compileSuccess(
	frontend: string,
	frontendResult: Exclude<FrontendResult, { kind: "failure" }>,
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
	if (treeSitterNazareLiquidFrontend.accepts(options.file, options.source)) {
		return treeSitterNazareLiquidFrontend;
	}
	if (treeSitterPlainLiquidFrontend.accepts(options.file, options.source)) {
		return treeSitterPlainLiquidFrontend;
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
