// Parse pass: runs Shopify's tolerant LiquidHTML parser, then walks the tree
// once to lift Nazare tags into NazareNodes (see ast.ts). Owns only surface
// syntax concerns — tag markup shapes, spans, and which Liquid constructs are
// not yet lowered (control flow, HTML). No symbols, no types beyond what the
// props DSL literally declares.
import type { SourceSpan } from "@nazare/core";
import {
	type LiquidHtmlNode,
	NodeTypes,
	toLiquidHtmlAST,
	walk,
} from "@shopify/liquid-html-parser";
import type {
	NazareAst,
	NazareDataBinding,
	NazareNode,
	NazarePassedProp,
	NazarePropDeclaration,
	NazareScriptNode,
	NazareStyleNode,
} from "./ast.js";
import {
	controlFlowNotLowered,
	htmlNotPromoted,
	parseInvalidAssetImport,
	parseInvalidImport,
	parseInvalidRefAttribute,
	parseInvalidTypeExpression,
	parseMalformedPropDeclaration,
} from "./diagnostics.js";
import { spanFromOffsets } from "./source.js";
import { parseTypeExpression } from "./type-expression.js";

const importPattern = /^([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']$/;
const renderPattern = /^([A-Za-z_$][\w$]*)\s*\{([\s\S]*)\}$/;
const scriptBlockPattern =
	/{%-?\s*script\b([^%]*?)-?%}([\s\S]*?){%-?\s*endscript\s*-?%}/g;
const styleBlockPattern =
	/{%-?\s*stylesheet\s*-?%}([\s\S]*?){%-?\s*endstylesheet\s*-?%}/g;
const refAccessPattern = /\brefs\.([A-Za-z_$][\w$]*)/g;
const dataAccessPattern = /\bdata\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
const refIdentifierPattern = /^[A-Za-z_$][\w$]*$/;

type SourceRange = { start: number; end: number };

type LiquidTagLike = LiquidHtmlNode & {
	name?: unknown;
	markup?: unknown;
	position: SourceRange;
};

type UnsupportedSyntaxCategory = "control-flow" | "html";

export function parseNazareLiquid(source: string, file: string): NazareAst {
	const nodes: NazareNode[] = [];
	const diagnostics: NazareAst["diagnostics"] = [];
	const unsupportedSyntax = new Map<
		UnsupportedSyntaxCategory,
		LiquidHtmlNode
	>();
	const controlFlowRanges: SourceRange[] = [];

	// Script and stylesheet bodies are TS/CSS, which the HTML parser would
	// misread (comparisons look like open tags). Extract them first, then
	// blank each block — newlines kept — so every other span stays valid.
	const scriptExtraction = extractScriptBlocks(source, file);
	nodes.push(...scriptExtraction.scripts);
	const styleExtraction = extractStyleBlocks(
		scriptExtraction.blankedSource,
		source,
		file,
	);
	nodes.push(...styleExtraction.styles);

	const ast = toLiquidHtmlAST(styleExtraction.blankedSource, {
		mode: "tolerant",
		allowUnclosedDocumentNode: true,
	});

	walk(ast, (node) => {
		collectUnsupportedSyntax(node, unsupportedSyntax);
		collectControlFlowRange(node, controlFlowRanges);
		collectElementRef(node, source, file, nodes, diagnostics);
	});

	walk(ast, (node) => {
		if (node.type === NodeTypes.LiquidVariableOutput) {
			const outputExpression = parseOutputExpression(
				source,
				file,
				node.position,
			);
			if (outputExpression) nodes.push(outputExpression);
			return;
		}

		if (node.type !== NodeTypes.LiquidTag) return;

		const tag = node as LiquidTagLike;
		if (typeof tag.name !== "string" || typeof tag.markup !== "string") return;

		const span = spanFromOffsets(source, file, tag.position);

		if (tag.name === "import") {
			const assetMatch = tag.markup.trim().match(/^["']([^"']+)["']$/);
			if (assetMatch) {
				const path = assetMatch[1];
				if (!isValidAssetImportPath(path)) {
					diagnostics.push(parseInvalidAssetImport(path, span));
					return;
				}
				nodes.push({ type: "NazareAssetImport", path, span });
				return;
			}

			const match = tag.markup.trim().match(importPattern);
			if (!match) {
				diagnostics.push(parseInvalidImport(tag.markup, span));
				return;
			}

			nodes.push({
				type: "NazareImport",
				localName: match[1],
				packageId: match[2],
				span,
			});
			return;
		}

		if (tag.name === "props") {
			nodes.push({
				type: "NazareProps",
				props: parseProps(
					tag.markup,
					source,
					file,
					tag.position.start,
					diagnostics,
				),
				span,
			});
			return;
		}

		if (tag.name === "render") {
			const match = tag.markup.trim().match(renderPattern);
			if (!match) return;

			const bodyOffset = source.indexOf(match[2], tag.position.start);
			nodes.push({
				type: "NazareRender",
				target: match[1],
				props: parsePassedProps(
					match[2],
					source,
					file,
					bodyOffset >= 0 ? bodyOffset : tag.position.start,
				),
				reachability: isInsideControlFlow(tag.position, controlFlowRanges)
					? "conditional-unmodeled"
					: "unconditional",
				span,
			});
			return;
		}
	});

	diagnostics.push(
		...unsupportedSyntaxDiagnostics(unsupportedSyntax, source, file),
	);

	// Scripts/styles are extracted before the walk, so restore source order —
	// declaration order is meaningful (it is mount order for behaviors).
	nodes.sort(
		(a, b) =>
			a.span.start.line - b.span.start.line ||
			a.span.start.column - b.span.start.column,
	);

	return { file, liquidAst: ast, nodes, diagnostics };
}

function extractScriptBlocks(
	source: string,
	file: string,
): { scripts: NazareScriptNode[]; blankedSource: string } {
	const scripts: NazareScriptNode[] = [];
	let blankedSource = source;

	for (const match of source.matchAll(scriptBlockPattern)) {
		const [block, markup, body] = match;
		const blockStart = match.index;
		const bodyStart = blockStart + block.indexOf(body, markup.length);

		scripts.push({
			type: "NazareScript",
			lang: /\blang\s*=\s*["']?js["']?/.test(markup) ? "js" : "ts",
			source: body,
			refAccesses: Array.from(body.matchAll(refAccessPattern)).map(
				(access) => ({
					name: access[1],
					span: spanFromOffsets(source, file, {
						start: bodyStart + access.index,
						end: bodyStart + access.index + access[0].length,
					}),
				}),
			),
			dataAccesses: Array.from(body.matchAll(dataAccessPattern)).map(
				(access) => ({
					ref: access[1],
					property: access[2],
					span: spanFromOffsets(source, file, {
						start: bodyStart + access.index,
						end: bodyStart + access.index + access[0].length,
					}),
				}),
			),
			span: spanFromOffsets(source, file, {
				start: blockStart,
				end: blockStart + block.length,
			}),
			bodySpan: spanFromOffsets(source, file, {
				start: bodyStart,
				end: bodyStart + body.length,
			}),
		});

		blankedSource =
			blankedSource.slice(0, blockStart) +
			block.replace(/[^\n]/g, " ") +
			blankedSource.slice(blockStart + block.length);
	}

	return { scripts, blankedSource };
}

function extractStyleBlocks(
	scanSource: string,
	originalSource: string,
	file: string,
): { styles: NazareStyleNode[]; blankedSource: string } {
	const styles: NazareStyleNode[] = [];
	let blankedSource = scanSource;

	for (const match of scanSource.matchAll(styleBlockPattern)) {
		const [block, body] = match;
		const blockStart = match.index;
		const bodyStart = blockStart + block.indexOf(body);

		styles.push({
			type: "NazareStyle",
			source: originalSource.slice(bodyStart, bodyStart + body.length),
			span: spanFromOffsets(originalSource, file, {
				start: blockStart,
				end: blockStart + block.length,
			}),
			bodySpan: spanFromOffsets(originalSource, file, {
				start: bodyStart,
				end: bodyStart + body.length,
			}),
		});

		blankedSource =
			blankedSource.slice(0, blockStart) +
			block.replace(/[^\n]/g, " ") +
			blankedSource.slice(blockStart + block.length);
	}

	return { styles, blankedSource };
}

function collectElementRef(
	node: LiquidHtmlNode,
	source: string,
	file: string,
	nodes: NazareNode[],
	diagnostics: NazareAst["diagnostics"],
): void {
	if (
		node.type !== NodeTypes.HtmlElement &&
		node.type !== NodeTypes.HtmlVoidElement &&
		node.type !== NodeTypes.HtmlSelfClosingElement
	) {
		return;
	}

	for (const attribute of node.attributes) {
		if (
			attribute.type !== NodeTypes.AttrDoubleQuoted &&
			attribute.type !== NodeTypes.AttrSingleQuoted &&
			attribute.type !== NodeTypes.AttrUnquoted &&
			attribute.type !== NodeTypes.AttrEmpty
		) {
			continue;
		}
		if (staticText(attribute.name) !== "ref") continue;

		const span = spanFromOffsets(source, file, attribute.position);
		const refName =
			attribute.type === NodeTypes.AttrEmpty
				? undefined
				: staticText(attribute.value);

		if (refName === undefined) {
			diagnostics.push(
				parseInvalidRefAttribute(
					"ref value must be a static string, not Liquid output",
					span,
				),
			);
			continue;
		}
		if (!refIdentifierPattern.test(refName)) {
			diagnostics.push(
				parseInvalidRefAttribute(
					`ref value "${refName}" is not a valid identifier`,
					span,
				),
			);
			continue;
		}

		nodes.push({
			type: "NazareElementRef",
			name: refName,
			tagName: elementTagName(node),
			dataBindings: collectDataBindings(node, source, file),
			span,
		});
	}
}

/**
 * data-* attributes on a ref'd element whose value is a single {{ expr }}
 * output become typed data bindings; static or mixed values stay plain HTML.
 */
function collectDataBindings(
	node: LiquidHtmlNode & { attributes?: unknown },
	source: string,
	file: string,
): NazareDataBinding[] {
	type AttributeLike = {
		type: string;
		name: { type: string; value?: unknown }[];
		value: { type: string; position: SourceRange }[];
		position: SourceRange;
	};
	const bindings: NazareDataBinding[] = [];
	const attributes = (
		Array.isArray(node.attributes) ? node.attributes : []
	) as AttributeLike[];

	for (const attribute of attributes) {
		if (
			attribute.type !== NodeTypes.AttrDoubleQuoted &&
			attribute.type !== NodeTypes.AttrSingleQuoted &&
			attribute.type !== NodeTypes.AttrUnquoted
		) {
			continue;
		}
		const attributeName = staticText(attribute.name);
		if (!attributeName?.startsWith("data-") || attributeName === "data-nz-ref")
			continue;

		const values = attribute.value;
		if (
			values.length !== 1 ||
			values[0].type !== NodeTypes.LiquidVariableOutput
		) {
			continue;
		}

		const raw = source.slice(values[0].position.start, values[0].position.end);
		const expression = raw
			.match(/^\s*{{-?\s*([\s\S]*?)\s*-?}}\s*$/)?.[1]
			?.trim();
		if (!expression) continue;

		const suffix = attributeName.slice("data-".length);
		bindings.push({
			attribute: suffix,
			property: suffix.replace(/-([a-z])/g, (_, letter: string) =>
				letter.toUpperCase(),
			),
			expression,
			span: spanFromOffsets(source, file, attribute.position),
		});
	}

	return bindings;
}

/** Joined text of a name/value node list, or undefined when any part is Liquid. */
function staticText(
	parts: { type: string; value?: unknown }[] | undefined,
): string | undefined {
	if (!parts || parts.length === 0) return undefined;
	let text = "";
	for (const part of parts) {
		if (part.type !== NodeTypes.TextNode || typeof part.value !== "string") {
			return undefined;
		}
		text += part.value;
	}
	return text;
}

function elementTagName(node: LiquidHtmlNode): string {
	const name = (node as { name?: unknown }).name;
	if (typeof name === "string") return name;
	if (Array.isArray(name)) return staticText(name) ?? "unknown";
	return "unknown";
}

function parseOutputExpression(
	source: string,
	file: string,
	position: SourceRange,
): NazareNode | undefined {
	const raw = source.slice(position.start, position.end);
	const match = raw.match(/^\s*{{-?\s*([\s\S]*?)\s*-?}}\s*$/);
	const expression = match?.[1]?.trim();
	if (!expression) return undefined;
	const expressionStartInRaw = raw.indexOf(expression);
	const expressionStart = position.start + expressionStartInRaw;
	return {
		type: "NazareOutputExpression",
		expression,
		expressionSpan: spanFromOffsets(source, file, {
			start: expressionStart,
			end: expressionStart + expression.length,
		}),
		span: spanFromOffsets(source, file, position),
	};
}

function parseProps(
	markup: string,
	source: string,
	file: string,
	nodeStart: number,
	diagnostics: NazareAst["diagnostics"],
): NazarePropDeclaration[] {
	const body = trimBraces(markup);
	const props: NazarePropDeclaration[] = [];

	for (const entry of splitTopLevel(body)) {
		const separator = entry.indexOf(":");
		const name = separator === -1 ? "" : entry.slice(0, separator).trim();
		const typeExpression =
			separator === -1 ? "" : entry.slice(separator + 1).trim();

		const offset = source.indexOf(name || entry, nodeStart);
		const span = spanFromOffsets(source, file, {
			start: offset >= 0 ? offset : nodeStart,
			end: offset >= 0 ? offset + (name || entry).length : nodeStart,
		});

		if (!isIdentifier(name) || !typeExpression) {
			diagnostics.push(parseMalformedPropDeclaration(entry, span));
			continue;
		}

		const parsed = parseTypeExpression(typeExpression);
		if (parsed.error) {
			diagnostics.push(parseInvalidTypeExpression(name, parsed.error, span));
		}

		props.push({
			name,
			typeExpression,
			typeInfo: parsed.typeInfo,
			required: parsed.required,
			hasDefault: parsed.hasDefault,
			span,
		});
	}

	return props;
}

function parsePassedProps(
	body: string,
	source: string,
	file: string,
	bodyStart: number,
): NazarePassedProp[] {
	const props: NazarePassedProp[] = [];

	for (const entry of splitTopLevelWithOffsets(body)) {
		const separator = entry.text.indexOf(":");
		if (separator === -1) continue;

		const rawName = entry.text.slice(0, separator);
		const rawExpression = entry.text.slice(separator + 1);
		const name = rawName.trim();
		const expression = rawExpression.trim();
		if (!isIdentifier(name) || !expression) continue;

		const entryStart = bodyStart + entry.start;
		const nameStart = entryStart + rawName.search(/\S/);
		const expressionLeadingWhitespace = rawExpression.search(/\S/);
		const expressionStart =
			entryStart + separator + 1 + Math.max(expressionLeadingWhitespace, 0);

		props.push({
			name,
			expression,
			span: spanFromOffsets(source, file, {
				start: entryStart,
				end: bodyStart + entry.end,
			}),
			nameSpan: spanFromOffsets(source, file, {
				start: nameStart,
				end: nameStart + name.length,
			}),
			expressionSpan: spanFromOffsets(source, file, {
				start: expressionStart,
				end: expressionStart + expression.length,
			}),
		});
	}

	return props;
}

function trimBraces(markup: string): string {
	const trimmed = markup.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}

function splitTopLevel(input: string): string[] {
	return splitTopLevelWithOffsets(input).map((part) => part.text);
}

function splitTopLevelWithOffsets(
	input: string,
): { text: string; start: number; end: number }[] {
	const parts: { text: string; start: number; end: number }[] = [];
	let start = 0;
	let depth = 0;
	let quote: string | undefined;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		const previous = input[index - 1];

		if (quote) {
			if (char === quote && previous !== "\\") quote = undefined;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}

		if (char === "{" || char === "(" || char === "[") depth += 1;
		if (char === "}" || char === ")" || char === "]") depth -= 1;

		if (char === "," && depth === 0) {
			pushTrimmedPart(parts, input, start, index);
			start = index + 1;
		}
	}

	pushTrimmedPart(parts, input, start, input.length);

	return parts;
}

function pushTrimmedPart(
	parts: { text: string; start: number; end: number }[],
	input: string,
	start: number,
	end: number,
): void {
	const raw = input.slice(start, end);
	const leadingWhitespace = raw.search(/\S/);
	if (leadingWhitespace === -1) return;
	const trailingWhitespace = raw.match(/\s*$/)?.[0].length ?? 0;
	const trimmedStart = start + leadingWhitespace;
	const trimmedEnd = end - trailingWhitespace;
	parts.push({
		text: input.slice(trimmedStart, trimmedEnd),
		start: trimmedStart,
		end: trimmedEnd,
	});
}

function collectControlFlowRange(
	node: LiquidHtmlNode,
	controlFlowRanges: SourceRange[],
): void {
	if (node.type !== NodeTypes.LiquidTag) return;
	const tag = node as LiquidTagLike;
	if (tag.name === "if" || tag.name === "unless" || tag.name === "case") {
		controlFlowRanges.push(tag.position);
	}
}

function isInsideControlFlow(
	position: SourceRange,
	controlFlowRanges: SourceRange[],
): boolean {
	return controlFlowRanges.some(
		(range) => range.start < position.start && range.end > position.end,
	);
}

function collectUnsupportedSyntax(
	node: LiquidHtmlNode,
	unsupportedSyntax: Map<UnsupportedSyntaxCategory, LiquidHtmlNode>,
): void {
	const category = unsupportedSyntaxCategory(node);
	if (!category || unsupportedSyntax.has(category)) return;
	unsupportedSyntax.set(category, node);
}

function unsupportedSyntaxCategory(
	node: LiquidHtmlNode,
): UnsupportedSyntaxCategory | undefined {
	if (node.type === NodeTypes.LiquidBranch) return "control-flow";
	if (node.type === NodeTypes.LiquidTag) {
		const tag = node as LiquidTagLike;
		if (tag.name === "if" || tag.name === "unless" || tag.name === "case") {
			return "control-flow";
		}
	}
	if (
		node.type === NodeTypes.HtmlElement ||
		node.type === NodeTypes.HtmlVoidElement ||
		node.type === NodeTypes.HtmlSelfClosingElement
	) {
		return "html";
	}
	return undefined;
}

function unsupportedSyntaxDiagnostics(
	unsupportedSyntax: Map<UnsupportedSyntaxCategory, LiquidHtmlNode>,
	source: string,
	file: string,
): NazareAst["diagnostics"] {
	return Array.from(unsupportedSyntax.entries()).map(([category, node]) => {
		const span = spanFromOffsets(source, file, node.position);
		return category === "control-flow"
			? controlFlowNotLowered(span)
			: htmlNotPromoted(span);
	});
}

function isIdentifier(value: string): boolean {
	return /^[A-Za-z_$][\w$]*$/.test(value);
}

// Sidecar imports stay inside the component's own directory so the package
// remains a portable artifact.
function isValidAssetImportPath(path: string): boolean {
	return (
		path.startsWith("./") &&
		!path.includes("..") &&
		/\.(ts|js|css)$/.test(path)
	);
}

export function scanRefAccesses(
	source: string,
	file: string,
): { name: string; span: SourceSpan }[] {
	return Array.from(source.matchAll(refAccessPattern)).map((access) => ({
		name: access[1],
		span: spanFromOffsets(source, file, {
			start: access.index,
			end: access.index + access[0].length,
		}),
	}));
}

export function scanDataAccesses(
	source: string,
	file: string,
): { ref: string; property: string; span: SourceSpan }[] {
	return Array.from(source.matchAll(dataAccessPattern)).map((access) => ({
		ref: access[1],
		property: access[2],
		span: spanFromOffsets(source, file, {
			start: access.index,
			end: access.index + access[0].length,
		}),
	}));
}
