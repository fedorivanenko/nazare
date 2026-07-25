// Plain Shopify Liquid frontend: parse/validate/pass through existing theme files
// without interpreting Nazare-only syntax. This is the coexistence seam for
// `.liquid` files in migrated themes: Liquid structure and authored schema are
// checked, static theme dependencies are indexed, and emit preserves source.
import type { Diagnostic, SourceSpan } from "@nazare/core";
import {
	type DocumentNode,
	NodeTypes,
	toLiquidAST,
	toLiquidHtmlAST,
	walk,
} from "@shopify/liquid-html-parser";
import type { AuthoredSchema, SettingsRead } from "./ast.js";
import {
	extractAuthoredSchema,
	isLiquidString,
	isVariableLookup,
	liquidTagMarkup,
	parseLiquidError,
} from "./liquid-ast.js";
import { scanSettingsReadsFromLiquidAst } from "./settings-reads.js";
import { spanFromOffsets } from "./source.js";

export type PlainLiquidParseMode = "strict" | "liquid-only";

export type PlainLiquidOptions = {
	/** Defaults to strict HTML + Liquid validation; liquid-only masks HTML but still validates Liquid structure. */
	parseMode?: PlainLiquidParseMode;
};

export type BuildPlainLiquidOptions = PlainLiquidOptions & {
	/** Defaults to false; set true only for preview/pass-through tooling. */
	emitOnError?: boolean;
};

export type PlainLiquidDependencyKind =
	| "snippet"
	| "section"
	| "section-group"
	| "layout";

export type PlainLiquidDependency = {
	kind: PlainLiquidDependencyKind;
	invocationKind?: "render" | "include";
	/** Shopify theme-relative path when statically known and valid. */
	path?: string;
	/** Static dependency name. `layout none` intentionally has no path. */
	name?: string;
	/** Raw Liquid expression/tag markup that produced this dependency. */
	source: string;
	/** True for literal names, false for dynamic expressions. */
	static: boolean;
	span: SourceSpan;
};

export type PlainLiquidAst = {
	file: string;
	liquidAst: DocumentNode;
	/** No Nazare nodes are produced by this frontend; kept for shared schema checks. */
	nodes: [];
	schema?: AuthoredSchema;
	settingsReads: SettingsRead[];
	dependencies: PlainLiquidDependency[];
	diagnostics: Diagnostic[];
	notes: [];
	factsCollected: boolean;
	parseMode: PlainLiquidParseMode;
};

export type CompilePlainLiquidResult = {
	ast: PlainLiquidAst;
	issues: Diagnostic[];
	dependencies: PlainLiquidDependency[];
	canEmit: boolean;
};

export type BuildPlainLiquidResult = CompilePlainLiquidResult & {
	emitted: { files: { path: string; contents: string }[]; issues: [] };
	issues: Diagnostic[];
	emittedOnError: boolean;
};

type LiquidTagLike = {
	name?: unknown;
	markup?: unknown;
	position: { start: number; end: number };
};

type RenderMarkupLike = {
	type: "RenderMarkup";
	snippet?: unknown;
};

type DependencyExtraction =
	| { kind: "static"; name: string }
	| { kind: "dynamic" }
	| { kind: "layout-none" }
	| { kind: "unsupported" };

export function parsePlainLiquid(
	source: string,
	file: string,
	options: PlainLiquidOptions = {},
): PlainLiquidAst {
	const parseMode = options.parseMode ?? "strict";
	const diagnostics: Diagnostic[] = [];
	let ast: DocumentNode;
	let factsCollected = true;
	const analysisSource = sourceForLiquidAnalysis(source);
	try {
		if (parseMode === "liquid-only") {
			const liquidOnlySource = sourceForLiquidOnlyAnalysis(analysisSource);
			const collapsed = collapseMaskedSource(liquidOnlySource);
			if (containsLiquidSyntax(collapsed.text)) {
				ast = toLiquidAST(collapsed.text, {
					mode: "tolerant",
					allowUnclosedDocumentNode: true,
				});
				remapLiquidPositions(ast, collapsed.map);
			} else {
				ast = emptyAst();
			}
			const unclosedBlock = findUnclosedLiquidBlock(ast);
			if (unclosedBlock) {
				throw new Error(`Unclosed Liquid ${unclosedBlock} block`);
			}
		} else {
			ast = toLiquidHtmlAST(analysisSource, {
				mode: "strict",
				allowUnclosedDocumentNode: false,
			});
		}
	} catch (error) {
		factsCollected = false;
		diagnostics.push(parseLiquidError(error, file));
		diagnostics.push(plainLiquidFactsSkipped(file));
		ast = emptyAst();
	}

	const schema = factsCollected
		? extractAuthoredSchema(ast, source, file)
		: undefined;
	const settingsScan = factsCollected
		? scanSettingsReadsFromLiquidAst(ast, source, file)
		: { reads: [], diagnostics: [] };
	const dependencyCollection = factsCollected
		? collectDependencies(ast, source, file)
		: { dependencies: [], diagnostics: [] };
	diagnostics.push(
		...settingsScan.diagnostics,
		...dependencyCollection.diagnostics,
	);

	return {
		file,
		liquidAst: ast,
		nodes: [],
		schema,
		settingsReads: settingsScan.reads,
		dependencies: dependencyCollection.dependencies,
		diagnostics,
		notes: [],
		factsCollected,
		parseMode,
	};
}

/**
 * HTML script/style bodies from page builders can contain megabytes of
 * generated CSS/JavaScript. LiquidHTML parsing that syntax as raw text is
 * needlessly expensive. Blank non-Liquid body text while preserving length,
 * newlines, tags, and Liquid expressions, so all source offsets remain exact.
 */
function sourceForLiquidAnalysis(source: string): string {
	return source.replace(
		/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
		(block) => {
			const bodyStart = block.indexOf(">");
			const bodyEnd = block.lastIndexOf("</");
			if (bodyStart < 0 || bodyEnd <= bodyStart) return block;
			const start = block.slice(0, bodyStart + 1);
			const body = block.slice(bodyStart + 1, bodyEnd);
			const end = block.slice(bodyEnd);
			return `${start}${blankNonLiquidCharacters(body)}${end}`;
		},
	);
}

/**
 * Page builders publish megabytes of generated markup as `.liquid` files, many
 * chunks of which hold no Liquid at all. Once masking has run, a source without
 * `{{` or `{%` can only parse into text nodes, so every AST-derived fact —
 * schema, settings reads, dependencies, expression facts — is necessarily
 * empty. Skipping the parse is an optimization, not a policy: no fact that the
 * parse could have produced is lost. Textual capability heuristics run against
 * the raw source elsewhere and are unaffected.
 */
function findUnclosedLiquidBlock(ast: DocumentNode): string | undefined {
	let unclosed: string | undefined;
	walk(ast, (node) => {
		if (unclosed || !isLiquidTag(node)) return;
		const blockEnd = (node as { blockEndPosition?: { start?: unknown } })
			.blockEndPosition;
		if (blockEnd?.start === -1 && typeof node.name === "string") {
			unclosed = node.name;
		}
	});
	return unclosed;
}

function containsLiquidSyntax(maskedSource: string): boolean {
	return maskedSource.includes("{{") || maskedSource.includes("{%");
}

/**
 * Bodies that carry meaning even though they are not Liquid expressions, and so
 * must survive masking: authored schema, and `{% doc %}` annotations, whose
 * `@param` lines are the declared component contract.
 */
const PRESERVED_BLOCK_BODIES = [
	/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/gi,
	/{%-?\s*doc\s*-?%}[\s\S]*?{%-?\s*enddoc\s*-?%}/gi,
];

function sourceForLiquidOnlyAnalysis(source: string): string {
	let masked = blankNonLiquidCharacters(source);
	for (const pattern of PRESERVED_BLOCK_BODIES) {
		for (const match of source.matchAll(pattern)) {
			const start = match.index ?? 0;
			masked = `${masked.slice(0, start)}${match[0]}${masked.slice(start + match[0].length)}`;
		}
	}
	return masked;
}

/**
 * The regions of a source that liquid-only analysis must actually parse: every
 * Liquid tag or output, plus the block bodies that carry meaning of their own.
 * Everything between them is masked to blanks and holds no fact.
 */
function liquidRegionsOf(source: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const match of source.matchAll(/{{-?[\s\S]*?-?}}|{%-?[\s\S]*?-?%}/g)) {
		const start = match.index ?? 0;
		ranges.push([start, start + match[0].length]);
	}
	for (const pattern of PRESERVED_BLOCK_BODIES) {
		for (const match of source.matchAll(pattern)) {
			const start = match.index ?? 0;
			ranges.push([start, start + match[0].length]);
		}
	}
	ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged.at(-1);
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
			continue;
		}
		merged.push([range[0], range[1]]);
	}
	return merged;
}

/**
 * Maps offsets in a collapsed source back to the original. Segments are sorted
 * by collapsed offset, so a lookup is a binary search.
 */
export type LiquidOffsetMap = {
	collapsedStarts: number[];
	originalStarts: number[];
	lengths: number[];
};

/**
 * Masking blanks non-Liquid characters but keeps their bytes, so a 200KB
 * generated chunk still hands the parser 200KB of mostly spaces. Collapsing
 * those runs is what makes the parser's cost proportional to the Liquid in a
 * file rather than to the file. Positions come back in collapsed coordinates,
 * so every span is remapped before anything reads the tree — see
 * remapLiquidPositions.
 */
function collapseMaskedSource(source: string): {
	text: string;
	map: LiquidOffsetMap;
} {
	const regions = liquidRegionsOf(source);
	const map: LiquidOffsetMap = {
		collapsedStarts: [],
		originalStarts: [],
		lengths: [],
	};
	let text = "";
	for (const [start, end] of regions) {
		// One newline stands in for the blanked gap: it keeps adjacent tags from
		// fusing into one token and costs a single character.
		if (text.length > 0) {
			map.collapsedStarts.push(text.length);
			map.originalStarts.push(start);
			map.lengths.push(1);
			text += "\n";
		}
		map.collapsedStarts.push(text.length);
		map.originalStarts.push(start);
		map.lengths.push(end - start);
		text += source.slice(start, end);
	}
	return { text, map };
}

function originalOffsetOf(map: LiquidOffsetMap, offset: number): number {
	const { collapsedStarts, originalStarts, lengths } = map;
	if (collapsedStarts.length === 0) return offset;
	let low = 0;
	let high = collapsedStarts.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if ((collapsedStarts[middle] as number) <= offset) low = middle;
		else high = middle - 1;
	}
	const collapsedStart = collapsedStarts[low] as number;
	const originalStart = originalStarts[low] as number;
	const length = lengths[low] as number;
	// Clamp to the segment: an offset past its end is the gap that follows, and
	// the original position that best describes it is the segment's end.
	return originalStart + Math.min(offset - collapsedStart, length);
}

/**
 * Rewrites every `{ start, end }` pair in a parsed tree from collapsed
 * coordinates to original ones. Position shapes are found structurally rather
 * than by field name, so a node carrying a position this code has never heard
 * of is remapped too.
 */
function remapLiquidPositions(root: unknown, map: LiquidOffsetMap): void {
	const visit = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const record = value as Record<string, unknown>;
		if (
			typeof record.start === "number" &&
			typeof record.end === "number" &&
			record.start >= 0
		) {
			const start = originalOffsetOf(map, record.start);
			// `end` is exclusive. Resolving it directly lands on the separator that
			// follows a region and reports the next region's start; resolve the last
			// included character instead and step past it.
			record.end =
				record.end > record.start
					? originalOffsetOf(map, record.end - 1) + 1
					: start;
			record.start = start;
		}
		// for-in rather than Object.entries: this runs over every node of every
		// parsed file, and the entries array is pure allocation. parentNode is a
		// back-reference that would cycle; source is the collapsed text, which
		// nothing downstream reads.
		for (const key in record) {
			if (key === "parentNode" || key === "source") continue;
			visit(record[key]);
		}
	};
	visit(root);
}

function blankNonLiquidCharacters(source: string): string {
	let result = "";
	let offset = 0;
	for (const match of source.matchAll(/{{-?[\s\S]*?-?}}|{%-?[\s\S]*?-?%}/g)) {
		const index = match.index ?? offset;
		result += source.slice(offset, index).replace(/[^\n\r]/g, " ");
		result += match[0];
		offset = index + match[0].length;
	}
	return result + source.slice(offset).replace(/[^\n\r]/g, " ");
}

function plainLiquidFactsSkipped(file: string): Diagnostic {
	const position = { line: 1, column: 1 };
	return {
		severity: "info",
		code: "PLAIN_LIQUID_FACTS_SKIPPED",
		message:
			"Plain Liquid schema, settings, and dependency facts were not collected because parsing failed",
		span: { file, start: position, end: position },
	};
}

function invalidDependencyName(
	kind: PlainLiquidDependencyKind,
	name: string,
	span: SourceSpan,
	reason: string,
): Diagnostic {
	return {
		severity: "error",
		code: "PLAIN_LIQUID_INVALID_DEPENDENCY_NAME",
		message: `Invalid ${kind} dependency name "${name}": ${reason}`,
		span,
	};
}

function unsupportedDependencyMarkup(
	kind: PlainLiquidDependencyKind,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "PLAIN_LIQUID_UNSUPPORTED_DEPENDENCY_MARKUP",
		message: `Could not classify ${kind} dependency markup; dependency facts are incomplete`,
		span,
	};
}

function emptyAst(): DocumentNode {
	return toLiquidHtmlAST("", {
		mode: "tolerant",
		allowUnclosedDocumentNode: true,
	});
}

function collectDependencies(
	ast: DocumentNode,
	source: string,
	file: string,
): { dependencies: PlainLiquidDependency[]; diagnostics: Diagnostic[] } {
	const dependencies: PlainLiquidDependency[] = [];
	const diagnostics: Diagnostic[] = [];
	walk(ast, (node) => {
		if (!isLiquidTag(node)) return;
		if (typeof node.name !== "string") return;
		if (!isDependencyTag(node.name)) return;

		const kind = dependencyKind(node.name);
		const extraction = dependencyExtraction(kind, node.markup);
		const span = spanFromOffsets(source, file, node.position);
		if (extraction.kind === "unsupported") {
			diagnostics.push(unsupportedDependencyMarkup(kind, span));
		}
		const name = dependencyName(extraction);
		const validation = name
			? validateDependencyName(kind, name)
			: { valid: true as const };
		if (!validation.valid) {
			diagnostics.push(
				invalidDependencyName(kind, name ?? "", span, validation.reason),
			);
		}
		dependencies.push({
			kind,
			invocationKind:
				node.name === "render" || node.name === "include"
					? node.name
					: undefined,
			name,
			path: name && validation.valid ? dependencyPath(kind, name) : undefined,
			source: liquidTagMarkup(source, node.position, node.name),
			static: extraction.kind === "static" || extraction.kind === "layout-none",
			span,
		});
	});
	return { dependencies, diagnostics };
}

function isLiquidTag(node: unknown): node is LiquidTagLike {
	return (
		!!node &&
		(node as { type?: unknown }).type === NodeTypes.LiquidTag &&
		typeof (node as { position?: { start?: unknown; end?: unknown } }).position
			?.start === "number" &&
		typeof (node as { position?: { start?: unknown; end?: unknown } }).position
			?.end === "number"
	);
}

function dependencyExtraction(
	kind: PlainLiquidDependencyKind,
	markup: unknown,
): DependencyExtraction {
	const target = isRenderMarkup(markup) ? markup.snippet : markup;
	if (isLiquidString(target)) return { kind: "static", name: target.value };
	if (isVariableLookup(target)) {
		if (kind === "layout" && target.name === "none") {
			return { kind: "layout-none" };
		}
		return { kind: "dynamic" };
	}
	return { kind: "unsupported" };
}

function dependencyName(extraction: DependencyExtraction): string | undefined {
	if (extraction.kind === "static") return extraction.name;
	if (extraction.kind === "layout-none") return "none";
	return undefined;
}

function isRenderMarkup(markup: unknown): markup is RenderMarkupLike {
	return !!markup && (markup as { type?: unknown }).type === "RenderMarkup";
}

function isDependencyTag(tagName: string): boolean {
	return (
		tagName === "render" ||
		tagName === "include" ||
		tagName === "section" ||
		tagName === "sections" ||
		tagName === "layout"
	);
}

function dependencyKind(tagName: string): PlainLiquidDependencyKind {
	if (tagName === "render" || tagName === "include") return "snippet";
	if (tagName === "section") return "section";
	if (tagName === "sections") return "section-group";
	return "layout";
}

function validateDependencyName(
	kind: PlainLiquidDependencyKind,
	name: string,
): { valid: true } | { valid: false; reason: string } {
	if (kind === "layout" && name === "none") return { valid: true };
	if (name.trim() !== name || name.length === 0) {
		return { valid: false, reason: "must be a non-empty trimmed name" };
	}
	if (name.startsWith("/") || name.includes("..")) {
		return {
			valid: false,
			reason: "must not contain traversal or absolute paths",
		};
	}
	if (/[\\/]/.test(name)) {
		return { valid: false, reason: "must not contain path separators" };
	}
	if (/\.(liquid|json)$/i.test(name)) {
		return { valid: false, reason: "must omit theme file extensions" };
	}
	return { valid: true };
}

function dependencyPath(
	kind: PlainLiquidDependencyKind,
	name: string,
): string | undefined {
	if (kind === "layout" && name === "none") return undefined;
	if (kind === "snippet") return `snippets/${name}.liquid`;
	if (kind === "section") return `sections/${name}.liquid`;
	if (kind === "section-group") return `sections/${name}.json`;
	return `layout/${name}.liquid`;
}
