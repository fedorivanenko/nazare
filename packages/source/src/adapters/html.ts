import Parser from "tree-sitter";
import Html from "tree-sitter-html";
import { parseTreeText } from "../parser-input.js";
import type {
	SourceDocument,
	SourceParseIssue,
	SourceRange,
} from "../types.js";

const voidElements = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

/** Strict HTML diagnostics over Liquid template-content regions. */
export function htmlSyntaxIssues(
	document: SourceDocument,
): readonly SourceParseIssue[] {
	const parser = new Parser();
	parser.setLanguage(Html);
	const tree = parseTreeText(parser, maskedHtmlSource(document));
	const issues: SourceParseIssue[] = [];
	walk(tree.rootNode, (node) => {
		if (node.type === "ERROR" || node.isMissing) {
			issues.push({
				code: node.isMissing ? "TREE_SITTER_MISSING" : "TREE_SITTER_ERROR",
				range: nodeRange(node),
				message: node.isMissing
					? `Missing HTML ${node.type}`
					: `Unexpected HTML syntax: ${document.source.slice(node.startIndex, node.endIndex)}`,
			});
			return;
		}
		if (node.type !== "element") return;
		const startTag = node.namedChildren.find(
			(child) => child.type === "start_tag",
		);
		if (!startTag) return;
		const name = startTag.namedChildren.find(
			(child) => child.type === "tag_name",
		)?.text;
		if (!name || voidElements.has(name.toLowerCase())) return;
		const endTag = node.namedChildren.find((child) => child.type === "end_tag");
		if (endTag) return;
		issues.push({
			code: "TREE_SITTER_MISSING",
			range: nodeRange(startTag),
			message: `Missing HTML closing tag for <${name}>`,
		});
	});
	return dedupeIssues(issues);
}

function maskedHtmlSource(document: SourceDocument): string {
	const masked: string[] = document.source
		.split("")
		.map((character) =>
			character === "\n" || character === "\r" ? character : " ",
		);
	walk(document.tree.rootNode, (node) => {
		if (node.type !== "template_content") return;
		for (let offset = node.startIndex; offset < node.endIndex; offset += 1) {
			masked[offset] = document.source[offset] as string;
		}
	});
	return masked.join("");
}

function dedupeIssues(issues: SourceParseIssue[]): SourceParseIssue[] {
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = `${issue.code}:${issue.range.start}:${issue.range.end}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function nodeRange(node: Parser.SyntaxNode): SourceRange {
	return { start: node.startIndex, end: node.endIndex };
}

function walk(
	node: Parser.SyntaxNode,
	visit: (node: Parser.SyntaxNode) => void,
): void {
	visit(node);
	for (const child of node.namedChildren) walk(child, visit);
}
