// Helpers over the Shopify LiquidHTML AST shared by the Nazare and plain
// Liquid frontends: raw tag markup, the authored {% schema %} block, parse
// crash reporting, and the untyped expression-node guards. One definition
// each — the two frontends must not drift on these.
import type { Diagnostic, SourceSpan } from "@nazare/core";
import { NodeTypes, type toLiquidHtmlAST } from "@shopify/liquid-html-parser";
import type { AuthoredSchema } from "./ast.js";
import { parseLiquidCrash } from "./diagnostics.js";
import { spanFromOffsets } from "./source.js";

export type LiquidStringLike = {
	type: "String";
	value: string;
	position: { start: number; end: number };
};

export type VariableLookupLike = {
	type: "VariableLookup";
	name: string;
	lookups?: unknown[];
};

/** The raw markup of a {% name … %} tag, tag delimiters stripped. */
export function liquidTagMarkup(
	source: string,
	position: { start: number; end: number },
	name: string,
): string {
	const raw = source.slice(position.start, position.end);
	return raw
		.replace(new RegExp(`^\\s*\\{%-?\\s*${name}\\b`), "")
		.replace(/-?%}\s*$/, "")
		.trim();
}

/** The authored top-level {% schema %} raw block, body unparsed. */
export function extractAuthoredSchema(
	ast: ReturnType<typeof toLiquidHtmlAST>,
	source: string,
	file: string,
): AuthoredSchema | undefined {
	for (const node of ast.children) {
		if (node.type !== NodeTypes.LiquidRawTag || node.name !== "schema") {
			continue;
		}
		return {
			source: node.body.value,
			span: spanFromOffsets(source, file, node.position),
		};
	}
	return undefined;
}

/** A thrown LiquidHTML parser error as a located diagnostic. */
export function parseLiquidError(error: unknown, file: string): Diagnostic {
	const loc = (error as { loc?: { start?: { line: number; column: number } } })
		.loc;
	const start = loc?.start ?? { line: 1, column: 1 };
	return parseLiquidCrash(
		error instanceof Error ? error.message : String(error),
		{ file, start, end: start },
	);
}

export function isVariableLookup(node: unknown): node is VariableLookupLike {
	return (
		!!node &&
		(node as { type?: unknown }).type === "VariableLookup" &&
		typeof (node as { name?: unknown }).name === "string"
	);
}

export function isLiquidString(node: unknown): node is LiquidStringLike {
	const position = (node as { position?: unknown } | undefined)?.position;
	return (
		!!node &&
		(node as { type?: unknown }).type === "String" &&
		typeof (node as { value?: unknown }).value === "string" &&
		!!position &&
		typeof (position as { start?: unknown }).start === "number" &&
		typeof (position as { end?: unknown }).end === "number"
	);
}
