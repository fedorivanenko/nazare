// The Liquid tag vocabulary this scanner implements.
//
// Copied from @shopify/liquid-html-parser's own grammar module (v2.9.2), which
// exports BLOCKS, RAW_TAGS and TAGS_WITHOUT_MARKUP. Taking the reference
// implementation's tables rather than the prose documentation means the two
// agree by construction on the only question that matters for scanning: which
// tags open a body, and which bodies are not Liquid.
//
// When the parser is upgraded, re-read those exports and diff them against
// these. `pnpm -s test:scan` fails if they drift.

/** Tags that open a body closed by `end<name>`, whose body is Liquid. */
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
	"form",
	"paginate",
	"capture",
	"case",
	"for",
	"ifchanged",
	"if",
	"unless",
	"tablerow",
]);

/**
 * Tags whose body is not Liquid and must be skipped wholesale. A `{{` inside
 * one is text, not an output — scanning into them invents facts.
 */
export const RAW_TAGS: ReadonlySet<string> = new Set([
	"raw",
	"javascript",
	"schema",
	"stylesheet",
	"style",
	"comment",
]);

/** Tags whose opening carries no markup, so there is nothing to read after the name. */
export const TAGS_WITHOUT_MARKUP: ReadonlySet<string> = new Set([
	"style",
	"schema",
	"javascript",
	"else",
	"break",
	"continue",
	"comment",
	"raw",
	"doc",
]);

/**
 * `{% doc %}` bodies are LiquidDoc, a separate grammar in the reference parser,
 * not Liquid. Treated as raw here: the scanner hands the body out untouched and
 * a LiquidDoc reader interprets it.
 */
export const DOC_TAG = "doc";

/**
 * `{% liquid %}` carries one statement per line with no `{% %}` delimiters.
 * Each line is a tag in its own right.
 */
export const LIQUID_TAG = "liquid";
