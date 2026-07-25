import type { Diagnostic } from "@nazare/core";
import { NodeTypes, walk } from "@shopify/liquid-html-parser";
import type { SettingsRead } from "./ast.js";
import { isLiquidString, type VariableLookupLike } from "./liquid-ast.js";
import { visitLiquidExpressions } from "./liquid-expressions.js";
import { spanFromOffsets } from "./source.js";

/**
 * Locates every literal settings.x / section.settings.x / block.settings.x
 * read in the file's Liquid expression regions. Also the sole reporter of unscannable
 * expression shapes (LIQUID_UNSCANNED_SETTINGS_EXPRESSION) — other extractors
 * walking the same regions rely on this warning instead of re-reporting.
 */
export function scanSettingsReadsFromLiquidAst(
	ast: Parameters<typeof walk>[0],
	source: string,
	file: string,
): { reads: SettingsRead[]; diagnostics: Diagnostic[] } {
	const reads: SettingsRead[] = [];
	const diagnostics: Diagnostic[] = [];
	walk(ast, (node) => {
		if (node.type === NodeTypes.LiquidRawTag) return;
		if (node.type === NodeTypes.LiquidTag && node.name === "comment") return;
		if (
			node.type !== NodeTypes.LiquidVariableOutput &&
			node.type !== NodeTypes.LiquidTag &&
			node.type !== NodeTypes.LiquidBranch
		)
			return;
		visitLiquidExpressions((node as { markup?: unknown }).markup, {
			onLookup: (lookup) => {
				const read = settingsReadFromLookup(lookup, source, file);
				if (read) reads.push(read);
			},
			onUnscanned: (value) => {
				const span = expressionSpan(value, source, file);
				if (span) diagnostics.push(unscannedLiquidExpression(span));
			},
		});
	});
	return { reads, diagnostics };
}

function settingsReadFromLookup(
	lookup: VariableLookupLike,
	source: string,
	file: string,
): SettingsRead | undefined {
	if (lookup.name === "settings") {
		const [name] = lookup.lookups ?? [];
		if (!isLiquidString(name)) return undefined;
		return {
			object: "settings",
			name: name.value,
			span: spanFromOffsets(source, file, name.position),
		};
	}
	if (lookup.name !== "section" && lookup.name !== "block") return undefined;
	const [settings, name] = lookup.lookups ?? [];
	if (!isLiquidString(settings) || settings.value !== "settings") {
		return undefined;
	}
	if (!isLiquidString(name)) return undefined;
	return {
		object: lookup.name,
		name: name.value,
		span: spanFromOffsets(source, file, name.position),
	};
}

function unscannedLiquidExpression(
	span: NonNullable<SettingsRead["span"]>,
): Diagnostic {
	return {
		severity: "warning",
		code: "LIQUID_UNSCANNED_SETTINGS_EXPRESSION",
		message:
			"Could not scan this Liquid expression shape for settings reads; setting facts may be incomplete",
		span,
	};
}

function expressionSpan(
	value: unknown,
	source: string,
	file: string,
): NonNullable<SettingsRead["span"]> | undefined {
	const position = (value as { position?: unknown } | undefined)?.position;
	if (
		position &&
		typeof (position as { start?: unknown }).start === "number" &&
		typeof (position as { end?: unknown }).end === "number"
	) {
		return spanFromOffsets(
			source,
			file,
			position as { start: number; end: number },
		);
	}
	return undefined;
}
