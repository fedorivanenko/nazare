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

type LiquidTagLike = LiquidHtmlNode & {
	name?: unknown;
	markup?: unknown;
	position: { start: number; end: number };
};

export function parseNazareLiquid(source: string, file: string): NazareAst {
	const nodes: NazareNode[] = [];
	const diagnostics: ParseDiagnostic[] = [];

	const ast = toLiquidHtmlAST(source, {
		mode: "tolerant",
		allowUnclosedDocumentNode: true,
	});

	walk(ast, (node) => {
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

			nodes.push({
				type: "NazareRender",
				target: match[1],
				props: parsePassedProps(match[2], source, file, tag.position.start),
				span,
			});
		}
	});

	return { file, liquidAst: ast, nodes, diagnostics };
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
			required: /\.required\s*\(/.test(typeExpression),
			hasDefault: /\.default\s*\(|\.setting\s*\(/.test(typeExpression),
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
	nodeStart: number,
): NazarePassedProp[] {
	const props: NazarePassedProp[] = [];

	for (const entry of splitTopLevel(body)) {
		const separator = entry.indexOf(":");
		if (separator === -1) continue;

		const name = entry.slice(0, separator).trim();
		const expression = entry.slice(separator + 1).trim();
		if (!isIdentifier(name) || !expression) continue;

		const offset = source.indexOf(name, nodeStart);
		props.push({
			name,
			expression,
			span: spanFromOffsets(source, file, {
				start: offset >= 0 ? offset : nodeStart,
				end: offset >= 0 ? offset + name.length : nodeStart,
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
	const parts: string[] = [];
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
			const part = input.slice(start, index).trim();
			if (part) parts.push(part);
			start = index + 1;
		}
	}

	const tail = input.slice(start).trim();
	if (tail) parts.push(tail);

	return parts;
}

function isIdentifier(value: string): boolean {
	return /^[A-Za-z_$][\w$]*$/.test(value);
}
