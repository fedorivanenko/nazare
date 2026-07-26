/**
 * @nazare/scan — fast syntactic scanning.
 *
 * Fact extraction for tooling that must answer within a keystroke: bounded
 * linear scans, no dependencies, and no full HTML AST allocation. Measured
 * against @shopify/liquid-html-parser on five production
 * themes, the Liquid scanner is 100-400x faster with equal or better fidelity
 * (see notes/spike-liquid-scanner/findings.md).
 *
 * This is not a replacement for real analysis. The build path keeps the Shopify
 * parser for HTML validation, and type checking keeps the TypeScript compiler.
 * Scanning answers "what does this file mention"; those answer "is it correct".
 *
 * Implemented: Liquid.
 * Planned, in this order, each behind the same token-stream shape:
 *   - nazare  — `.nz.liquid` tags, layered over the Liquid tokens
 *   - script  — JS/TS module syntax, replacing a ts.createSourceFile walk
 *   - style   — CSS class tokens, replacing a postcss parse
 */

export {
	type LiquidDocument,
	type LiquidInvalidScan,
	type LiquidScan,
	type LiquidScanIssue,
	type LiquidToken,
	type LiquidValidScan,
	scanLiquid,
} from "./liquid.js";
export {
	type LiquidExpression,
	type LiquidExpressionIssue,
	type LiquidFilterChain,
	type LiquidFilterSubject,
	type LiquidFilterUse,
	type LiquidLookup,
	type LiquidNamedArgument,
	type LiquidStringLiteral,
	lookupExpression,
	scanLiquidExpression,
} from "./liquid-expression.js";
export {
	type LiquidDependency,
	type LiquidDependencyKind,
	type LiquidSettingsRead,
	liquidDependencies,
	liquidSchema,
	liquidSettingsReads,
} from "./liquid-facts.js";
export {
	type LiquidBlock,
	type LiquidConditional,
	type LiquidDocParam,
	type LiquidGuard,
	type LiquidLocalBinding,
	type LiquidRead,
	type LiquidRenderArgument,
	type LiquidStringReference,
	liquidAssetReferences,
	liquidBlocks,
	liquidConditionals,
	liquidDocParams,
	liquidGuards,
	liquidLocalBindings,
	liquidLocaleReferences,
	liquidReads,
	liquidRenderArguments,
} from "./liquid-readings.js";
export {
	BLOCK_TAGS,
	RAW_TAGS,
	TAGS_WITHOUT_MARKUP,
} from "./liquid-spec.js";
export { LineIndex, type Position, type Range, type Span } from "./source.js";
