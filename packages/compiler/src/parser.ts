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
} from "./ast.js";
import {
	controlFlowNotLowered,
	htmlNotPromoted,
	parseInvalidImport,
	parseInvalidTypeExpression,
	parseMalformedPropDeclaration,
} from "./diagnostics.js";
import { spanFromOffsets } from "./source.js";
import { parseTypeExpression } from "./type-expression.js";

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
	const diagnostics: NazareAst["diagnostics"] = [];
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
