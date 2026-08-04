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
	type ReachableSourceClosure,
	type SourceAnalysisPlan,
	type SourceDependencyEdge,
	sourceProducts,
} from "./products.js";
