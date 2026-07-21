// The one structural walker over Liquid expression markup. Both the
// settings-read scanner and the theme fact extractors ride on it, so what
// counts as a scannable expression shape is decided exactly once. Unknown
// shapes are surfaced through onUnscanned — extraction over expressions is
// explicit about its own coverage, never silently partial.
import { isVariableLookup, type VariableLookupLike } from "./liquid-ast.js";

export type SourceRange = { start: number; end: number };

export type LiquidVariableLike = {
	type: "LiquidVariable";
	expression?: unknown;
	filters?: unknown;
	position?: SourceRange;
};

export type LiquidFilterLike = {
	type: "LiquidFilter";
	name: string;
	args?: unknown;
	position?: SourceRange;
};

export type RenderMarkupLike = {
	type: "RenderMarkup";
	snippet?: unknown;
	variable?: {
		type?: unknown;
		kind?: unknown;
		name?: unknown;
		position?: SourceRange;
	};
	alias?: { type?: unknown; value?: unknown; position?: SourceRange } | null;
	args?: unknown;
	position?: SourceRange;
};

export type NamedArgumentLike = {
	type: "NamedArgument";
	name: string;
	value?: unknown;
	position?: SourceRange;
};

export type AssignMarkupLike = {
	type: "AssignMarkup";
	name: string;
	value?: unknown;
	position?: SourceRange;
};

export type ForMarkupLike = {
	type: "ForMarkup";
	variableName?: string;
	collection?: unknown;
	position?: SourceRange;
};

export type PositionedLookup = VariableLookupLike & { position?: SourceRange };

export type LiquidExpressionVisitor = {
	onLookup?: (lookup: PositionedLookup) => void;
	onVariable?: (variable: LiquidVariableLike) => void;
	onFilter?: (filter: LiquidFilterLike) => void;
	onAssign?: (markup: AssignMarkupLike) => void;
	onFor?: (markup: ForMarkupLike) => void;
	/** An expression node shape this walker does not model. */
	onUnscanned?: (value: unknown) => void;
};

export function visitLiquidExpressions(
	value: unknown,
	visitor: LiquidExpressionVisitor,
): void {
	if (!value || typeof value !== "object") return;
	const node = value as { type?: unknown };
	if (isVariableLookup(value)) {
		visitor.onLookup?.(value as PositionedLookup);
		visitKnownChildren((value as VariableLookupLike).lookups, visitor);
		return;
	}
	if (!node.type) {
		visitKnownChildren(value, visitor);
		return;
	}
	switch (node.type) {
		case "LiquidVariable":
			visitor.onVariable?.(value as LiquidVariableLike);
			visitKnownChildren(value, visitor);
			return;
		case "LiquidFilter":
			visitor.onFilter?.(value as LiquidFilterLike);
			visitKnownChildren(value, visitor);
			return;
		case "AssignMarkup":
			visitor.onAssign?.(value as AssignMarkupLike);
			visitKnownChildren(value, visitor);
			return;
		case "ForMarkup":
			visitor.onFor?.(value as ForMarkupLike);
			visitKnownChildren(value, visitor);
			return;
		case "CycleMarkup":
		case "RenderMarkup":
		case "RenderVariableExpression":
		case "RenderAliasExpression":
		case "NamedArgument":
		case "Comparison":
		case "Condition":
			visitKnownChildren(value, visitor);
			return;
		case "Range":
			visitKnownChildren(value, visitor);
			return;
		case "String":
		case "Number":
		case "LiquidLiteral":
			return;
		default:
			visitor.onUnscanned?.(value);
	}
}

function visitKnownChildren(
	value: unknown,
	visitor: LiquidExpressionVisitor,
): void {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) visitLiquidExpressions(item, visitor);
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
		"alias",
		"name",
		"collection",
		"start",
		"end",
		"left",
		"right",
		"condition",
		"children",
	]) {
		visitLiquidExpressions(node[key], visitor);
	}
}
