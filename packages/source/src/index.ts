export {
	type LiquidDependencyKind,
	type LiquidSyntaxDependency,
	type LiquidSyntaxFacts,
	type LiquidSyntaxSchema,
	type LiquidSyntaxSettingsRead,
	liquidSyntaxFacts,
} from "./adapters/liquid.js";
export {
	parseSourceDocument,
	SourceFile,
	sourceRangeFromTreeRange,
} from "./document.js";
export { SourceAnalysisHost } from "./host.js";
export { SourceOffsetIndex } from "./offset-index.js";
export {
	createDefaultSourceParserRegistry,
	MissingSourceGrammarError,
	SourceParserRegistry,
	UnsupportedSourceLanguageError,
} from "./registry.js";
export type {
	EmbeddedRegion,
	SourceDocument,
	SourceEdit,
	SourceLanguage,
	SourceParseIssue,
	SourcePosition,
	SourceRange,
	SourceUpdate,
} from "./types.js";
