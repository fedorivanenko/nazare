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
	const localDefinitions = new Map<string, LocalDefinition[]>();
	const guardedNames = new Set<string>();
	const defaultedNames = new Set<string>();
	const unguardedNames = new Set<string>();
	const safeInitializationOffsets = new Set<number>();
	const guardRangesByName = new Map<string, SourceRange[]>();
	const guardProxyTargets = new Map<string, Set<string>>();
	const localBindingRangesByName = new Map<string, SourceRange[]>();
	const lexicalScopeRanges: SourceRange[] = [];
	const aliasBindings = new Map<string, AliasBinding[]>();
	const freeReads: {
		name: string;
		propertyPath?: string;
		expression: string;
		offset: number;
		usage: "expression" | "renderArgument";
		span?: SourceSpan;
	}[] = [];

	walk(ast, (node) => {
		if (node.type === NodeTypes.LiquidBranch) {
			const branch = node as { markup?: unknown; position?: SourceRange };
			if (branch.position) {
				lexicalScopeRanges.push(branch.position);
				registerBranchGuardRange(
					{ markup: branch.markup, position: branch.position },
					guardRangesByName,
				);
			}
			return;
		}
		if (node.type !== NodeTypes.LiquidTag) return;
		const tag = node as LiquidHtmlNode & {
			name?: unknown;
			markup?: unknown;
			position?: SourceRange;
		};
		if (tag.name === "if" || tag.name === "unless") {
			registerIfGuardRanges(tag, guardRangesByName, guardProxyTargets);
		}
		if (tag.name === "if") registerGuardProxy(tag, guardProxyTargets);
		if (tag.name === "for" || tag.name === "tablerow") {
			registerLoopBindingRange(tag, localBindingRangesByName);
		}
	});
	const lexicalScopeIndex = buildLexicalScopeIndex(lexicalScopeRanges);

	// Collect definitions before reading expressions. A conditional definition
	// is visible only after the definition and inside its exact branch range.
	// This preserves local-variable and alias facts without pretending a value
	// assigned in one branch exists in its siblings or after the block.
	walk(ast, (node) => {
		if (node.type !== NodeTypes.LiquidTag) return;
		const tag = node as LiquidHtmlNode & {
			name?: unknown;
			markup?: unknown;
			position?: SourceRange;
		};
		if (tag.name === "capture" && tag.position) {
			const capturedName = (tag.markup as PositionedLookup | undefined)?.name;
			if (capturedName) {
				addLocalDefinition(localDefinitions, capturedName, {
					offset: tag.position.end,
					range: innermostContainingRange(
						tag.position.start,
						lexicalScopeIndex,
					),
				});
			}
		}
		visitLiquidExpressions(tag.markup, {
			onAssign: (markup) => {
				const assignmentStart = expressionStart(markup);
				const offset = markup.position?.end ?? assignmentStart;
				const range = innermostContainingRange(
					assignmentStart,
					lexicalScopeIndex,
				);
				addLocalDefinition(localDefinitions, markup.name, { offset, range });
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
				if (value.position) safeInitializationOffsets.add(value.position.start);
				const filters =
					rawValue && (rawValue as { type?: unknown }).type === "LiquidVariable"
						? ((rawValue as { filters?: unknown[] }).filters ?? [])
						: [];
				if (namesOfFilters(filters).includes("default")) {
					defaultedNames.add(value.name);
				}
				// Filters transform the value; only a bare assignment is an alias.
				if (filters.length === 0) {
					aliasBindings.set(markup.name, [
						...(aliasBindings.get(markup.name) ?? []),
						{ offset, lookup: value, range },
					]);
				}
			},
		});
		if (
			(tag.name === "if" || tag.name === "unless" || tag.name === "case") &&
			tag.position
		) {
			for (const name of definitelyAssignedByConditional(
				tag as { children?: unknown[] },
			)) {
				addLocalDefinition(localDefinitions, name, {
					offset: tag.position.end,
					range: innermostContainingRange(
						tag.position.start,
						lexicalScopeIndex,
					),
				});
			}
			const firstBranch = (
				tag as { children?: { type?: unknown; children?: unknown[] }[] }
			).children?.find((child) => child.type === NodeTypes.LiquidBranch);
			const conditionSource = sliceRange(
				source,
				(tag.markup as { position?: SourceRange } | undefined)?.position,
			);
			if (firstBranch && conditionSource) {
				for (const name of definitelyAssignedInSequence(
					firstBranch.children ?? [],
				)) {
					const absenceOperator = tag.name === "unless" ? "!=" : "==";
					const checksAbsence = new RegExp(
						`\\b${name}\\s*${absenceOperator}\\s*(?:blank|null|empty)\\b`,
					).test(conditionSource);
					if (!checksAbsence) continue;
					const binding = (aliasBindings.get(name) ?? [])
						.filter((candidate) => candidate.offset <= tag.position.start)
						.at(-1);
					// With a prior binding the defaulted value is whatever the name
					// aliases. Without one the name is its own subject: an input that
					// this block fills in when absent, which is what
					// `{% unless x != blank %}{% assign x = … %}` states about a
					// render input.
					defaultedNames.add(
						binding
							? resolveAliasedLookup(
									binding.lookup,
									binding.offset,
									aliasBindings,
								).object
							: name,
					);
				}
			}
		}
	});
	for (const definitions of localDefinitions.values()) {
		definitions.sort((a, b) => a.offset - b.offset);
	}
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
		usage: "expression" | "renderArgument",
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
		if (!position || !safeInitializationOffsets.has(position.start)) {
			if (guarded) guardedNames.add(object);
			else unguardedNames.add(object);
		}
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
				usage,
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
		const inCondition =
			tagName === "if" ||
			tagName === "unless" ||
			tagName === "case" ||
			(node.type === NodeTypes.LiquidBranch && tag.markup !== undefined);

		if (
			(tagName === "render" || tagName === "include") &&
			isRenderMarkup(tag.markup)
		) {
			facts.push(
				...renderArgumentFacts(path, source, tag.markup, tag.position),
			);
		}
		// Capture markup declares its destination; it is not a variable read.
		// Child outputs are separate AST nodes and remain visited by walk().
		if (tagName === "capture") return;

		visitLiquidExpressions(tag.markup, {
			onLookup: (lookup) =>
				handleLookup(
					lookup,
					inCondition,
					tagName === "render" || tagName === "include"
						? "renderArgument"
						: "expression",
				),
			onVariable: (variable) => {
				const filterNames = namesOfFilters(variable.filters);
				const expression = variable.expression as PositionedLookup;
				if (
					filterNames.includes("default") &&
					expression?.type === "VariableLookup"
				) {
					defaultedNames.add(
						resolveAliasedLookup(
							expression,
							expression.position?.start ?? Number.POSITIVE_INFINITY,
							aliasBindings,
						).object,
					);
				}
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
		if (
			hasVisibleDefinition(read.offset, localDefinitions.get(read.name) ?? [])
		)
			continue;
		facts.push({
			kind: "readsFreeVariable",
			fromPath: path,
			name: read.name,
			propertyPath: read.propertyPath,
			expression: read.expression,
			usage: read.usage,
			span: read.span,
		});
	}
	for (const name of new Set([...guardedNames, ...defaultedNames])) {
		if (unguardedNames.has(name) && !defaultedNames.has(name)) continue;
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

const definiteAssignmentsByConditional = new WeakMap<object, Set<string>>();

function definitelyAssignedByConditional(tag: {
	children?: unknown[];
}): Set<string> {
	const cached = definiteAssignmentsByConditional.get(tag);
	if (cached) return cached;
	const branches = (tag.children ?? []).filter(
		(child): child is { name?: unknown; children?: unknown[] } =>
			!!child && (child as { type?: unknown }).type === NodeTypes.LiquidBranch,
	);
	if (branches.length === 0 || branches.at(-1)?.name !== "else") {
		const empty = new Set<string>();
		definiteAssignmentsByConditional.set(tag, empty);
		return empty;
	}
	const assignedByBranch = branches.map((branch) =>
		definitelyAssignedInSequence(branch.children ?? []),
	);
	const [first, ...rest] = assignedByBranch;
	const result = new Set(
		[...(first ?? [])].filter((name) =>
			rest.every((assigned) => assigned.has(name)),
		),
	);
	definiteAssignmentsByConditional.set(tag, result);
	return result;
}

function definitelyAssignedInSequence(nodes: unknown[]): Set<string> {
	const assigned = new Set<string>();
	for (const value of nodes) {
		const node = value as {
			type?: unknown;
			name?: unknown;
			markup?: unknown;
			children?: unknown[];
		};
		if (node.type !== NodeTypes.LiquidTag) continue;
		if (node.name === "capture") {
			const name = (node.markup as PositionedLookup | undefined)?.name;
			if (name) assigned.add(name);
		}
		visitLiquidExpressions(node.markup, {
			onAssign: (markup) => assigned.add(markup.name),
		});
		if (node.name === "if" || node.name === "unless" || node.name === "case") {
			for (const name of definitelyAssignedByConditional(node)) {
				assigned.add(name);
			}
		}
	}
	return assigned;
}

type LocalDefinition = { offset: number; range?: SourceRange };
type AliasBinding = LocalDefinition & { lookup: PositionedLookup };

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
		(binding) =>
			binding.offset <= offset &&
			(!binding.range || isOffsetWithinRange(offset, binding.range)),
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

function isOffsetWithinRange(offset: number, range: SourceRange): boolean {
	return offset >= range.start && offset <= range.end;
}

function isOffsetWithinRanges(offset: number, ranges: SourceRange[]): boolean {
	return ranges.some((range) => isOffsetWithinRange(offset, range));
}

type LexicalScopeIndexEntry = {
	range: SourceRange;
	parentIndex?: number;
};

function buildLexicalScopeIndex(
	ranges: SourceRange[],
): LexicalScopeIndexEntry[] {
	const entries = ranges
		.map((range) => ({ range }))
		.sort(
			(a, b) => a.range.start - b.range.start || b.range.end - a.range.end,
		) as LexicalScopeIndexEntry[];
	const stack: number[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const range = entries[index]?.range;
		if (!range) continue;
		while (stack.length > 0) {
			const parent = entries[stack.at(-1) ?? -1]?.range;
			if (parent && range.end <= parent.end) break;
			stack.pop();
		}
		if (stack.length > 0) entries[index].parentIndex = stack.at(-1);
		stack.push(index);
	}
	return entries;
}

function innermostContainingRange(
	offset: number,
	index: LexicalScopeIndexEntry[],
): SourceRange | undefined {
	let low = 0;
	let high = index.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if ((index[middle]?.range.start ?? Number.POSITIVE_INFINITY) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	let candidateIndex = low - 1;
	while (candidateIndex >= 0) {
		const candidate = index[candidateIndex];
		if (!candidate) return undefined;
		if (isOffsetWithinRange(offset, candidate.range)) return candidate.range;
		candidateIndex = candidate.parentIndex ?? -1;
	}
	return undefined;
}

function addLocalDefinition(
	definitionsByName: Map<string, LocalDefinition[]>,
	name: string,
	definition: LocalDefinition,
): void {
	definitionsByName.set(name, [
		...(definitionsByName.get(name) ?? []),
		definition,
	]);
}

function hasVisibleDefinition(
	offset: number,
	definitions: LocalDefinition[],
): boolean {
	return definitions.some(
		(definition) =>
			definition.offset <= offset &&
			(!definition.range || isOffsetWithinRange(offset, definition.range)),
	);
}

function registerLoopBindingRange(
	tag: LiquidHtmlNode & { markup?: unknown; children?: unknown[] },
	localBindingRangesByName: Map<string, SourceRange[]>,
): void {
	const bodyRange = tag.children
		?.map(
			(child) =>
				child as { type?: unknown; name?: unknown; position?: SourceRange },
		)
		.find(
			(child) => child.type === NodeTypes.LiquidBranch && child.name === null,
		)?.position;
	if (!bodyRange) return;
	visitLiquidExpressions(tag.markup, {
		onFor: (markup) => {
			if (!markup.variableName) return;
			localBindingRangesByName.set(markup.variableName, [
				...(localBindingRangesByName.get(markup.variableName) ?? []),
				bodyRange,
			]);
		},
	});
}

function registerBranchGuardRange(
	branch: { markup?: unknown; position: SourceRange },
	guardRangesByName: Map<string, SourceRange[]>,
): void {
	visitLiquidExpressions(branch.markup, {
		onLookup: (lookup) => {
			guardRangesByName.set(lookup.name, [
				...(guardRangesByName.get(lookup.name) ?? []),
				branch.position,
			]);
		},
	});
}

function registerIfGuardRanges(
	tag: LiquidHtmlNode & { markup?: unknown },
	guardRangesByName: Map<string, SourceRange[]>,
	guardProxyTargets: Map<string, Set<string>>,
): void {
	const names = new Set<string>();
	visitLiquidExpressions(tag.markup, {
		onLookup: (lookup) => names.add(lookup.name),
	});
	// A condition on a proxy boolean guards whatever the proxy was derived from,
	// so `{% if has_image %}` protects reads of `image` exactly as
	// `{% if image != blank %}` would.
	for (const name of [...names]) {
		for (const target of guardProxyTargets.get(name) ?? []) names.add(target);
	}
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

/**
 * Records `{% if x … %}{% assign flag = true %}{% else %}{% assign flag = false %}`
 * as `flag` standing in for a guard on `x`. Themes routinely test the value once
 * and branch on the boolean afterwards; without this the later reads look
 * unguarded and the input is inferred required even though the source guards it.
 *
 * Deliberately narrow: only `if` (an `unless` proxy would invert the meaning),
 * and only boolean literals, so an ordinary assignment never becomes a guard.
 * A later `{% if flag == false %}` block is treated as guarding too, which
 * errs toward optional — the direction that declines to claim a requirement
 * the source does not prove.
 */
function registerGuardProxy(
	tag: LiquidHtmlNode & { markup?: unknown },
	guardProxyTargets: Map<string, Set<string>>,
): void {
	const conditionNames = new Set<string>();
	visitLiquidExpressions(tag.markup, {
		onLookup: (lookup) => conditionNames.add(lookup.name),
	});
	if (conditionNames.size === 0) return;
	const branches = ((tag as { children?: unknown[] }).children ?? []).filter(
		(child) =>
			!!child && (child as { type?: unknown }).type === NodeTypes.LiquidBranch,
	) as { name?: unknown; children?: unknown[] }[];
	const primary = branches.find((branch) => branch.name === null);
	const alternate = branches.find((branch) => branch.name === "else");
	if (!primary) return;
	for (const [name, value] of booleanAssignments(primary.children ?? [])) {
		if (value !== true) continue;
		const alternateValue = alternate
			? booleanAssignments(alternate.children ?? []).get(name)
			: false;
		if (alternateValue !== false) continue;
		const targets = guardProxyTargets.get(name) ?? new Set<string>();
		for (const conditionName of conditionNames) targets.add(conditionName);
		guardProxyTargets.set(name, targets);
	}
}

/** Names assigned a bare `true`/`false` literal directly in this sequence. */
function booleanAssignments(nodes: unknown[]): Map<string, boolean> {
	const assignments = new Map<string, boolean>();
	for (const value of nodes) {
		const node = value as { type?: unknown; markup?: unknown };
		if (node.type !== NodeTypes.LiquidTag) continue;
		visitLiquidExpressions(node.markup, {
			onAssign: (markup) => {
				const raw = markup.value as
					| { type?: unknown; value?: unknown; filters?: unknown[] }
					| undefined;
				const expression = (
					raw?.type === "LiquidVariable"
						? (raw as { expression?: unknown }).expression
						: raw
				) as { type?: unknown; value?: unknown } | undefined;
				const filters =
					raw?.type === "LiquidVariable" ? (raw.filters ?? []) : [];
				if (filters.length > 0 || expression?.type !== "LiquidLiteral") return;
				if (typeof expression.value !== "boolean") return;
				assignments.set(markup.name, expression.value);
			},
		});
	}
	return assignments;
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
