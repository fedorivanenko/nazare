export {
	type LiquidDependencyKind,
	type LiquidSyntaxBlock,
	type LiquidSyntaxConditional,
	type LiquidSyntaxDependency,
	type LiquidSyntaxDocParam,
	type LiquidSyntaxFacts,
	type LiquidSyntaxGuard,
	type LiquidSyntaxLocalBinding,
	type LiquidSyntaxLookup,
	type LiquidSyntaxRead,
	type LiquidSyntaxRenderArgument,
	type LiquidSyntaxSchema,
	type LiquidSyntaxSettingsRead,
	type LiquidSyntaxStringReference,
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
