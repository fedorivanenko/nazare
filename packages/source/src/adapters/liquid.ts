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

export type LiquidSyntaxBlock = {
	name: string;
	range: SourceRange;
	body: SourceRange;
};

export type LiquidSyntaxConditional = {
	name: "if" | "unless" | "case";
	range: SourceRange;
	branches: SourceRange[];
	exhaustive: boolean;
};

export type LiquidSyntaxLocalBinding = {
	name: string;
	scope: SourceRange;
	via: "assign" | "capture" | "for" | "tablerow";
	value?: string;
};

export type LiquidSyntaxLookup = {
	root: string;
	path: string[];
	range: SourceRange;
};

export type LiquidSyntaxRenderArgument = {
	targetName?: string;
	argumentName: string;
	valueExpression: string;
	source?: LiquidSyntaxLookup;
	siteRange: SourceRange;
	range: SourceRange;
	implicit: boolean;
};

export type LiquidSyntaxStringReference = { value: string; range: SourceRange };

export type LiquidSyntaxDocParam = {
	name: string;
	required: boolean;
	paramType?: string;
	description?: string;
	range: SourceRange;
};

export type LiquidSyntaxRead = LiquidSyntaxLookup & {
	expression: string;
	inCondition: boolean;
	tag?: string;
	inRenderArgument: boolean;
	local: boolean;
};

export type LiquidSyntaxGuard = {
	name: string;
	via: "guard" | "default";
	range: SourceRange;
};

export type LiquidSyntaxFacts = {
	/** False means callers must not derive semantic facts from partial syntax. */
	authoritative: boolean;
	dependencies: readonly LiquidSyntaxDependency[];
	settingsReads: readonly LiquidSyntaxSettingsRead[];
	blocks: readonly LiquidSyntaxBlock[];
	conditionals: readonly LiquidSyntaxConditional[];
	localBindings: readonly LiquidSyntaxLocalBinding[];
	renderArguments: readonly LiquidSyntaxRenderArgument[];
	assetReferences: readonly LiquidSyntaxStringReference[];
	localeReferences: readonly LiquidSyntaxStringReference[];
	docParams: readonly LiquidSyntaxDocParam[];
	reads: readonly LiquidSyntaxRead[];
	guards: readonly LiquidSyntaxGuard[];
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

const pairedNodes = new Map<string, string>([
	["form_statement", "form"],
	["paginate_statement", "paginate"],
	["capture_statement", "capture"],
	["case_statement", "case"],
	["for_loop_statement", "for"],
	["if_statement", "if"],
	["unless_statement", "unless"],
	["tablerow_statement", "tablerow"],
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
	if (document.language !== "liquid" && document.language !== "nazare-liquid") {
		throw new Error(`Liquid syntax adapter cannot read ${document.language}`);
	}
	if (document.issues.length > 0) {
		return {
			authoritative: false,
			dependencies: [],
			settingsReads: [],
			blocks: [],
			conditionals: [],
			localBindings: [],
			renderArguments: [],
			assetReferences: [],
			localeReferences: [],
			docParams: [],
			reads: [],
			guards: [],
		};
	}

	const dependencies: LiquidSyntaxDependency[] = [];
	const settingsReads: LiquidSyntaxSettingsRead[] = [];
	const blocks: LiquidSyntaxBlock[] = [];
	const conditionals: LiquidSyntaxConditional[] = [];
	const localBindings: LiquidSyntaxLocalBinding[] = [];
	const renderArguments: LiquidSyntaxRenderArgument[] = [];
	const assetReferences: LiquidSyntaxStringReference[] = [];
	const localeReferences: LiquidSyntaxStringReference[] = [];
	const docParams: LiquidSyntaxDocParam[] = [];
	let schema: LiquidSyntaxSchema | undefined;
	walk(document.tree.rootNode, (node) => {
		const pairedName = pairedNodes.get(node.type);
		if (pairedName) {
			const block = blockFromNode(document.source, node, pairedName);
			blocks.push(block);
			if (
				pairedName === "if" ||
				pairedName === "unless" ||
				pairedName === "case"
			) {
				conditionals.push(
					conditionalFromNode(document.source, node, block, pairedName),
				);
			}
		}

		collectBinding(document.source, node, blocks, localBindings);
		if (node.type === "render_statement" || node.type === "include_statement") {
			collectRenderArguments(document.source, node, renderArguments);
		}
		if (node.type === "filter" && node.parent?.type !== "filter") {
			collectStringReference(node, assetReferences, localeReferences);
		}
		if (node.type === "doc") collectDocParams(document.source, node, docParams);

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
	const { reads, guards } = collectReadsAndGuards(
		document.source,
		document.tree.rootNode,
		localBindings,
	);
	blocks.sort((left, right) => left.range.end - right.range.end);
	conditionals.sort((left, right) => left.range.end - right.range.end);
	dependencies.sort((left, right) => left.range.start - right.range.start);
	settingsReads.sort((left, right) => left.range.start - right.range.start);
	localBindings.sort((left, right) => left.scope.start - right.scope.start);
	renderArguments.sort((left, right) => left.range.start - right.range.start);
	assetReferences.sort((left, right) => left.range.start - right.range.start);
	localeReferences.sort((left, right) => left.range.start - right.range.start);
	docParams.sort((left, right) => left.range.start - right.range.start);
	reads.sort((left, right) => left.range.start - right.range.start);
	guards.sort((left, right) => left.range.start - right.range.start);
	return {
		authoritative: true,
		dependencies,
		settingsReads,
		blocks,
		conditionals,
		localBindings,
		renderArguments,
		assetReferences,
		localeReferences,
		docParams,
		reads,
		guards,
		schema,
	};
}

const statementTags = new Map<string, string>([
	["assignment_statement", "assign"],
	["capture_statement", "capture"],
	["for_loop_statement", "for"],
	["tablerow_statement", "tablerow"],
	["if_statement", "if"],
	["unless_statement", "unless"],
	["case_statement", "case"],
	["elsif_clause", "elsif"],
	["when_clause", "when"],
	["render_statement", "render"],
	["include_statement", "include"],
	["echo_statement", "echo"],
	["cycle_statement", "cycle"],
	["increment_statement", "increment"],
	["decrement_statement", "decrement"],
]);

function collectReadsAndGuards(
	source: string,
	root: Parser.SyntaxNode,
	bindings: readonly LiquidSyntaxLocalBinding[],
): { reads: LiquidSyntaxRead[]; guards: LiquidSyntaxGuard[] } {
	const reads: LiquidSyntaxRead[] = [];
	const guards: LiquidSyntaxGuard[] = [];
	walk(root, (node) => {
		if (hasRawAncestor(node)) return;
		let lookup: LiquidSyntaxLookup | undefined;
		if (node.type === "access" && node.parent?.type !== "access") {
			lookup = lookupFromNode(node);
		} else if (node.type === "identifier" && node.parent?.type !== "access") {
			const parent = node.parent;
			if (parent?.type === "assignment_target") return;
			const field = childFieldName(parent, node);
			if (
				field === "variable_name" ||
				field === "variable" ||
				field === "local_name" ||
				(field === "target" && parent?.type === "nazare_render_statement") ||
				(field === "item" &&
					(parent?.type === "for_loop_statement" ||
						parent?.type === "tablerow_statement")) ||
				field === "key" ||
				field === "name" ||
				field === "property"
			) {
				return;
			}
			if (["blank", "empty", "nil", "null"].includes(node.text)) return;
			lookup = lookupFromNode(node);
		}
		if (lookup) {
			const tag = tagAt(source, node);
			const inCondition =
				tag === "if" ||
				tag === "unless" ||
				tag === "elsif" ||
				tag === "when" ||
				tag === "case";
			const local = bindings.some(
				(binding) =>
					binding.name === lookup.root &&
					lookup.range.start >= binding.scope.start &&
					lookup.range.start <= binding.scope.end,
			);
			reads.push({
				...lookup,
				expression: [lookup.root, ...lookup.path].join("."),
				inCondition,
				tag,
				inRenderArgument: tag === "render" || tag === "include",
				local,
			});
			if (inCondition && lookup.path.length === 0) {
				guards.push({ name: lookup.root, via: "guard", range: lookup.range });
			}
		}
		if (node.type === "filter" && node.parent?.type !== "filter") {
			const chain = filterChain(node);
			if (
				chain.names.includes("default") &&
				chain.subject?.type === "identifier"
			) {
				const subject = lookupFromNode(chain.subject);
				if (subject) {
					guards.push({
						name: subject.root,
						via: "default",
						range: subject.range,
					});
				}
			}
		}
	});
	return { reads, guards };
}

function filterChain(node: Parser.SyntaxNode): {
	names: string[];
	subject: Parser.SyntaxNode | null;
} {
	const names: string[] = [];
	let subject: Parser.SyntaxNode | null = node;
	while (subject?.type === "filter") {
		const name = subject.childForFieldName("name")?.text.trim();
		if (name) names.push(name);
		subject = subject.childForFieldName("body");
	}
	return { names, subject };
}

function tagAt(source: string, node: Parser.SyntaxNode): string | undefined {
	let candidate = node.parent;
	while (candidate) {
		const tag = statementTags.get(candidate.type);
		if (tag) {
			const opening = openingTagRange(source, candidate);
			if (node.startIndex >= opening.start && node.endIndex <= opening.end) {
				return tag;
			}
		}
		candidate = candidate.parent;
	}
	return undefined;
}

function blockFromNode(
	source: string,
	node: Parser.SyntaxNode,
	name: string,
): LiquidSyntaxBlock {
	const opening = openingTagRange(source, node);
	const closingStart = source.lastIndexOf("{%", node.endIndex);
	return {
		name,
		range: { start: opening.start, end: node.endIndex },
		body: {
			start: opening.end,
			end: closingStart < opening.end ? node.endIndex : closingStart,
		},
	};
}

function conditionalFromNode(
	source: string,
	node: Parser.SyntaxNode,
	block: LiquidSyntaxBlock,
	name: "if" | "unless" | "case",
): LiquidSyntaxConditional {
	const clauses: Parser.SyntaxNode[] = [];
	const collectClauses = (candidate: Parser.SyntaxNode): void => {
		if (candidate !== node && pairedNodes.has(candidate.type)) return;
		if (
			candidate.type === "elsif_clause" ||
			candidate.type === "when_clause" ||
			candidate.type === "else_clause"
		) {
			clauses.push(candidate);
			return;
		}
		for (const child of candidate.namedChildren) collectClauses(child);
	};
	collectClauses(node);
	clauses.sort((left, right) => left.startIndex - right.startIndex);

	const branches: SourceRange[] = [];
	let branchStart =
		name === "case" ? undefined : openingTagRange(source, node).end;
	let exhaustive = false;
	for (const clause of clauses) {
		const clauseTag = openingTagRange(source, clause);
		if (branchStart !== undefined) {
			branches.push({ start: branchStart, end: clauseTag.start });
		}
		branchStart = clauseTag.end;
		if (clause.type === "else_clause") exhaustive = true;
	}
	if (branchStart !== undefined) {
		branches.push({ start: branchStart, end: block.body.end });
	}
	return { name, range: block.range, branches, exhaustive };
}

function collectBinding(
	source: string,
	node: Parser.SyntaxNode,
	blocks: readonly LiquidSyntaxBlock[],
	bindings: LiquidSyntaxLocalBinding[],
): void {
	if (node.type === "assignment_statement") {
		const name = node.childForFieldName("variable_name")?.text;
		if (!name) return;
		bindings.push({
			name,
			scope: { start: enclosingTagRange(source, node).end, end: source.length },
			via: "assign",
			value: node.childForFieldName("value")?.text.trim(),
		});
		return;
	}
	if (node.type === "capture_statement") {
		const name = node.childForFieldName("variable")?.text;
		if (!name) return;
		bindings.push({
			name,
			scope: { start: openingTagRange(source, node).end, end: source.length },
			via: "capture",
		});
		return;
	}
	const via =
		node.type === "for_loop_statement"
			? "for"
			: node.type === "tablerow_statement"
				? "tablerow"
				: undefined;
	if (!via) return;
	const name = node.childForFieldName("item")?.text;
	if (!name) return;
	const block = blocks.find(
		(candidate) =>
			candidate.name === via && candidate.range.end === node.endIndex,
	);
	const scope = block?.body ?? {
		start: openingTagRange(source, node).end,
		end: node.endIndex,
	};
	const opening = openingTagRange(source, node);
	const openingText = source.slice(opening.start, opening.end);
	const value = /\s+in\s+([\s\S]*?)(?:-?%})$/.exec(openingText)?.[1]?.trim();
	bindings.push({ name, scope, via, value });
	bindings.push({ name: "forloop", scope, via });
}

function collectRenderArguments(
	source: string,
	node: Parser.SyntaxNode,
	argumentsOut: LiquidSyntaxRenderArgument[],
): void {
	const targetNode = node.childForFieldName("file");
	const targetName =
		targetNode?.type === "string" ? unquote(targetNode.text) : undefined;
	const siteRange = enclosingTagRange(source, node);
	const implicit =
		node.childrenForFieldName("with").find((child) => child.isNamed) ??
		node.childrenForFieldName("iteration").find((child) => child.isNamed);
	if (implicit && targetName) {
		const alias = node.childForFieldName("item")?.text;
		argumentsOut.push({
			targetName,
			argumentName: alias ?? targetName,
			valueExpression: implicit.text,
			source: lookupFromNode(implicit),
			siteRange,
			range: { start: implicit.startIndex, end: implicit.endIndex },
			implicit: true,
		});
	}
	const explicitArguments = [
		...node.descendantsOfType("argument"),
		...node.descendantsOfType("render_argument"),
	].sort((left, right) => left.startIndex - right.startIndex);
	for (const argument of explicitArguments) {
		const key = argument.childForFieldName("key");
		const value = argument.childForFieldName("value");
		if (!key || !value) continue;
		let rangeEnd = argument.endIndex;
		while (/\s/.test(source[rangeEnd] ?? "")) rangeEnd += 1;
		argumentsOut.push({
			targetName,
			argumentName: key.text,
			valueExpression: value.text,
			source: firstLookup(value),
			siteRange,
			range: { start: argument.startIndex, end: rangeEnd },
			implicit: false,
		});
	}
}

function collectStringReference(
	filter: Parser.SyntaxNode,
	assets: LiquidSyntaxStringReference[],
	locales: LiquidSyntaxStringReference[],
): void {
	const names: string[] = [];
	let subject: Parser.SyntaxNode | null = filter;
	while (subject?.type === "filter") {
		const name = subject.childForFieldName("name")?.text.trim();
		if (name) names.push(name);
		subject = subject.childForFieldName("body");
	}
	if (subject?.type !== "string") return;
	const reference = {
		value: unquote(subject.text),
		range: { start: subject.startIndex, end: subject.endIndex },
	};
	if (names.some((name) => name === "asset_url" || name === "asset_img_url")) {
		assets.push(reference);
	}
	if (names.some((name) => name === "t" || name === "translate")) {
		locales.push(reference);
	}
}

const docParamPattern =
	/^\s*@param\s*(?:\{([^}]*)\})?\s*(\[?)([a-zA-Z_][\w-]*)\]?\s*(?:-\s*(.*))?$/;

function collectDocParams(
	source: string,
	node: Parser.SyntaxNode,
	params: LiquidSyntaxDocParam[],
): void {
	const opening = openingTagRange(source, node);
	const bodyEnd = source.lastIndexOf("{%", node.endIndex);
	const body = source.slice(opening.end, bodyEnd);
	let cursor = opening.end;
	for (const line of body.split("\n")) {
		const lineStart = cursor;
		cursor += line.length + 1;
		const match = docParamPattern.exec(line);
		if (!match) continue;
		const name = match[3] as string;
		params.push({
			name,
			required: match[2] !== "[",
			paramType: match[1]?.trim() || undefined,
			description: match[4]?.trim() || undefined,
			range: {
				start: lineStart + line.indexOf("@param"),
				end: lineStart + line.length,
			},
		});
	}
}

function firstLookup(node: Parser.SyntaxNode): LiquidSyntaxLookup | undefined {
	const direct = lookupFromNode(node);
	if (direct) return direct;
	const filterName =
		node.type === "render_filter" ? node.childForFieldName("name") : undefined;
	for (const child of node.namedChildren) {
		if (child === filterName) continue;
		const lookup = firstLookup(child);
		if (lookup) return lookup;
	}
	return undefined;
}

function lookupFromNode(
	node: Parser.SyntaxNode,
): LiquidSyntaxLookup | undefined {
	const path = accessPath(node);
	const leading = node.text.length - node.text.trimStart().length;
	const trailing = node.text.length - node.text.trimEnd().length;
	return path
		? {
				...path,
				range: {
					start: node.startIndex + leading,
					end: node.endIndex - trailing,
				},
			}
		: undefined;
}

function childFieldName(
	parent: Parser.SyntaxNode | null,
	child: Parser.SyntaxNode,
): string | undefined {
	if (!parent) return undefined;
	const index = parent.children.findIndex(
		(candidate) => candidate.id === child.id,
	);
	return index < 0 ? undefined : (parent.fieldNameForChild(index) ?? undefined);
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
	if (node.type === "identifier") return { root: node.text.trim(), path: [] };
	if (node.type !== "access") return undefined;
	const receiver = node.childForFieldName("receiver");
	const property = node.childForFieldName("property");
	if (!receiver || !property) return undefined;
	const parent = accessPath(receiver);
	return parent
		? { root: parent.root, path: [...parent.path, property.text.trim()] }
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

function openingTagRange(source: string, node: Parser.SyntaxNode): SourceRange {
	const previousStart = source.lastIndexOf("{%", node.startIndex);
	const previousClose =
		previousStart < 0 ? -1 : source.indexOf("%}", previousStart);
	const start =
		previousStart >= 0 && previousClose >= node.startIndex
			? previousStart
			: source.indexOf("{%", node.startIndex);
	const close = source.indexOf("%}", Math.max(start, node.startIndex));
	if (start < 0 || close < 0 || start > node.endIndex) {
		return { start: node.startIndex, end: node.startIndex };
	}
	return { start, end: close + 2 };
}

function enclosingTagRange(
	source: string,
	node: Parser.SyntaxNode,
): SourceRange {
	let ancestor = node.parent;
	while (ancestor) {
		if (ancestor.type === "liquid_tag") {
			return { start: node.startIndex, end: node.endIndex };
		}
		ancestor = ancestor.parent;
	}
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
	const openStart = source.indexOf("{%", node.startIndex);
	const range = {
		start:
			openStart >= 0 && openStart < node.endIndex ? openStart : node.startIndex,
		end: node.endIndex,
	};
	const openEnd = source.indexOf("%}", range.start);
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
	const trimmed = value.trim();
	return trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed;
}
