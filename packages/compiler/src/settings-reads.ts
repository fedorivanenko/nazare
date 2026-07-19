import type { Diagnostic } from "@nazare/core";
import { NodeTypes, walk } from "@shopify/liquid-html-parser";
import type { SettingsRead } from "./ast.js";
import { spanFromOffsets } from "./source.js";

type VariableLookupLike = {
	type: "VariableLookup";
	name: string;
	lookups?: unknown[];
};

type LiquidStringLike = {
	type: "String";
	value: string;
	position: { start: number; end: number };
};

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
		const result = collectSettingsReadsFromMarkup(
			(node as { markup?: unknown }).markup,
			source,
			file,
		);
		reads.push(...result.reads);
		diagnostics.push(...result.diagnostics);
	});
	return { reads, diagnostics };
}

function collectSettingsReadsFromMarkup(
	markup: unknown,
	source: string,
	file: string,
): { reads: SettingsRead[]; diagnostics: Diagnostic[] } {
	const reads: SettingsRead[] = [];
	const diagnostics: Diagnostic[] = [];
	visitLiquidExpression(markup, source, file, diagnostics, (lookup) => {
		const read = settingsReadFromLookup(lookup, source, file);
		if (read) reads.push(read);
	});
	return { reads, diagnostics };
}

function visitLiquidExpression(
	value: unknown,
	source: string,
	file: string,
	diagnostics: Diagnostic[],
	visitLookup: (lookup: VariableLookupLike) => void,
): void {
	if (!value || typeof value !== "object") return;
	const node = value as { type?: unknown; position?: unknown };
	if (isVariableLookup(value)) {
		visitLookup(value);
		visitKnownChildren(value.lookups, source, file, diagnostics, visitLookup);
		return;
	}
	if (!node.type) {
		visitKnownChildren(value, source, file, diagnostics, visitLookup);
		return;
	}
	switch (node.type) {
		case "LiquidVariable":
			visitKnownChildren(
				value as { expression?: unknown; filters?: unknown },
				source,
				file,
				diagnostics,
				visitLookup,
			);
			return;
		case "AssignMarkup":
		case "CycleMarkup":
			visitKnownChildren(
				value as { value?: unknown; args?: unknown },
				source,
				file,
				diagnostics,
				visitLookup,
			);
			return;
		case "RenderMarkup":
			visitKnownChildren(
				value as { snippet?: unknown; variable?: unknown; args?: unknown },
				source,
				file,
				diagnostics,
				visitLookup,
			);
			return;
		case "ForMarkup":
			visitKnownChildren(
				value as { collection?: unknown; args?: unknown },
				source,
				file,
				diagnostics,
				visitLookup,
			);
			return;
		case "Range":
			visitKnownChildren(
				value as { start?: unknown; end?: unknown },
				source,
				file,
				diagnostics,
				visitLookup,
			);
			return;
		case "NamedArgument":
		case "Comparison":
		case "Condition":
		case "Filter":
			visitKnownChildren(value, source, file, diagnostics, visitLookup);
			return;
		case "String":
		case "Number":
		case "LiquidLiteral":
			return;
		default: {
			const span = expressionSpan(value, source, file);
			if (span) diagnostics.push(unscannedLiquidExpression(span));
		}
	}
}

function visitKnownChildren(
	value: unknown,
	source: string,
	file: string,
	diagnostics: Diagnostic[],
	visitLookup: (lookup: VariableLookupLike) => void,
): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) {
			visitLiquidExpression(item, source, file, diagnostics, visitLookup);
		}
		return;
	}
	const node = value as Record<string, unknown>;
	for (const key of [
		"expression",
		"filters",
		"args",
		"value",
		"lookups",
		"snippet",
		"variable",
		"collection",
		"start",
		"end",
		"left",
		"right",
		"condition",
		"children",
	]) {
		visitLiquidExpression(node[key], source, file, diagnostics, visitLookup);
	}
}

function settingsReadFromLookup(
	lookup: VariableLookupLike,
	source: string,
	file: string,
): SettingsRead | undefined {
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

function isVariableLookup(node: unknown): node is VariableLookupLike {
	return (
		!!node &&
		(node as { type?: unknown }).type === "VariableLookup" &&
		typeof (node as { name?: unknown }).name === "string"
	);
}

function isLiquidString(node: unknown): node is LiquidStringLike {
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
