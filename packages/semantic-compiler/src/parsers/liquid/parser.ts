import type Parser from "tree-sitter";
import Html from "tree-sitter-html";
import type {
	ParsedDocument,
	ParserDiagnostic,
	ParserInput,
	ParserProvider,
	ParserResult,
	SourceRange,
} from "../parser.js";
import {
	createTreeSitterParser,
	parseTreeSitterSource,
	treeSitterDiagnostics,
} from "../tree-sitter.js";
import Liquid from "./grammar.cjs";

export type LiquidDocument = ParsedDocument<Parser.Tree> & {
	markupSyntax: Parser.Tree;
	markupDynamicRanges: readonly SourceRange[];
	markupDiagnostics: readonly ParserDiagnostic[];
};

export class LiquidParserProvider implements ParserProvider<LiquidDocument> {
	readonly id = "tree-sitter-liquid";
	readonly version = 2;
	readonly languages = ["liquid"] as const;

	readonly #parser = createTreeSitterParser(Liquid);
	readonly #markupParser = createTreeSitterParser(Html);

	accepts(path: string, language?: string): boolean {
		return language === "liquid" || (!language && path.endsWith(".liquid"));
	}

	parse(input: ParserInput): ParserResult<LiquidDocument> {
		const syntax = parseTreeSitterSource(this.#parser, input.source);
		const { source: markupSource, dynamicRanges } = markupProjection(
			input.source,
			syntax,
		);
		const markupSyntax = parseTreeSitterSource(
			this.#markupParser,
			markupSource,
		);
		const markupDiagnostics = treeSitterDiagnostics(
			markupSyntax,
			input.source,
			"Liquid markup",
		).filter((diagnostic) =>
			markupDiagnosticAffectsAttributes(input.source, diagnostic.range),
		);
		return {
			ok: true,
			document: {
				path: input.path,
				language: "liquid",
				source: input.source,
				syntax,
				diagnostics: treeSitterDiagnostics(syntax, input.source, "Liquid"),
				markupSyntax,
				markupDynamicRanges: dynamicRanges,
				markupDiagnostics,
			},
		};
	}
}

function markupDiagnosticAffectsAttributes(
	source: string,
	range: SourceRange,
): boolean {
	const excerpt = source.slice(range.start, range.end);
	return /<[A-Za-z][^<>]*(?:>|$)/.test(excerpt);
}

function markupProjection(
	source: string,
	tree: Parser.Tree,
): { source: string; dynamicRanges: SourceRange[] } {
	const retained: SourceRange[] = [];
	collectTemplateContent(tree.rootNode, retained);
	retained.sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	const merged: SourceRange[] = [];
	for (const range of retained) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end);
		} else {
			merged.push({ ...range });
		}
	}
	const characters: string[] = Array.from(
		{ length: source.length },
		(_, index) => {
			const character = source[index] ?? " ";
			return character === "\n" || character === "\r" ? character : "x";
		},
	);
	for (const range of merged) {
		for (let index = range.start; index < range.end; index += 1) {
			characters[index] = source[index] ?? " ";
		}
	}
	const dynamicRanges: SourceRange[] = [];
	let position = 0;
	for (const range of merged) {
		if (position < range.start)
			dynamicRanges.push({ start: position, end: range.start });
		position = Math.max(position, range.end);
	}
	if (position < source.length)
		dynamicRanges.push({ start: position, end: source.length });
	return { source: characters.join(""), dynamicRanges };
}

function collectTemplateContent(
	node: Parser.SyntaxNode,
	ranges: SourceRange[],
): void {
	if (node.type === "template_content") {
		ranges.push({ start: node.startIndex, end: node.endIndex });
		return;
	}
	for (const child of node.namedChildren) collectTemplateContent(child, ranges);
}
