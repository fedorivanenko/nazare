// AST-driven fact extraction from a Liquid file's expression regions: Shopify
// data reads, asset/locale filter references, render arguments, free-variable
// reads, condition guards, and capability signals. Everything except the
// textual capability heuristics (see below) comes from the parsed LiquidHTML
// AST — a token in a comment, string, or script body can never become a fact.
// Settings reads are NOT collected here: the parser already produces them
// (scanSettingsReadsFromLiquidAst), callers map those directly.
import type { SourceSpan } from "@nazare/core";
import {
	type LiquidHtmlNode,
	NodeTypes,
	type toLiquidHtmlAST,
	walk,
} from "@shopify/liquid-html-parser";
import { isLiquidString } from "./liquid-ast.js";
import {
	type LiquidFilterLike,
	type NamedArgumentLike,
	type PositionedLookup,
	type RenderMarkupLike,
	type SourceRange,
	visitLiquidExpressions,
} from "./liquid-expressions.js";
import { spanFromOffsets } from "./source.js";
import { renderSiteKey, type ThemeFact } from "./theme-facts.js";

/** Shopify objects whose reads become readsShopifyData facts. */
export const SHOPIFY_DATA_OBJECTS = new Set([
	"product",
	"variant",
	"collection",
	"cart",
	"customer",
	"search",
	"recommendations",
	"localization",
	"metafields",
	"metaobjects",
]);

/**
 * Objects a snippet cannot see unless the caller passes them: {% render %}
 * isolates scope, and these are page-context objects, not globals. Reads of
 * these inside a snippet are expected render inputs.
 */
export const CONTEXT_INPUT_OBJECTS = new Set([
	"product",
	"variant",
	"collection",
	"search",
	"recommendations",
]);

// Names visible in every Liquid scope (globals, tag-scoped loop objects, and
// the theme-context objects Shopify injects everywhere). A bare read of any
// other unassigned name inside a snippet is a render input.
const LIQUID_GLOBAL_NAMES = new Set([
	"additional_checkout_buttons",
	"all_products",
	"articles",
	"block",
	"blogs",
	"canonical_url",
	"cart",
	"checkout",
	"collections",
	"content_for_additional_checkout_buttons",
	"content_for_header",
	"content_for_index",
	"content_for_layout",
	"current_page",
	"current_tags",
	"customer",
	"forloop",
	"form",
	"handle",
	"images",
	"linklists",
	"localization",
	"metafields",
	"metaobjects",
	"page",
	"page_description",
	"page_title",
	"pages",
	"paginate",
	"powered_by_link",
	"predictive_search",
	"recommendations",
	"request",
	"routes",
	"scripts",
	"section",
	"settings",
	"shop",
	"tablerowloop",
	"template",
	"theme",
]);

const ASSET_FILTER_NAMES = new Set(["asset_url", "asset_img_url"]);

type LookupCapabilityRule = {
	capability: string;
	confidence: number;
	matches: (object: string, propertyPath: string) => boolean;
};

const lookupCapabilityRules: LookupCapabilityRule[] = [
	{
		capability: "addsToCart",
		confidence: 0.95,
		matches: (object, path) => object === "routes" && path === "cart_add_url",
	},
	{
		capability: "updatesCart",
		confidence: 0.9,
		matches: (object, path) =>
			object === "routes" &&
			(path === "cart_change_url" || path === "cart_update_url"),
	},
	{
		capability: "selectsVariants",
		confidence: 0.85,
		matches: (object, path) =>
			object === "product" &&
			(/(^|\.)variants($|\.)/.test(path) ||
				path.startsWith("selected_or_first_available_variant")),
	},
	{
		capability: "performsPredictiveSearch",
		confidence: 0.9,
		matches: (object) => object === "predictive_search",
	},
	{
		capability: "filtersCollections",
		confidence: 0.8,
		matches: (object, path) =>
			(object === "collection" && /(^|\.)filters($|\.)/.test(path)) ||
			(object === "filter" &&
				(path === "active_values" || path === "values")),
	},
];

// Signals only visible as literal text (form actions, input names, JS calls
// in inline <script>). These are heuristics by nature; they run over source
// with comments and raw/script/stylesheet bodies blanked so dead text can
// never signal, and they carry their own confidence.
const textCapabilityRules: Array<{
	capability: string;
	confidence: number;
	pattern: RegExp;
}> = [
	{ capability: "addsToCart", confidence: 0.95, pattern: /\/cart\/add/g },
	{
		capability: "updatesCart",
		confidence: 0.9,
		pattern: /\/cart\/(?:change|update)/g,
	},
	{
		capability: "selectsVariants",
		confidence: 0.85,
		pattern: /name=["']id["']/g,
	},
	{
		capability: "performsPredictiveSearch",
		confidence: 0.9,
		pattern: /(?:predictive_search|\/search\/suggest)/g,
	},
];

const conditionTagNames = new Set(["if", "unless", "elsif", "case", "when"]);

export function collectSourceThemeFacts(
	path: string,
	source: string,
	ast: ReturnType<typeof toLiquidHtmlAST>,
): ThemeFact[] {
	const facts: ThemeFact[] = [];
	const assignedNames = new Set<string>();
	const guardedNames = new Set<string>();
	const freeReads: { name: string; span?: SourceSpan }[] = [];
	const capabilitySeen = new Set<string>();

	const pushCapability = (
		capability: string,
		confidence: number,
		span?: SourceSpan,
	): void => {
		const key = `${capability}`;
		if (capabilitySeen.has(key)) return;
		capabilitySeen.add(key);
		facts.push({ kind: "detectsCapability", path, capability, confidence, span });
	};

	const handleLookup = (
		lookup: PositionedLookup,
		inCondition: boolean,
	): void => {
		const propertyPath = stringLookupPath(lookup);
		const span = rangeSpan(path, source, lookup.position);
		if (inCondition) guardedNames.add(lookup.name);
		if (SHOPIFY_DATA_OBJECTS.has(lookup.name)) {
			facts.push({
				kind: "readsShopifyData",
				fromPath: path,
				object: lookup.name,
				propertyPath: propertyPath || undefined,
				expression: propertyPath
					? `${lookup.name}.${propertyPath}`
					: lookup.name,
				span,
			});
		} else if (!LIQUID_GLOBAL_NAMES.has(lookup.name)) {
			freeReads.push({ name: lookup.name, span });
		}
		for (const rule of lookupCapabilityRules) {
			if (rule.matches(lookup.name, propertyPath)) {
				pushCapability(rule.capability, rule.confidence, span);
			}
		}
	};

	walk(ast, (node) => {
		if (node.type === NodeTypes.LiquidRawTag) return;
		if (node.type === NodeTypes.LiquidTag && node.name === "comment") return;
		if (
			node.type !== NodeTypes.LiquidVariableOutput &&
			node.type !== NodeTypes.LiquidTag &&
			node.type !== NodeTypes.LiquidBranch
		)
			return;

		const tag = node as LiquidHtmlNode & {
			name?: unknown;
			markup?: unknown;
			position: SourceRange;
		};
		const tagName = typeof tag.name === "string" ? tag.name : undefined;
		const inCondition =
			tagName !== undefined && conditionTagNames.has(tagName);

		if (
			(tagName === "render" || tagName === "include") &&
			isRenderMarkup(tag.markup)
		) {
			facts.push(
				...renderArgumentFacts(path, source, tag.markup, tag.position),
			);
		}

		visitLiquidExpressions(tag.markup, {
			onLookup: (lookup) => handleLookup(lookup, inCondition),
			onVariable: (variable) => {
				const filterNames = namesOfFilters(variable.filters);
				if (!isLiquidString(variable.expression)) return;
				const span = rangeSpan(path, source, variable.position);
				if (filterNames.some((name) => ASSET_FILTER_NAMES.has(name))) {
					facts.push({
						kind: "referencesAsset",
						fromPath: path,
						targetName: variable.expression.value,
						static: true,
						span,
					});
				}
				if (filterNames.includes("t")) {
					facts.push({
						kind: "referencesLocaleKey",
						fromPath: path,
						key: variable.expression.value,
						static: true,
						span,
					});
				}
			},
			onAssign: (markup) => assignedNames.add(markup.name),
			onFor: (markup) => {
				if (markup.variableName) assignedNames.add(markup.variableName);
			},
		});
	});

	// Free reads filter against every assigned name in the file (position-
	// insensitive: a read before its assign is broken Liquid, not an input).
	for (const read of freeReads) {
		if (assignedNames.has(read.name)) continue;
		facts.push({
			kind: "readsFreeVariable",
			fromPath: path,
			name: read.name,
			span: read.span,
		});
	}
	for (const name of guardedNames) {
		facts.push({ kind: "guardsObject", fromPath: path, name });
	}

	const blanked = blankNonLiquidText(source);
	for (const rule of textCapabilityRules) {
		for (const match of blanked.matchAll(rule.pattern)) {
			if (match.index === undefined) continue;
			pushCapability(
				rule.capability,
				rule.confidence,
				spanFromOffsets(source, path, {
					start: match.index,
					end: match.index + match[0].length,
				}),
			);
		}
	}

	return facts;
}

function renderArgumentFacts(
	path: string,
	source: string,
	markup: RenderMarkupLike,
	tagPosition: SourceRange,
): ThemeFact[] {
	// Arguments attribute to a site only when the target is static; a dynamic
	// {% render block %} has no name to check arguments against.
	if (!isLiquidString(markup.snippet)) return [];
	const targetName = markup.snippet.value;
	const siteId = renderSiteKey(
		path,
		spanFromOffsets(source, path, tagPosition),
	);
	const facts: ThemeFact[] = [];
	for (const argument of namedArguments(markup.args)) {
		const valueSource = sliceRange(source, argumentValueRange(argument));
		facts.push({
			kind: "passesRenderArgument",
			fromPath: path,
			targetName,
			siteId,
			argumentName: argument.name,
			valueExpression: valueSource ?? "",
			...argumentSource(argument.value),
			span: rangeSpan(path, source, argument.position),
		});
	}
	return facts;
}

/** sourceObject/sourcePath of an argument whose value is a plain lookup. */
function argumentSource(value: unknown): {
	sourceObject?: string;
	sourcePath?: string;
} {
	const lookup = value as PositionedLookup;
	if (
		!lookup ||
		(lookup as { type?: unknown }).type !== "VariableLookup" ||
		typeof lookup.name !== "string"
	) {
		return {};
	}
	const propertyPath = stringLookupPath(lookup);
	// section.settings.x / block.settings.x read as a settings source.
	if (
		(lookup.name === "section" || lookup.name === "block") &&
		propertyPath.startsWith("settings.")
	) {
		return {
			sourceObject: `${lookup.name}.settings`,
			sourcePath: propertyPath.slice("settings.".length),
		};
	}
	if (!SHOPIFY_DATA_OBJECTS.has(lookup.name)) return {};
	return {
		sourceObject: lookup.name,
		sourcePath: propertyPath || undefined,
	};
}

/** Dot-joined String lookups; stops at the first dynamic (non-String) index. */
function stringLookupPath(lookup: PositionedLookup): string {
	const parts: string[] = [];
	for (const entry of lookup.lookups ?? []) {
		if (!isLiquidString(entry)) break;
		parts.push(entry.value);
	}
	return parts.join(".");
}

function namesOfFilters(filters: unknown): string[] {
	if (!Array.isArray(filters)) return [];
	return filters
		.filter(
			(filter): filter is LiquidFilterLike =>
				!!filter &&
				(filter as { type?: unknown }).type === "LiquidFilter" &&
				typeof (filter as { name?: unknown }).name === "string",
		)
		.map((filter) => filter.name);
}

function namedArguments(args: unknown): NamedArgumentLike[] {
	if (!Array.isArray(args)) return [];
	return args.filter(
		(argument): argument is NamedArgumentLike =>
			!!argument &&
			(argument as { type?: unknown }).type === "NamedArgument" &&
			typeof (argument as { name?: unknown }).name === "string",
	);
}

function isRenderMarkup(markup: unknown): markup is RenderMarkupLike {
	return !!markup && (markup as { type?: unknown }).type === "RenderMarkup";
}

function argumentValueRange(
	argument: NamedArgumentLike,
): SourceRange | undefined {
	const position = (argument.value as { position?: unknown } | undefined)
		?.position;
	if (
		position &&
		typeof (position as SourceRange).start === "number" &&
		typeof (position as SourceRange).end === "number"
	) {
		return position as SourceRange;
	}
	return undefined;
}

function sliceRange(
	source: string,
	range: SourceRange | undefined,
): string | undefined {
	if (!range) return undefined;
	return source.slice(range.start, range.end).trim();
}

function rangeSpan(
	path: string,
	source: string,
	range: SourceRange | undefined,
): SourceSpan | undefined {
	if (!range) return undefined;
	return spanFromOffsets(source, path, range);
}

/**
 * Blanks text that can never carry live storefront behavior — Liquid and
 * HTML comments, {% raw %} bodies, and Nazare script/stylesheet bodies —
 * so the textual capability heuristics cannot match dead text. Newlines are
 * kept, so match offsets stay valid against the original source.
 */
function blankNonLiquidText(source: string): string {
	let result = source;
	const blocks = [
		/{%-?\s*comment\s*-?%}[\s\S]*?{%-?\s*endcomment\s*-?%}/g,
		/{%-?\s*raw\s*-?%}[\s\S]*?{%-?\s*endraw\s*-?%}/g,
		/{%-?\s*script\b[^%]*?-?%}[\s\S]*?{%-?\s*endscript\s*-?%}/g,
		/{%-?\s*stylesheet\b[^%]*?-?%}[\s\S]*?{%-?\s*endstylesheet\s*-?%}/g,
		/<!--[\s\S]*?-->/g,
	];
	for (const pattern of blocks) {
		result = result.replace(pattern, (matched) =>
			matched.replace(/[^\n]/g, " "),
		);
	}
	return result;
}
