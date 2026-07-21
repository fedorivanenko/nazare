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
	"linklists",
	"metafields",
	"metaobjects",
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
			(object === "filter" && (path === "active_values" || path === "values")),
	},
	{
		capability: "displaysNavigation",
		confidence: 0.8,
		matches: (object) => object === "linklists",
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
	{
		capability: "switchesLocalization",
		confidence: 0.9,
		pattern:
			/(?:form\s+['"]localization['"]|localization\.country|localization\.language)/g,
	},
];

export function collectSourceThemeFacts(
	path: string,
	source: string,
	ast: ReturnType<typeof toLiquidHtmlAST>,
): ThemeFact[] {
	const facts: ThemeFact[] = [];
	const firstAssignmentOffsetByName = new Map<string, number>();
	const guardedNames = new Set<string>();
	const unguardedNames = new Set<string>();
	const guardRangesByName = new Map<string, SourceRange[]>();
	const localBindingRangesByName = new Map<string, SourceRange[]>();
	const conditionalAssignmentRanges: SourceRange[] = [];
	const aliasBindings = new Map<string, AliasBinding[]>();
	const freeReads: {
		name: string;
		propertyPath?: string;
		expression: string;
		offset: number;
		span?: SourceSpan;
	}[] = [];

	walk(ast, (node) => {
		if (node.type !== NodeTypes.LiquidTag) return;
		const tag = node as LiquidHtmlNode & {
			name?: unknown;
			markup?: unknown;
			position?: SourceRange;
		};
		if (tag.name === "if") registerIfGuardRanges(tag, guardRangesByName);
		if (
			tag.position &&
			(tag.name === "if" ||
				tag.name === "unless" ||
				tag.name === "case" ||
				tag.name === "for" ||
				tag.name === "tablerow")
		) {
			conditionalAssignmentRanges.push(tag.position);
		}
		if ((tag.name === "for" || tag.name === "tablerow") && tag.position) {
			registerLoopBindingRange(tag, tag.position, localBindingRangesByName);
		}
	});

	// Collect unconditional lookup aliases before reading expressions. This
	// preserves property provenance through common `assign alias = product`
	// patterns without guessing across conditional assignments.
	walk(ast, (node) => {
		if (node.type !== NodeTypes.LiquidTag) return;
		const tag = node as LiquidHtmlNode & { markup?: unknown };
		visitLiquidExpressions(tag.markup, {
			onAssign: (markup) => {
				const offset = expressionStart(markup);
				if (isOffsetWithinRanges(offset, conditionalAssignmentRanges)) return;
				const rawValue = markup.value as
					| PositionedLookup
					| { expression?: unknown }
					| undefined;
				const value =
					rawValue && (rawValue as { type?: unknown }).type === "VariableLookup"
						? (rawValue as PositionedLookup)
						: ((rawValue as { expression?: unknown } | undefined)?.expression as
								| PositionedLookup
								| undefined);
				if (!value || value.type !== "VariableLookup") return;
				aliasBindings.set(markup.name, [
					...(aliasBindings.get(markup.name) ?? []),
					{ offset, lookup: value },
				]);
			},
		});
	});
	for (const bindings of aliasBindings.values()) {
		bindings.sort((a, b) => a.offset - b.offset);
	}

	const pushCapability = (
		capability: string,
		confidence: number,
		span?: SourceSpan,
	): void => {
		facts.push({
			kind: "detectsCapability",
			path,
			capability,
			confidence,
			span,
		});
	};

	const handleLookup = (
		lookup: PositionedLookup,
		inCondition: boolean,
	): void => {
		const position = lookup.position;
		const resolved = resolveAliasedLookup(
			lookup,
			position?.start ?? Number.POSITIVE_INFINITY,
			aliasBindings,
		);
		const object = resolved.object;
		const propertyPath = resolved.propertyPath;
		const span = rangeSpan(path, source, position);
		const guarded =
			inCondition ||
			(position !== undefined &&
				(guardRangesByName.get(lookup.name) ?? []).some(
					(range) => position.start >= range.start && position.end <= range.end,
				));
		if (guarded) guardedNames.add(lookup.name);
		else unguardedNames.add(lookup.name);
		if (SHOPIFY_DATA_OBJECTS.has(object)) {
			facts.push({
				kind: "readsShopifyData",
				fromPath: path,
				object,
				propertyPath: propertyPath || undefined,
				expression: propertyPath ? `${object}.${propertyPath}` : object,
				span,
			});
		} else if (!LIQUID_GLOBAL_NAMES.has(object)) {
			freeReads.push({
				name: object,
				propertyPath: propertyPath || undefined,
				expression: propertyPath ? `${object}.${propertyPath}` : object,
				offset: position?.start ?? Number.POSITIVE_INFINITY,
				span,
			});
		}
		for (const rule of lookupCapabilityRules) {
			if (rule.matches(object, propertyPath)) {
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
		const inCondition = tagName === "if";

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
			onAssign: (markup) => {
				const offset = expressionStart(markup);
				if (isOffsetWithinRanges(offset, conditionalAssignmentRanges)) return;
				const previous = firstAssignmentOffsetByName.get(markup.name);
				if (previous === undefined || offset < previous) {
					firstAssignmentOffsetByName.set(markup.name, offset);
				}
			},
		});
	});

	for (const read of freeReads) {
		if (
			isOffsetWithinRanges(
				read.offset,
				localBindingRangesByName.get(read.name) ?? [],
			)
		)
			continue;
		const assignmentOffset = firstAssignmentOffsetByName.get(read.name);
		if (assignmentOffset !== undefined && assignmentOffset <= read.offset)
			continue;
		facts.push({
			kind: "readsFreeVariable",
			fromPath: path,
			name: read.name,
			propertyPath: read.propertyPath,
			expression: read.expression,
			span: read.span,
		});
	}
	for (const name of guardedNames) {
		if (unguardedNames.has(name)) continue;
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

type AliasBinding = { offset: number; lookup: PositionedLookup };

function resolveAliasedLookup(
	lookup: PositionedLookup,
	offset: number,
	bindingsByName: Map<string, AliasBinding[]>,
	seen = new Set<string>(),
): { object: string; propertyPath: string } {
	const ownPath = stringLookupPath(lookup);
	if (seen.has(lookup.name))
		return { object: lookup.name, propertyPath: ownPath };
	const candidates = (bindingsByName.get(lookup.name) ?? []).filter(
		(binding) => binding.offset <= offset,
	);
	const binding = candidates.at(-1);
	if (!binding) return { object: lookup.name, propertyPath: ownPath };
	seen.add(lookup.name);
	const source = resolveAliasedLookup(
		binding.lookup,
		binding.offset,
		bindingsByName,
		seen,
	);
	return {
		object: source.object,
		propertyPath: [source.propertyPath, ownPath].filter(Boolean).join("."),
	};
}

function expressionStart(value: unknown): number {
	const start = (value as { position?: { start?: unknown } } | undefined)
		?.position?.start;
	return typeof start === "number" ? start : Number.POSITIVE_INFINITY;
}

function isOffsetWithinRanges(offset: number, ranges: SourceRange[]): boolean {
	return ranges.some((range) => offset >= range.start && offset <= range.end);
}

function registerLoopBindingRange(
	tag: LiquidHtmlNode & { markup?: unknown },
	range: SourceRange,
	localBindingRangesByName: Map<string, SourceRange[]>,
): void {
	visitLiquidExpressions(tag.markup, {
		onFor: (markup) => {
			if (!markup.variableName) return;
			localBindingRangesByName.set(markup.variableName, [
				...(localBindingRangesByName.get(markup.variableName) ?? []),
				range,
			]);
		},
	});
}

function registerIfGuardRanges(
	tag: LiquidHtmlNode & { markup?: unknown },
	guardRangesByName: Map<string, SourceRange[]>,
): void {
	const names = new Set<string>();
	visitLiquidExpressions(tag.markup, {
		onLookup: (lookup) => names.add(lookup.name),
	});
	const firstBranch = (tag as { children?: unknown[] }).children?.find(
		(child) =>
			!!child &&
			(child as { type?: unknown }).type === NodeTypes.LiquidBranch &&
			(child as { name?: unknown }).name === null,
	) as { position?: SourceRange } | undefined;
	if (!firstBranch?.position) return;
	for (const name of names) {
		guardRangesByName.set(name, [
			...(guardRangesByName.get(name) ?? []),
			firstBranch.position,
		]);
	}
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
	const implicitLookup = markup.variable?.name as PositionedLookup | undefined;
	if (
		markup.variable?.type === "RenderVariableExpression" &&
		implicitLookup?.type === "VariableLookup" &&
		typeof implicitLookup.name === "string"
	) {
		const implicitName =
			typeof markup.alias?.value === "string" ? markup.alias.value : targetName;
		const valueExpression =
			sliceRange(source, implicitLookup.position) ?? implicitLookup.name;
		facts.push({
			kind: "passesRenderArgument",
			fromPath: path,
			targetName,
			siteId,
			argumentName: implicitName,
			valueExpression,
			...argumentSource(
				implicitLookup,
				markup.variable.kind === "for" ? "for" : "with",
			),
			span: rangeSpan(path, source, markup.variable.position),
		});
	}
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
function argumentSource(
	value: unknown,
	bindingKind: "with" | "for" = "with",
): {
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
	if (bindingKind === "for") {
		const elementObject = collectionElementObject(lookup.name, propertyPath);
		if (elementObject) return { sourceObject: elementObject };
	}
	return {
		sourceObject: lookup.name,
		sourcePath: propertyPath || undefined,
	};
}

function collectionElementObject(
	object: string,
	propertyPath: string,
): string | undefined {
	if (object === "collection" && propertyPath === "products") return "product";
	if (object === "product" && propertyPath === "variants") return "variant";
	return undefined;
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
