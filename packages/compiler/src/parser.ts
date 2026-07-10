import type { PropTypeInfo, SemanticType } from "@nazare/core";
import { shopifyObjectTypeNames } from "@nazare/core";
import {
	type LiquidHtmlNode,
	NodeTypes,
	toLiquidHtmlAST,
	walk,
} from "@shopify/liquid-html-parser";
import type {
	NazareAst,
	NazareNode,
	NazarePassedProp,
	NazarePropDeclaration,
	ParseDiagnostic,
} from "./ast.js";
import { spanFromOffsets } from "./source.js";

const importPattern = /^([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']$/;
const renderPattern = /^([A-Za-z_$][\w$]*)\s*\{([\s\S]*)\}$/;

type SourceRange = { start: number; end: number };

type LiquidTagLike = LiquidHtmlNode & {
	name?: unknown;
	markup?: unknown;
	position: SourceRange;
};

type UnsupportedSyntaxCategory = "control-flow" | "html";

export function parseNazareLiquid(source: string, file: string): NazareAst {
	const nodes: NazareNode[] = [];
	const diagnostics: ParseDiagnostic[] = [];
	const unsupportedSyntax = new Map<
		UnsupportedSyntaxCategory,
		LiquidHtmlNode
	>();
	const controlFlowRanges: SourceRange[] = [];

	const ast = toLiquidHtmlAST(source, {
		mode: "tolerant",
		allowUnclosedDocumentNode: true,
	});

	walk(ast, (node) => {
		collectUnsupportedSyntax(node, unsupportedSyntax);
		collectControlFlowRange(node, controlFlowRanges);
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
			const match = tag.markup.trim().match(importPattern);
			if (!match) {
				diagnostics.push({
					severity: "error",
					code: "NAZARE_PARSE_IMPORT",
					message: `Invalid Nazare import syntax: ${tag.markup}`,
					span,
				});
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
				props: parseProps(tag.markup, source, file, tag.position.start),
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

	return { file, liquidAst: ast, nodes, diagnostics };
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
): NazarePropDeclaration[] {
	const body = trimBraces(markup);
	const props: NazarePropDeclaration[] = [];

	for (const entry of splitTopLevel(body)) {
		const separator = entry.indexOf(":");
		if (separator === -1) continue;

		const name = entry.slice(0, separator).trim();
		const typeExpression = entry.slice(separator + 1).trim();
		if (!isIdentifier(name) || !typeExpression) continue;

		const offset = source.indexOf(name, nodeStart);
		props.push({
			name,
			typeExpression,
			typeInfo: parsePropTypeInfo(typeExpression),
			required: /\.required\s*\(/.test(typeExpression),
			hasDefault: hasDefaultValue(typeExpression),
			span: spanFromOffsets(source, file, {
				start: offset >= 0 ? offset : nodeStart,
				end: offset >= 0 ? offset + name.length : nodeStart,
			}),
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

function parsePropTypeInfo(typeExpression: string): PropTypeInfo {
	return {
		valueType: parseValueType(typeExpression),
		setting: /\.setting\s*\(/.test(typeExpression)
			? {
					label: stringObjectValue(typeExpression, "label"),
					default: stringObjectValue(typeExpression, "default"),
				}
			: undefined,
	};
}

function parseValueType(typeExpression: string): SemanticType {
	const trimmed = typeExpression.trim();
	const arrayMatch = trimmed.match(/^array\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
	if (arrayMatch)
		return { kind: "array", element: parseNamedValueType(arrayMatch[1]) };

	const objectMatch = trimmed.match(
		/^object\s*\(\s*["']?([A-Za-z_$][\w$]*)["']?\s*\)/,
	);
	if (objectMatch) return { kind: "object", name: objectMatch[1] };

	const valueType = trimmed.match(/^([A-Za-z_$][\w$]*)/)?.[1];
	return valueType ? parseNamedValueType(valueType) : { kind: "unknown" };
}

function parseNamedValueType(valueType: string): SemanticType {
	if (valueType === "string") return { kind: "string" };
	if (valueType === "url") return { kind: "url" };
	if (valueType === "boolean") return { kind: "boolean" };
	if (valueType === "number") return { kind: "number" };
	if (valueType === "Money") return { kind: "money" };
	if ((shopifyObjectTypeNames as readonly string[]).includes(valueType)) {
		return { kind: "object", name: valueType };
	}
	if (/^[A-Z]/.test(valueType)) return { kind: "object", name: valueType };
	return { kind: "unknown" };
}

function stringObjectValue(source: string, key: string): string | undefined {
	return source.match(new RegExp(`${key}\\s*:\\s*["']([^"']*)["']`))?.[1];
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
): ParseDiagnostic[] {
	return Array.from(unsupportedSyntax.entries()).map(([category, node]) => ({
		severity: unsupportedSyntaxSeverity(category),
		code: unsupportedSyntaxCode(category),
		message: unsupportedSyntaxMessage(category),
		span: spanFromOffsets(source, file, node.position),
	}));
}

function unsupportedSyntaxSeverity(
	category: UnsupportedSyntaxCategory,
): ParseDiagnostic["severity"] {
	return category === "control-flow" ? "warning" : "info";
}

function unsupportedSyntaxCode(category: UnsupportedSyntaxCategory): string {
	if (category === "control-flow") return "IR_PARTIAL_LOWERING_CONTROL_FLOW";
	return "IR_NODE_NOT_PROMOTED_HTML";
}

function unsupportedSyntaxMessage(category: UnsupportedSyntaxCategory): string {
	if (category === "control-flow") {
		return "Control-flow omission means render-site reachability is incomplete; syntax is preserved in LiquidHTML AST";
	}
	return "HTML elements are not promoted to ArtifactIR in v0; syntax is preserved in LiquidHTML AST";
}

function hasDefaultValue(typeExpression: string): boolean {
	return (
		/\.default\s*\(/.test(typeExpression) ||
		/\bdefault\s*:/.test(typeExpression)
	);
}

function isIdentifier(value: string): boolean {
	return /^[A-Za-z_$][\w$]*$/.test(value);
}
