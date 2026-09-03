import Parser from "tree-sitter";
import type { ParserDiagnostic } from "./parser.js";

const PARSE_CHUNK_SIZE = 16_384;

export function createTreeSitterParser(language: unknown): Parser {
	const parser = new Parser();
	parser.setLanguage(language);
	return parser;
}

export function parseTreeSitterSource(
	parser: Parser,
	source: string,
): Parser.Tree {
	return parser.parse((index) =>
		index >= source.length
			? null
			: source.slice(index, index + PARSE_CHUNK_SIZE),
	);
}

export function treeSitterDiagnostics(
	tree: Parser.Tree,
	source: string,
	language: string,
): ParserDiagnostic[] {
	const diagnostics: ParserDiagnostic[] = [];
	const cursor = tree.walk();
	while (true) {
		if (cursor.nodeType === "ERROR" || cursor.nodeIsMissing) {
			const node = cursor.currentNode;
			diagnostics.push({
				code: cursor.nodeIsMissing
					? "TREE_SITTER_MISSING"
					: "TREE_SITTER_ERROR",
				message: cursor.nodeIsMissing
					? `Missing ${language} ${node.type}`
					: `Unexpected ${language} syntax: ${source.slice(node.startIndex, node.endIndex)}`,
				range: { start: node.startIndex, end: node.endIndex },
			});
		}
		if (cursor.gotoFirstChild()) continue;
		while (!cursor.gotoNextSibling()) {
			if (!cursor.gotoParent()) return diagnostics;
		}
	}
}
