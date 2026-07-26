import type Parser from "tree-sitter";
import type { SourceDocument, SourceRange } from "../types.js";

export type LiquidDependencyKind =
	| "snippet"
	| "section"
	| "section-group"
	| "layout";

export type LiquidSyntaxDependency = {
	kind: LiquidDependencyKind;
	invocationKind?: "render" | "include";
	name?: string;
	range: SourceRange;
};

export type LiquidSyntaxSettingsRead = {
	object: "settings" | "section" | "block";
	name: string;
	range: SourceRange;
};

export type LiquidSyntaxSchema = {
	body: string;
	bodyRange: SourceRange;
	range: SourceRange;
};

export type LiquidSyntaxFacts = {
	/** False means callers must not derive semantic facts from partial syntax. */
	authoritative: boolean;
	dependencies: readonly LiquidSyntaxDependency[];
	settingsReads: readonly LiquidSyntaxSettingsRead[];
	schema?: LiquidSyntaxSchema;
};

const dependencyNodes = new Map<
	string,
	{ kind: LiquidDependencyKind; invocationKind?: "render" | "include" }
>([
	["render_statement", { kind: "snippet", invocationKind: "render" }],
	["include_statement", { kind: "snippet", invocationKind: "include" }],
	["section_statement", { kind: "section" }],
	["sections_statement", { kind: "section-group" }],
	["layout_statement", { kind: "layout" }],
]);

const rawAncestors = new Set([
	"schema_statement",
	"raw_statement",
	"style_statement",
	"stylesheet_statement",
	"javascript_statement",
	"comment",
]);

/** Mechanical Liquid CST facts; no Shopify/theme policy belongs here. */
export function liquidSyntaxFacts(document: SourceDocument): LiquidSyntaxFacts {
	if (document.language !== "liquid") {
		throw new Error(`Liquid syntax adapter cannot read ${document.language}`);
	}
	if (document.issues.length > 0) {
		return { authoritative: false, dependencies: [], settingsReads: [] };
	}

	const dependencies: LiquidSyntaxDependency[] = [];
	const settingsReads: LiquidSyntaxSettingsRead[] = [];
	let schema: LiquidSyntaxSchema | undefined;
	walk(document.tree.rootNode, (node) => {
		const dependency = dependencyNodes.get(node.type);
		if (dependency) {
			const string = node.namedChildren.find(
				(child) => child.type === "string",
			);
			const name =
				string !== undefined
					? unquote(string.text)
					: node.type === "layout_statement" && /\bnone\s*$/.test(node.text)
						? "none"
						: undefined;
			dependencies.push({
				kind: dependency.kind,
				invocationKind: dependency.invocationKind,
				name,
				range: enclosingTagRange(document.source, node),
			});
		}

		if (node.type === "schema_statement" && !schema) {
			schema = schemaFromNode(document.source, node);
		}

		if (
			node.type === "access" &&
			node.parent?.type !== "access" &&
			!hasRawAncestor(node)
		) {
			const lookup = accessPath(node);
			if (!lookup) return;
			if (lookup.root === "settings" && lookup.path[0]) {
				settingsReads.push({
					object: "settings",
					name: lookup.path[0],
					range: { start: node.startIndex, end: node.endIndex },
				});
			} else if (
				(lookup.root === "section" || lookup.root === "block") &&
				lookup.path[0] === "settings" &&
				lookup.path[1]
			) {
				settingsReads.push({
					object: lookup.root,
					name: lookup.path[1],
					range: { start: node.startIndex, end: node.endIndex },
				});
			}
		}
	});
	return { authoritative: true, dependencies, settingsReads, schema };
}

function walk(
	node: Parser.SyntaxNode,
	visit: (node: Parser.SyntaxNode) => void,
): void {
	visit(node);
	for (const child of node.namedChildren) walk(child, visit);
}

function accessPath(
	node: Parser.SyntaxNode,
): { root: string; path: string[] } | undefined {
	if (node.type === "identifier") return { root: node.text, path: [] };
	if (node.type !== "access") return undefined;
	const receiver = node.childForFieldName("receiver");
	const property = node.childForFieldName("property");
	if (!receiver || !property) return undefined;
	const parent = accessPath(receiver);
	return parent
		? { root: parent.root, path: [...parent.path, property.text] }
		: undefined;
}

function hasRawAncestor(node: Parser.SyntaxNode): boolean {
	let parent = node.parent;
	while (parent) {
		if (rawAncestors.has(parent.type)) return true;
		parent = parent.parent;
	}
	return false;
}

function enclosingTagRange(
	source: string,
	node: Parser.SyntaxNode,
): SourceRange {
	const start = source.lastIndexOf("{%", node.startIndex);
	const close = source.indexOf("%}", node.endIndex);
	if (start < 0 || close < 0)
		return { start: node.startIndex, end: node.endIndex };
	return { start, end: close + 2 };
}

function schemaFromNode(
	source: string,
	node: Parser.SyntaxNode,
): LiquidSyntaxSchema {
	const range = { start: node.startIndex, end: node.endIndex };
	const openEnd = source.indexOf("%}", node.startIndex);
	const closeStart = source.lastIndexOf("{%", node.endIndex);
	const bodyRange = {
		start: openEnd < 0 ? node.startIndex : openEnd + 2,
		end: closeStart < 0 ? node.endIndex : closeStart,
	};
	return {
		body: source.slice(bodyRange.start, bodyRange.end),
		bodyRange,
		range,
	};
}

function unquote(value: string): string {
	return value.length >= 2 ? value.slice(1, -1) : value;
}
