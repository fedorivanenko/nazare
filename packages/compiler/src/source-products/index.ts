export {
	assetSourceFrontend,
	createDefaultSourceFrontendRegistry,
	cssSourceFrontend,
	DEFAULT_SOURCE_FRONTENDS,
	javaScriptSourceFrontend,
	jsonSourceFrontend,
	liquidSourceFrontend,
	nazareLiquidSourceFrontend,
	opaqueSourceFrontend,
} from "./default-frontends.js";
export {
	type ClassifiedSourceFile,
	createSourceFrontendRegistry,
	defineSourceFrontend,
	type LanguageId,
	type ParsedSourceFile,
	type ParsedSourceSyntax,
	type SourceFact,
	type SourceFacts,
	type SourceFrontend,
	type SourceFrontendContext,
	type SourceFrontendRegistry,
} from "./frontend.js";
export {
	createSourceProductRegistrar,
	PROJECT_SOURCE_CATALOG_KEY,
	type ReachableSourceClosure,
	type SourceAnalysisPlan,
	type SourceDependencyEdge,
	sourceProducts,
} from "./products.js";
