import Parser from "tree-sitter";
import Html from "tree-sitter-html";
import { parseTreeText } from "../parser-input.js";
import { walkNamedNodes as walk } from "../tree-sitter-walk.js";
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

export type HtmlMarkupHookFact = {
	kind: "class" | "id" | "attribute" | "customElement";
	name: string;
	range: SourceRange;
};

export type HtmlMarkupUncertainty = {
	kind: "class" | "id" | "attribute";
	range: SourceRange;
};

export type HtmlMarkupFacts = {
	hooks: HtmlMarkupHookFact[];
	uncertainty: HtmlMarkupUncertainty[];
};

/**
 * Facts and diagnostics both read the same masked HTML view of a document, and
 * building it means a second parse of every theme file. Documents are replaced
 * rather than mutated on edit, so the tree can be kept alongside one.
 */
const htmlTrees = new WeakMap<SourceDocument, Parser.Tree>();
let htmlParser: Parser | undefined;

function htmlTree(document: SourceDocument): Parser.Tree {
	const cached = htmlTrees.get(document);
	if (cached) return cached;
	if (!htmlParser) {
		htmlParser = new Parser();
		htmlParser.setLanguage(Html);
	}
	const tree = parseTreeText(htmlParser, maskedHtmlSource(document));
	htmlTrees.set(document, tree);
	return tree;
}

/** Static DOM contracts from HTML regions of a Liquid source document. */
export function htmlMarkupFacts(document: SourceDocument): HtmlMarkupFacts {
	const tree = htmlTree(document);
	const hooks: HtmlMarkupHookFact[] = [];
	const uncertainty: HtmlMarkupUncertainty[] = [];
	walk(tree.rootNode, (walked) => {
		if (walked.type !== "start_tag" && walked.type !== "self_closing_tag") {
			return;
		}
		const node = walked.node();
		const tagNameNode = node.namedChildren.find(
			(child) => child.type === "tag_name",
		);
		const tagName = tagNameNode?.text;
		if (tagName?.includes("-") && tagNameNode) {
			hooks.push({
				kind: "customElement",
				name: tagName.toLowerCase(),
				range: nodeRange(tagNameNode),
			});
		}
		for (const attribute of node.namedChildren.filter(
			(child) => child.type === "attribute",
		)) {
			const nameNode = attribute.namedChildren.find(
				(child) => child.type === "attribute_name",
			);
			const name = nameNode?.text.toLowerCase();
			if (!name || !nameNode) continue;
			const valueNode = attribute.namedChildren.find(
				(child) =>
					child.type === "quoted_attribute_value" ||
					child.type === "attribute_value",
			);
			const rawValue = valueNode
				? unquote(
						document.source.slice(valueNode.startIndex, valueNode.endIndex),
					)
				: undefined;
			const dynamic = rawValue ? containsLiquid(rawValue) : false;
			if (name === "class" && rawValue !== undefined) {
				for (const className of staticClassNames(rawValue)) {
					hooks.push({
						kind: "class",
						name: className,
						range: nodeRange(valueNode ?? attribute),
					});
				}
				if (dynamic)
					uncertainty.push({ kind: "class", range: nodeRange(attribute) });
				continue;
			}
			if (name === "id" && rawValue !== undefined) {
				if (dynamic) {
					uncertainty.push({ kind: "id", range: nodeRange(attribute) });
				} else if (rawValue.trim()) {
					hooks.push({
						kind: "id",
						name: rawValue.trim(),
						range: nodeRange(valueNode ?? attribute),
					});
				}
				continue;
			}
			if (name.startsWith("data-")) {
				hooks.push({
					kind: "attribute",
					name,
					range: nodeRange(nameNode),
				});
			}
		}
	});
	return { hooks, uncertainty };
}

/** Strict HTML diagnostics over Liquid template-content regions. */
export function htmlSyntaxIssues(
	document: SourceDocument,
): readonly SourceParseIssue[] {
	const tree = htmlTree(document);
	const issues: SourceParseIssue[] = [];
	walk(tree.rootNode, (walked) => {
		if (
			walked.type !== "ERROR" &&
			walked.type !== "element" &&
			!walked.isMissing
		) {
			return;
		}
		const node = walked.node();
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
	const source = document.source;
	const parts: string[] = [];
	let cursor = 0;
	walk(document.tree.rootNode, (walked) => {
		if (walked.type !== "template_content") return;
		const node = walked.node();
		// Pre-order walk yields ascending starts; a nested region is already
		// covered by the enclosing one that was emitted first.
		if (node.startIndex < cursor) return;
		parts.push(blankOutside(source.slice(cursor, node.startIndex)));
		parts.push(source.slice(node.startIndex, node.endIndex));
		cursor = node.endIndex;
	});
	parts.push(blankOutside(source.slice(cursor)));
	return parts.join("");
}

/** Keeps offsets and line breaks, drops everything HTML must not see. */
function blankOutside(text: string): string {
	return text.replace(/[^\n\r]/g, " ");
}

function containsLiquid(value: string): boolean {
	return value.includes("{{") || value.includes("{%") || value.includes("{#");
}

function staticClassNames(value: string): string[] {
	const marker = "\u0000";
	const withoutLiquid = value.replace(
		/({{[\s\S]*?}}|{%[\s\S]*?%}|{#[\s\S]*?#})/g,
		marker,
	);
	return withoutLiquid
		.split(/\s+/)
		.filter((token) => token.length > 0 && !token.includes(marker));
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
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
