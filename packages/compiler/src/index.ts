/**
 * Public API of the Nazare compiler.
 *
 * Explicit flow:
 * frontend → semantic facts → graph/check/validate. Workspace build is separate;
 * Build products analyze reachable files, emit output plans, and aggregate diagnostics.
 */
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
	artifactGraphFromAst,
	buildPlainLiquid,
	type CompileArtifactFailure,
	type CompileArtifactOptions,
	type CompileArtifactResult,
	type CompileArtifactSuccess,
	type CompileNazareArtifactOptions,
	type CompileResult,
	compileArtifact,
	compileNazareArtifact,
	compilePlainLiquid,
} from "./compile/index.js";
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
export {
	FileSystemAtomicOutputStore,
	readExistingOutputState,
} from "./file-system-output-store.js";
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
export {
	type AtomicOutputCommit,
	type AtomicOutputStore,
	createOwnedOutputPlan,
	createProtectedOwnedOutputPlan,
	type ExistingOutputState,
	executeOutputTransaction,
	hashOutput,
	ObsoleteOutputRevisionError,
	OUTPUT_OWNERSHIP_MANIFEST_PATH,
	type OutputOwnershipManifest,
	OutputPlanValidationError,
	type OutputTransactionResult,
	type OwnedOutputFile,
	type OwnedOutputPlan,
} from "./output-transaction.js";
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
	createProjectMetadataInputProvider,
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
	PROJECT_METADATA_KEYS,
	type ProjectChangeBatch,
	type ProjectFile,
	type ProjectFileFingerprint,
	type ProjectFileId,
	type ProjectHost,
	type ProjectMetadataInputProvider,
	type ProjectMetadataInputs,
	type ProjectMetadataKey,
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
	strongerThemeEvidence,
	type ThemeEvidenceStrength,
} from "./theme-evidence-strength.js";
export type {
	AnalyzeNazareThemeOptions,
	BuildNazareThemeWorkspaceOptions,
	BuildThemeScope,
	InspectNazareThemeOptions,
	ThemeAnalysis,
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
	ThemeInputFile,
	ThemeJavaScriptOwner,
	ThemeLocaleKeyRecord,
	ThemeLocaleReferenceRecord,
	ThemeLocaleTranslationRecord,
	ThemeMetafieldDefinitionRecord,
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
// A single plain-Liquid file's facts, without standing up a theme session:
// `{% doc %}` @param declarations are the author's own statement of a
// component's interface, and tooling outside the graph (the preview's controls)
// needs them for one file at a time.
export { collectPlainLiquidThemeFacts } from "./theme-liquid-facts.js";
export type {
	ThemeSourceAnalysis,
	ThemeSourceCompleteness,
	ThemeSourceFrontend,
	ThemeSourceFrontendContext,
	ThemeSourceInput,
	ThemeSourceUncertainty,
} from "./theme-source-frontend.js";
export {
	projectTreeSitterNazareAst,
	type TreeSitterNazareProjection,
} from "./tree-sitter-nazare-projector.js";
export {
	validateArtifactGraph,
	validateArtifactIR,
	validateNazareAst,
} from "./validate.js";
