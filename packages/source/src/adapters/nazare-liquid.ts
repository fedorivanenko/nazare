import Parser from "tree-sitter";
import Html from "tree-sitter-html";
import { parseTreeText } from "../parser-input.js";
import type { SourceDocument, SourceRange } from "../types.js";

export type NazareComponentFact = {
	kind: "component";
	componentKind: "section" | "block" | "snippet";
	range: SourceRange;
};

export type NazareImportFact = {
	kind: "import";
	localName: string;
	specifier: string;
	range: SourceRange;
};

export type NazarePropsFact = {
	kind: "props";
	payload: string;
	payloadRange: SourceRange;
	range: SourceRange;
};

export type NazareRenderFact = {
	kind: "render";
	target: string;
	payload: string;
	payloadRange: SourceRange;
	reachability: "unconditional" | "conditional-unmodeled";
	range: SourceRange;
};

export type NazareBlocksFact = {
	kind: "blocks";
	blockNames: string[];
	range: SourceRange;
};

export type NazareScriptFact = {
	kind: "script";
	language: "javascript" | "typescript";
	body: string;
	bodyRange: SourceRange;
	range: SourceRange;
};

export type NazareStylesheetFact = {
	kind: "stylesheet";
	bindingName?: string;
	body: string;
	bodyRange: SourceRange;
	range: SourceRange;
};

export type NazareDataBindingFact = {
	attribute: string;
	property: string;
	expression: string;
	range: SourceRange;
};

export type NazareElementRefFact = {
	kind: "element-ref";
	name: string;
	tagName: string;
	dataBindings: NazareDataBindingFact[];
	range: SourceRange;
};

export type NazareRootMarkerFact = {
	kind: "root-marker";
	tagName: string;
	range: SourceRange;
};

export type NazareIslandFact = {
	kind: "island";
	name: string;
	tagName: string;
	range: SourceRange;
};

export type NazareReferenceFact = {
	kind: "reference";
	target: "prop" | "style";
	binding: string;
	name: string;
	form: "identifier" | "bare-class" | "quoted-class";
	range: SourceRange;
};

export type NazareSyntaxFact =
	| NazareComponentFact
	| NazareImportFact
	| NazarePropsFact
	| NazareRenderFact
	| NazareBlocksFact
	| NazareScriptFact
	| NazareStylesheetFact
	| NazareReferenceFact
	| NazareElementRefFact
	| NazareRootMarkerFact
	| NazareIslandFact;

export type NazareSyntaxFacts = {
	authoritative: boolean;
	facts: readonly NazareSyntaxFact[];
};

const conditionalNodes = new Set([
	"if_statement",
	"unless_statement",
	"case_statement",
	"for_loop_statement",
	"tablerow_statement",
]);

/** Mechanical Nazare declarations and references. Semantic meaning stays in compiler. */
export function nazareSyntaxFacts(document: SourceDocument): NazareSyntaxFacts {
	if (document.language !== "nazare-liquid") {
		throw new Error(`Nazare syntax adapter cannot read ${document.language}`);
	}
	if (document.issues.length > 0) return { authoritative: false, facts: [] };

	const facts: NazareSyntaxFact[] = [];
	const styleBindings = collectStyleBindings(document.tree.rootNode);
	walk(document.tree.rootNode, (node) => {
		const range = tagRange(document.source, node);
		if (node.type === "nazare_component_statement") {
			const componentKind = node.childForFieldName("kind")?.text;
			if (isComponentKind(componentKind)) {
				facts.push({ kind: "component", componentKind, range });
			}
			return;
		}
		if (node.type === "nazare_import_statement") {
			const localName = node.childForFieldName("local_name")?.text;
			const source = node.childForFieldName("source")?.text;
			if (localName && source) {
				facts.push({
					kind: "import",
					localName,
					specifier: unquote(source),
					range,
				});
			}
			return;
		}
		if (node.type === "nazare_props_statement") {
			const payload = node.childForFieldName("payload");
			if (payload) {
				facts.push({
					kind: "props",
					payload: payload.text,
					payloadRange: nodeRange(payload),
					range,
				});
			}
			return;
		}
		if (node.type === "nazare_render_statement") {
			const target = node.childForFieldName("target")?.text;
			const payload = node.childForFieldName("payload");
			if (target && payload) {
				facts.push({
					kind: "render",
					target,
					payload: payload.text,
					payloadRange: nodeRange(payload),
					reachability: hasConditionalAncestor(node)
						? "conditional-unmodeled"
						: "unconditional",
					range,
				});
				facts.push(
					...referencesInText(
						payload.text,
						payload.startIndex,
						styleBindings,
						"quoted-class",
					),
				);
			}
			return;
		}
		if (node.type === "nazare_blocks_statement") {
			facts.push({
				kind: "blocks",
				blockNames: node.childrenForFieldName("name").map((name) => name.text),
				range,
			});
			return;
		}
		if (node.type === "nazare_script_statement") {
			const body = node.childForFieldName("body");
			const language = unquote(
				node.childForFieldName("language")?.text ?? "js",
			);
			const bodyRange = body
				? nodeRange(body)
				: emptyBodyRange(document.source, node);
			facts.push({
				kind: "script",
				language: language === "ts" ? "typescript" : "javascript",
				body: document.source.slice(bodyRange.start, bodyRange.end),
				bodyRange,
				range: pairedTagRange(document.source, node),
			});
			return;
		}
		if (node.type === "stylesheet_statement") {
			const body = node.childForFieldName("body");
			const bodyRange = body
				? nodeRange(body)
				: emptyBodyRange(document.source, node);
			facts.push({
				kind: "stylesheet",
				bindingName: node.childForFieldName("binding")?.text,
				body: document.source.slice(bodyRange.start, bodyRange.end),
				bodyRange,
				range: pairedTagRange(document.source, node),
			});
			return;
		}
		if (
			node.type === "access" &&
			node.parent?.type !== "access" &&
			!hasRawAncestor(node)
		) {
			const lookup = accessPath(node);
			if (!lookup || lookup.path.length === 0) return;
			if (lookup.root === "props") {
				facts.push({
					kind: "reference",
					target: "prop",
					binding: "props",
					name: lookup.path[0] as string,
					form: "identifier",
					range: nodeRange(node),
				});
			} else if (styleBindings.has(lookup.root)) {
				const output = enclosingOutput(document.source, node);
				facts.push({
					kind: "reference",
					target: "style",
					binding: lookup.root,
					name: lookup.path[0] as string,
					form: output ? "bare-class" : "quoted-class",
					range: output ?? nodeRange(node),
				});
			}
		}
	});
	facts.push(...htmlFacts(document));
	return {
		authoritative: true,
		facts: facts.sort((left, right) => left.range.start - right.range.start),
	};
}

function htmlFacts(document: SourceDocument): NazareSyntaxFact[] {
	const masked = maskedHtmlSource(document);
	const parser = new Parser();
	parser.setLanguage(Html);
	const tree = parseTreeText(parser, masked);
	const facts: NazareSyntaxFact[] = [];
	walk(tree.rootNode, (node) => {
		if (node.type !== "start_tag" && node.type !== "self_closing_tag") return;
		const tagName = node.namedChildren.find(
			(child) => child.type === "tag_name",
		)?.text;
		if (!tagName) return;
		const attributes = node.namedChildren.filter(
			(child) => child.type === "attribute",
		);
		const dataBindings = attributes.flatMap((attribute) =>
			dataBindingFromAttribute(document.source, attribute),
		);
		for (const attribute of attributes) {
			const name = attribute.namedChildren.find(
				(child) => child.type === "attribute_name",
			)?.text;
			if (name !== "ref" && name !== "island" && name !== "nz-root") continue;
			const range = nodeRange(attribute);
			if (name === "nz-root") {
				facts.push({ kind: "root-marker", tagName, range });
				continue;
			}
			const value = staticAttributeValue(document.source, attribute);
			if (!value || !/^[A-Za-z_$][\w$]*$/.test(value)) continue;
			if (name === "ref") {
				facts.push({
					kind: "element-ref",
					name: value,
					tagName,
					dataBindings,
					range,
				});
			} else {
				facts.push({ kind: "island", name: value, tagName, range });
			}
		}
	});
	return facts;
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

function staticAttributeValue(
	source: string,
	attribute: Parser.SyntaxNode,
): string | undefined {
	const raw = source.slice(attribute.startIndex, attribute.endIndex);
	const equals = raw.indexOf("=");
	if (equals < 0) return undefined;
	const value = raw.slice(equals + 1).trim();
	if (value.includes("{{") || value.includes("{%")) return undefined;
	return unquote(value);
}

function dataBindingFromAttribute(
	source: string,
	attribute: Parser.SyntaxNode,
): NazareDataBindingFact[] {
	const name = attribute.namedChildren.find(
		(child) => child.type === "attribute_name",
	)?.text;
	if (!name?.startsWith("data-") || name === "data-nz-ref") return [];
	const raw = source.slice(attribute.startIndex, attribute.endIndex);
	const equals = raw.indexOf("=");
	if (equals < 0) return [];
	const expression = raw
		.slice(equals + 1)
		.match(/^\s*["']?\s*{{-?\s*([\s\S]*?)\s*-?}}\s*["']?\s*$/)?.[1]
		?.trim();
	if (!expression) return [];
	const suffix = name.slice(5);
	return [
		{
			attribute: suffix,
			property: suffix.replace(/-([a-z])/g, (_, letter: string) =>
				letter.toUpperCase(),
			),
			expression,
			range: nodeRange(attribute),
		},
	];
}

function collectStyleBindings(root: Parser.SyntaxNode): Set<string> {
	const bindings = new Set<string>();
	walk(root, (node) => {
		if (node.type === "stylesheet_statement") {
			const binding = node.childForFieldName("binding")?.text;
			if (binding) bindings.add(binding);
		}
		if (node.type === "nazare_import_statement") {
			const source = unquote(node.childForFieldName("source")?.text ?? "");
			const binding = node.childForFieldName("local_name")?.text;
			if (binding && source.endsWith(".css")) bindings.add(binding);
		}
	});
	return bindings;
}

function referencesInText(
	text: string,
	offset: number,
	styleBindings: ReadonlySet<string>,
	styleForm: "quoted-class",
): NazareReferenceFact[] {
	const references: NazareReferenceFact[] = [];
	const pattern = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
	for (const match of text.matchAll(pattern)) {
		const binding = match[1] as string;
		if (binding !== "props" && !styleBindings.has(binding)) continue;
		references.push({
			kind: "reference",
			target: binding === "props" ? "prop" : "style",
			binding,
			name: match[2] as string,
			form: binding === "props" ? "identifier" : styleForm,
			range: {
				start: offset + match.index,
				end: offset + match.index + match[0].length,
			},
		});
	}
	return references;
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
		? { root: parent.root, path: [...parent.path, unquote(property.text)] }
		: undefined;
}

function hasRawAncestor(node: Parser.SyntaxNode): boolean {
	let parent = node.parent;
	while (parent) {
		if (
			parent.type === "schema_statement" ||
			parent.type === "raw_statement" ||
			parent.type === "comment" ||
			parent.type === "doc"
		) {
			return true;
		}
		parent = parent.parent;
	}
	return false;
}

function hasConditionalAncestor(node: Parser.SyntaxNode): boolean {
	let parent = node.parent;
	while (parent) {
		if (conditionalNodes.has(parent.type)) return true;
		parent = parent.parent;
	}
	return false;
}

function tagRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const start = source.lastIndexOf("{%", node.startIndex);
	const close = source.indexOf("%}", node.endIndex);
	return start >= 0 && close >= 0 ? { start, end: close + 2 } : nodeRange(node);
}

function pairedTagRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const opening = source.indexOf("{%", node.startIndex);
	const start =
		opening >= 0 && opening <= node.endIndex ? opening : node.startIndex;
	return { start, end: node.endIndex };
}

function emptyBodyRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const openingEnd = source.indexOf("%}", node.startIndex);
	const closingStart = source.lastIndexOf("{%", node.endIndex);
	const point = openingEnd < 0 ? node.startIndex : openingEnd + 2;
	return { start: point, end: Math.max(point, closingStart) };
}

function enclosingOutput(
	source: string,
	node: Parser.SyntaxNode,
): SourceRange | undefined {
	const start = source.lastIndexOf("{{", node.startIndex);
	const close = source.indexOf("}}", node.endIndex);
	if (start < 0 || close < 0) return undefined;
	const inner = source.slice(start + 2, close).replace(/^-|-$|\s/g, "");
	return inner === node.text ? { start, end: close + 2 } : undefined;
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

function unquote(value: string): string {
	return value.length >= 2 && /["']/.test(value[0] as string)
		? value.slice(1, -1)
		: value;
}

function isComponentKind(
	value: string | undefined,
): value is "section" | "block" | "snippet" {
	return value === "section" || value === "block" || value === "snippet";
}
