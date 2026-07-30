import Parser from "tree-sitter";
import Html from "tree-sitter-html";
import { parseTreeText } from "../parser-input.js";
import { walkNamedNodes as walk } from "../tree-sitter-walk.js";
import {
	DEFAULT_NAZARE_SCRIPT_LANGUAGE,
	type SourceDocument,
	type SourceRange,
} from "../types.js";
import { type LiquidSyntaxFacts, liquidSyntaxFacts } from "./liquid.js";

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

export type NazareHtmlElementFact = {
	kind: "html-element";
	tagName: string;
	leaf: boolean;
	range: SourceRange;
};

export type NazareHtmlRootFact = {
	kind: "html-root";
	tagName: string;
	tagEnd: number;
	markerRange?: SourceRange;
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
	| NazareHtmlElementFact
	| NazareHtmlRootFact
	| NazareRootMarkerFact
	| NazareIslandFact;

export type NazareSyntaxProblem =
	| {
			kind: "unclosed-raw-block";
			block: "script" | "stylesheet";
			range: SourceRange;
	  }
	| {
			kind: "component" | "import" | "render" | "blocks" | "stylesheet";
			markup: string;
			range: SourceRange;
	  }
	| {
			kind: "script-language";
			value: string;
			range: SourceRange;
	  }
	| {
			kind: "attribute";
			attribute: "ref" | "island";
			reason: "dynamic" | "invalid-identifier";
			value?: string;
			range: SourceRange;
	  };

export type NazareSyntaxFacts = {
	authoritative: boolean;
	facts: readonly NazareSyntaxFact[];
	problems: readonly NazareSyntaxProblem[];
	/** Shared Liquid mechanics from the same Nazare CST. */
	liquid: LiquidSyntaxFacts;
};

const conditionalNodes = new Set([
	"if_statement",
	"unless_statement",
	"case_statement",
	"for_loop_statement",
	"tablerow_statement",
]);

/** Node types the fact walk can turn into a Nazare syntax fact. */
const nazareFactNodes = new Set([
	"nazare_component_statement",
	"nazare_import_statement",
	"nazare_props_statement",
	"nazare_render_statement",
	"nazare_blocks_statement",
	"nazare_script_statement",
	"stylesheet_statement",
	"access",
]);

/** Mechanical Nazare declarations and references. Semantic meaning stays in compiler. */
export function nazareSyntaxFacts(document: SourceDocument): NazareSyntaxFacts {
	if (document.language !== "nazare-liquid") {
		throw new Error(`Nazare syntax adapter cannot read ${document.language}`);
	}
	const liquid = liquidSyntaxFacts(document);
	const problems = tagSyntaxProblems(document);
	if (
		document.issues.length > 0 ||
		problems.some((problem) => problem.kind === "script-language")
	) {
		return { authoritative: false, facts: [], problems, liquid };
	}

	const facts: NazareSyntaxFact[] = [];
	const styleBindings = collectStyleBindings(document.tree.rootNode);
	walk(document.tree.rootNode, (walked) => {
		if (!nazareFactNodes.has(walked.type)) return;
		const node = walked.node();
		if (node.type === "nazare_component_statement") {
			const range = tagRange(document.source, node);
			const componentKind = requiredField(node, "kind").text;
			if (!isComponentKind(componentKind)) {
				throw new Error(
					`Invalid component kind in authoritative CST: ${componentKind}`,
				);
			}
			facts.push({ kind: "component", componentKind, range });
			return;
		}
		if (node.type === "nazare_import_statement") {
			const range = tagRange(document.source, node);
			const localName = requiredField(node, "local_name").text;
			const source = requiredField(node, "source").text;
			facts.push({
				kind: "import",
				localName,
				specifier: unquote(source),
				range,
			});
			return;
		}
		if (node.type === "nazare_props_statement") {
			const range = tagRange(document.source, node);
			const payload = requiredField(node, "payload");
			facts.push({
				kind: "props",
				payload: payload.text,
				payloadRange: nodeRange(payload),
				range,
			});
			return;
		}
		if (node.type === "nazare_render_statement") {
			const range = tagRange(document.source, node);
			const target = requiredField(node, "target").text;
			const payload = requiredField(node, "payload");
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
			return;
		}
		if (node.type === "nazare_blocks_statement") {
			const range = tagRange(document.source, node);
			facts.push({
				kind: "blocks",
				blockNames: node.childrenForFieldName("name").map((name) => name.text),
				range,
			});
			return;
		}
		if (node.type === "nazare_script_statement") {
			const body = node.childForFieldName("body");
			const languageNode = node.childForFieldName("language");
			const language: NazareScriptFact["language"] = languageNode
				? unquote(languageNode.text) === "ts"
					? "typescript"
					: "javascript"
				: DEFAULT_NAZARE_SCRIPT_LANGUAGE;
			const bodyRange = body
				? nodeRange(body)
				: emptyBodyRange(document.source, node);
			facts.push({
				kind: "script",
				language,
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
			const bindingName = node.childForFieldName("binding")?.text;
			facts.push({
				kind: "stylesheet",
				bindingName:
					bindingName && /^[A-Za-z_$][\w$]*$/.test(bindingName)
						? bindingName
						: undefined,
				body: document.source.slice(bodyRange.start, bodyRange.end),
				bodyRange,
				range: pairedTagRange(document.source, node),
			});
			return;
		}
		if (
			node.type === "access" &&
			walked.parentType !== "access" &&
			!hasRawAncestor(walked.ancestorTypes)
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
					range: trimmedNodeRange(node),
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
	facts.push(...htmlFacts(document, problems));
	return {
		authoritative: true,
		facts: facts.sort((left, right) => left.range.start - right.range.start),
		problems: problems.sort(
			(left, right) => left.range.start - right.range.start,
		),
		liquid,
	};
}

function tagSyntaxProblems(document: SourceDocument): NazareSyntaxProblem[] {
	const ignored: SourceRange[] = [
		...document.embeddedRegions.map((region) => region.bodyRange),
	];
	walk(document.tree.rootNode, (walked) => {
		if (
			walked.type === "comment" ||
			walked.type === "doc" ||
			walked.type === "raw_statement" ||
			walked.type === "schema_statement"
		) {
			ignored.push(nodeRange(walked.node()));
		}
	});
	const problems: NazareSyntaxProblem[] = document.embeddedRegions
		.filter((region) => !region.closeRange)
		.map((region) => ({
			kind: "unclosed-raw-block" as const,
			block: region.language === "css" ? "stylesheet" : "script",
			range: region.openRange,
		}));
	walk(document.tree.rootNode, (walked) => {
		if (walked.type !== "nazare_script_statement") return;
		const node = walked.node();
		const language = node.childForFieldName("language")?.text;
		if (
			language === undefined ||
			language === '"js"' ||
			language === "'js'" ||
			language === '"ts"' ||
			language === "'ts'"
		) {
			return;
		}
		problems.push({
			kind: "script-language",
			value: language,
			range: openingTagRange(document.source, node),
		});
	});
	const pattern =
		/\{%-?\s*(component|import|render|blocks|stylesheet)\b([\s\S]*?)-?%\}/g;
	for (const match of document.source.matchAll(pattern)) {
		const start = match.index;
		if (ignored.some((range) => start >= range.start && start < range.end))
			continue;
		const kind = match[1] as
			| "component"
			| "import"
			| "render"
			| "blocks"
			| "stylesheet";
		const markup = (match[2] ?? "").trim();
		let invalid = false;
		if (kind === "component") {
			invalid = !isComponentKind(markup);
		} else if (kind === "import") {
			invalid = !/^[A-Za-z_$][\w$]*\s+from\s+(["'])[^"']+\1$/.test(markup);
		} else if (kind === "render") {
			invalid =
				/^[A-Z][\w$]*\b/.test(markup) &&
				!/^([A-Za-z_$][\w$]*)\s*\{[\s\S]*\}$/.test(markup);
		} else if (kind === "blocks") {
			invalid =
				markup.length > 0 &&
				!markup
					.split(",")
					.every((name) => /^[A-Za-z_$][\w$]*$/.test(name.trim()));
		} else {
			invalid = markup.length > 0 && !/^[A-Za-z_$][\w$]*$/.test(markup);
		}
		if (!invalid) continue;
		let end = start + match[0].length;
		if (kind === "stylesheet") {
			const close = /\{%-?\s*endstylesheet\s*-?%\}/g;
			close.lastIndex = end;
			const closing = close.exec(document.source);
			if (closing) end = closing.index + closing[0].length;
		}
		problems.push({ kind, markup, range: { start, end } });
	}
	return problems;
}

function htmlFacts(
	document: SourceDocument,
	problems: NazareSyntaxProblem[],
): NazareSyntaxFact[] {
	const masked = maskedHtmlSource(document);
	const parser = new Parser();
	parser.setLanguage(Html);
	const tree = parseTreeText(parser, masked);
	const facts: NazareSyntaxFact[] = [];
	walk(tree.rootNode, (walked) => {
		if (walked.type !== "start_tag" && walked.type !== "self_closing_tag") {
			return;
		}
		const node = walked.node();
		const tagName = node.namedChildren.find(
			(child) => child.type === "tag_name",
		)?.text;
		if (!tagName) return;
		const attributes = node.namedChildren.filter(
			(child) => child.type === "attribute",
		);
		const element = node.parent;
		facts.push({
			kind: "html-element",
			tagName,
			leaf:
				element?.namedChildren.every(
					(child) =>
						child.type !== "element" &&
						child.type !== "script_element" &&
						child.type !== "style_element",
				) ?? true,
			range: nodeRange(element ?? node),
		});
		const rootMarker = attributes.find(
			(attribute) =>
				attribute.namedChildren.find((child) => child.type === "attribute_name")
					?.text === "nz-root",
		);
		if (element?.parent?.type === "document") {
			facts.push({
				kind: "html-root",
				tagName,
				tagEnd:
					document.source[node.endIndex - 2] === "/"
						? node.endIndex - 2
						: node.endIndex - 1,
				markerRange: rootMarker
					? htmlRootMarkerRange(document.source, rootMarker)
					: undefined,
				range: nodeRange(element),
			});
		}
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
			if (value === undefined) {
				problems.push({
					kind: "attribute",
					attribute: name,
					reason: "dynamic",
					range,
				});
				continue;
			}
			if (!/^[A-Za-z_$][\w$]*$/.test(value)) {
				problems.push({
					kind: "attribute",
					attribute: name,
					reason: "invalid-identifier",
					value,
					range,
				});
				continue;
			}
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
	const source = document.source;
	const parts: string[] = [];
	let cursor = 0;
	walk(document.tree.rootNode, (walked) => {
		if (walked.type !== "template_content") return;
		const node = walked.node();
		// Pre-order walk yields ascending starts; a nested region is already
		// covered by the enclosing one that was emitted first.
		if (node.startIndex < cursor) return;
		parts.push(source.slice(cursor, node.startIndex).replace(/[^\n\r]/g, " "));
		parts.push(source.slice(node.startIndex, node.endIndex));
		cursor = node.endIndex;
	});
	parts.push(source.slice(cursor).replace(/[^\n\r]/g, " "));
	return parts.join("");
}

function htmlRootMarkerRange(
	source: string,
	attribute: Parser.SyntaxNode,
): SourceRange {
	let start = attribute.startIndex;
	while (start > 0 && /[ \t]/.test(source[start - 1] as string)) start -= 1;
	return { start, end: attribute.endIndex };
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
	walk(root, (walked) => {
		if (
			walked.type !== "stylesheet_statement" &&
			walked.type !== "nazare_import_statement"
		) {
			return;
		}
		const node = walked.node();
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

function requiredField(
	node: Parser.SyntaxNode,
	field: string,
): Parser.SyntaxNode {
	const child = node.childForFieldName(field);
	if (!child) {
		throw new Error(
			`Authoritative ${node.type} CST node is missing required field ${field}`,
		);
	}
	return child;
}

function accessPath(
	node: Parser.SyntaxNode,
): { root: string; path: string[] } | undefined {
	if (node.type === "identifier") return { root: node.text.trim(), path: [] };
	if (node.type !== "access") return undefined;
	const receiver = requiredField(node, "receiver");
	const property = requiredField(node, "property");
	const parent = accessPath(receiver);
	return parent
		? {
				root: parent.root,
				path: [...parent.path, unquote(property.text.trim())],
			}
		: undefined;
}

function hasRawAncestor(ancestorTypes: readonly string[]): boolean {
	for (let index = ancestorTypes.length - 1; index >= 0; index--) {
		const type = ancestorTypes[index];
		if (
			type === "schema_statement" ||
			type === "raw_statement" ||
			type === "comment" ||
			type === "doc"
		) {
			return true;
		}
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

function openingTagRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const start = source.indexOf("{%", node.startIndex);
	const close = source.indexOf("%}", start);
	if (start < 0 || close < start || close >= node.endIndex) {
		throw new Error(
			`Cannot locate opening tag delimiters for authoritative ${node.type}`,
		);
	}
	return { start, end: close + 2 };
}

function tagRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const start = source.lastIndexOf("{%", node.startIndex);
	const close = source.indexOf("%}", node.endIndex);
	if (start < 0 || close < 0) {
		throw new Error(
			`Cannot locate tag delimiters for authoritative ${node.type}`,
		);
	}
	return { start, end: close + 2 };
}

function pairedTagRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const opening = source.indexOf("{%", node.startIndex);
	if (opening < 0 || opening > node.endIndex) {
		throw new Error(`Cannot locate opening tag for authoritative ${node.type}`);
	}
	return { start: opening, end: node.endIndex };
}

function emptyBodyRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const openingEnd = source.indexOf("%}", node.startIndex);
	const closingStart = source.lastIndexOf("{%", node.endIndex);
	if (openingEnd < 0 || closingStart < openingEnd) {
		throw new Error(
			`Cannot locate body boundaries for authoritative ${node.type}`,
		);
	}
	const point = openingEnd + 2;
	return { start: point, end: closingStart };
}

function enclosingOutput(
	source: string,
	node: Parser.SyntaxNode,
): SourceRange | undefined {
	const start = source.lastIndexOf("{{", node.startIndex);
	const close = source.indexOf("}}", node.endIndex);
	if (start < 0 || close < 0) return undefined;
	const inner = source.slice(start + 2, close).replace(/^-|-$|\s/g, "");
	const expression = node.text.replace(/\s/g, "");
	return inner === expression ? { start, end: close + 2 } : undefined;
}

function nodeRange(node: Parser.SyntaxNode): SourceRange {
	return { start: node.startIndex, end: node.endIndex };
}

function trimmedNodeRange(node: Parser.SyntaxNode): SourceRange {
	const text = node.text;
	return {
		start: node.startIndex + (text.length - text.trimStart().length),
		end: node.endIndex - (text.length - text.trimEnd().length),
	};
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
