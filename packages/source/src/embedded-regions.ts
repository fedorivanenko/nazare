import type Parser from "tree-sitter";
import { walkNamedNodes } from "./tree-sitter-walk.js";
import {
	DEFAULT_NAZARE_SCRIPT_LANGUAGE,
	type EmbeddedRegion,
} from "./types.js";

type BlockKind = "script" | "stylesheet";

const openTagPattern = /{%-?\s*(script|stylesheet)\b([\s\S]*?)-?%}/g;

export function collectEmbeddedRegions(
	source: string,
	tree: Parser.Tree,
): EmbeddedRegion[] {
	openTagPattern.lastIndex = 0;
	if (!openTagPattern.test(source)) return [];
	openTagPattern.lastIndex = 0;
	const regions: EmbeddedRegion[] = [];
	const representedOpenings = new Set<number>();

	walkNamedNodes(tree.rootNode, (node) => {
		if (
			node.type !== "nazare_script_statement" &&
			node.type !== "stylesheet_statement"
		) {
			return;
		}
		const kind: BlockKind =
			node.type === "nazare_script_statement" ? "script" : "stylesheet";
		const boundaries = pairedBlockBoundaries(source, node, kind);
		const language = languageOfPairedBlock(node, kind);
		if (!language) return;
		const body = node.childForFieldName("body");
		regions.push({
			language,
			bodyRange: body
				? { start: body.startIndex, end: body.endIndex }
				: { start: boundaries.openEnd, end: boundaries.closeStart },
			openRange: {
				start: boundaries.openStart,
				end: boundaries.openEnd,
			},
			closeRange: {
				start: boundaries.closeStart,
				end: boundaries.closeEnd,
			},
		});
		representedOpenings.add(boundaries.openStart);
	});

	openTagPattern.lastIndex = 0;
	for (const match of source.matchAll(openTagPattern)) {
		const openStart = match.index;
		if (representedOpenings.has(openStart)) continue;
		const kind = match[1] as BlockKind;
		const language = languageOfUnclosedBlock(kind, match[2]);
		if (!language || hasClosingTag(source, openStart + match[0].length, kind)) {
			continue;
		}
		regions.push({
			language,
			bodyRange: {
				start: openStart + match[0].length,
				end: source.length,
			},
			openRange: {
				start: openStart,
				end: openStart + match[0].length,
			},
		});
	}

	return regions.sort(
		(left, right) => left.openRange.start - right.openRange.start,
	);
}

function pairedBlockBoundaries(
	source: string,
	node: Parser.SyntaxNode,
	kind: BlockKind,
): {
	openStart: number;
	openEnd: number;
	closeStart: number;
	closeEnd: number;
} {
	const openStart = source.indexOf("{%", node.startIndex);
	const openCloser = source.indexOf("%}", openStart);
	const closeStart = source.lastIndexOf("{%", node.endIndex);
	const closeCloser = source.indexOf("%}", closeStart);
	if (
		openStart < 0 ||
		openCloser < openStart ||
		closeStart <= openCloser ||
		closeCloser < closeStart ||
		!hasClosingTagAt(source, closeStart, closeCloser + 2, kind)
	) {
		throw new Error(
			`Cannot locate ${kind} boundaries in authoritative ${node.type}`,
		);
	}
	return {
		openStart,
		openEnd: openCloser + 2,
		closeStart,
		closeEnd: closeCloser + 2,
	};
}

function languageOfPairedBlock(
	node: Parser.SyntaxNode,
	kind: BlockKind,
): EmbeddedRegion["language"] | undefined {
	if (kind === "stylesheet") return "css";
	const language = node.childForFieldName("language")?.text;
	if (language === undefined) return DEFAULT_NAZARE_SCRIPT_LANGUAGE;
	if (language === '"js"' || language === "'js'") return "javascript";
	if (language === '"ts"' || language === "'ts'") return "typescript";
	return undefined;
}

function languageOfUnclosedBlock(
	kind: BlockKind,
	attributes: string | undefined,
): EmbeddedRegion["language"] | undefined {
	if (kind === "stylesheet") return "css";
	const match = attributes?.match(/\blang\s*=\s*(["'])(js|ts)\1/);
	if (!match) return undefined;
	return match[2] === "ts" ? "typescript" : "javascript";
}

const CLOSING_TAG_PATTERNS: Record<BlockKind, RegExp> = {
	script: /\{%-?\s*endscript\s*-?%}/g,
	stylesheet: /\{%-?\s*endstylesheet\s*-?%}/g,
};

function hasClosingTag(
	source: string,
	start: number,
	kind: BlockKind,
): boolean {
	return findClosingTag(source, start, kind) !== null;
}

function hasClosingTagAt(
	source: string,
	start: number,
	end: number,
	kind: BlockKind,
): boolean {
	const match = findClosingTag(source, start, kind);
	return (
		match !== null &&
		match.index === start &&
		match.index + match[0].length === end
	);
}

function findClosingTag(
	source: string,
	start: number,
	kind: BlockKind,
): RegExpExecArray | null {
	const pattern = CLOSING_TAG_PATTERNS[kind];
	pattern.lastIndex = start;
	return pattern.exec(source);
}
