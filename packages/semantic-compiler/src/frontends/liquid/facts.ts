import type { SourceAnchor } from "../../semantic/evidence.js";
import type { MechanicalFact } from "../frontend.js";

export const LIQUID_MECHANICAL_FACT_KINDS = [
	"liquid.access-path",
	"liquid.binding",
	"liquid.filter",
	"liquid.predicate",
	"liquid.condition",
	"liquid.guard",
	"liquid.render-site",
	"liquid.render-argument",
	"liquid.schema-region",
	"liquid.asset-reference",
	"liquid.locale-reference",
] as const;

export type LiquidMechanicalFactKind =
	(typeof LIQUID_MECHANICAL_FACT_KINDS)[number];

export type LiquidFact =
	| LiquidAccessPathFact
	| LiquidBindingFact
	| LiquidFilterFact
	| LiquidPredicateFact
	| LiquidConditionFact
	| LiquidGuardFact
	| LiquidRenderSiteFact
	| LiquidRenderArgumentFact
	| LiquidSchemaRegionFact
	| LiquidAssetReferenceFact
	| LiquidLocaleReferenceFact;

export type LiquidAccessPathFact = LiquidFactBase<"liquid.access-path"> & {
	access: "read";
	path: LiquidAccessPath;
	context: LiquidReadContext;
};

export type LiquidBindingFact = LiquidFactBase<"liquid.binding"> & {
	name: string;
	nameEvidence: SourceAnchor;
	scopeEvidence: SourceAnchor;
} & LiquidBindingSource;

/** One filter invocation; target analysis decides whether it is a known transform. */
export type LiquidFilterFact = LiquidFactBase<"liquid.filter"> & {
	name: string;
	nameEvidence: SourceAnchor;
	input: LiquidExpressionSource;
	arguments: readonly LiquidExpressionSource[];
};

export type LiquidPredicateFact = LiquidFactBase<"liquid.predicate"> & {
	operator: LiquidPredicateOperator;
	operands: readonly [LiquidPredicateOperand, ...LiquidPredicateOperand[]];
};

export type LiquidConditionFact = LiquidFactBase<"liquid.condition"> & {
	construct: LiquidConditionConstruct;
	predicateEvidence: readonly SourceAnchor[];
	bodyEvidence: SourceAnchor;
};

/** Syntax scope guarded by one branch, not a target-level runtime conclusion. */
export type LiquidGuardFact = LiquidFactBase<"liquid.guard"> & {
	conditionEvidence: SourceAnchor;
	guardedEvidence: SourceAnchor;
	outcome: "true" | "false" | "case-match";
};

export type LiquidRenderSiteFact = LiquidFactBase<"liquid.render-site"> & {
	target: LiquidReference;
};

export type LiquidRenderArgumentFact =
	LiquidFactBase<"liquid.render-argument"> & {
		renderSiteEvidence: SourceAnchor;
		argument: LiquidRenderArgument;
	};

/** Raw Liquid `{% schema %}` body; JSON interpretation is separate frontend work. */
export type LiquidSchemaRegionFact = LiquidFactBase<"liquid.schema-region"> & {
	contentEvidence: SourceAnchor;
};

export type LiquidAssetReferenceFact =
	LiquidFactBase<"liquid.asset-reference"> & {
		syntax: LiquidAssetReferenceSyntax;
		reference: LiquidReference;
	};

export type LiquidLocaleReferenceFact =
	LiquidFactBase<"liquid.locale-reference"> & {
		syntax: "translation-filter";
		key: LiquidReference;
	};

type LiquidFactBase<Kind extends LiquidMechanicalFactKind> =
	MechanicalFact<Kind>;

export type LiquidAccessPath = {
	root: LiquidIdentifier;
	segments: readonly LiquidAccessPathSegment[];
};

export type LiquidIdentifier = {
	name: string;
	evidence: SourceAnchor;
};

export type LiquidAccessPathSegment =
	| {
			kind: "property";
			name: string;
			evidence: SourceAnchor;
	  }
	| {
			kind: "index";
			expressionEvidence: SourceAnchor;
	  };

export type LiquidReadContext =
	| "output"
	| "assignment"
	| "condition"
	| "render-argument"
	| "filter-input"
	| "tag-argument";

export type LiquidBindingSource =
	| {
			binding: "assign" | "for" | "tablerow" | "paginate";
			value: LiquidExpressionSource;
	  }
	| { binding: "capture"; bodyEvidence: SourceAnchor }
	| { binding: "increment" | "decrement" };

export type LiquidBindingKind = LiquidBindingSource["binding"];

export type LiquidPredicateOperator =
	| "equal"
	| "not-equal"
	| "contains"
	| "greater-than"
	| "greater-than-or-equal"
	| "less-than"
	| "less-than-or-equal"
	| "and"
	| "or";

export type LiquidPredicateOperand =
	| { kind: "access-path"; path: LiquidAccessPath }
	| { kind: "string"; value: string; evidence: SourceAnchor }
	| { kind: "number"; value: number; evidence: SourceAnchor }
	| { kind: "boolean"; value: boolean; evidence: SourceAnchor }
	| { kind: "nil"; evidence: SourceAnchor }
	| { kind: "empty"; evidence: SourceAnchor }
	| { kind: "blank"; evidence: SourceAnchor };

export type LiquidConditionConstruct =
	| "if"
	| "unless"
	| "elsif"
	| "case"
	| "when";

/** Literal reference stays syntax fact; dynamic expression remains unresolved. */
export type LiquidReference =
	| { kind: "literal"; value: string; evidence: SourceAnchor }
	| { kind: "dynamic"; expressionEvidence: SourceAnchor };

export type LiquidRenderArgument =
	| {
			kind: "named";
			name: string;
			nameEvidence: SourceAnchor;
			value: LiquidExpressionSource;
	  }
	| {
			kind: "with";
			value: LiquidExpressionSource;
			alias?: LiquidIdentifier;
	  }
	| {
			kind: "for";
			value: LiquidExpressionSource;
			alias?: LiquidIdentifier;
	  };

export type LiquidExpressionSource = {
	text: string;
	evidence: SourceAnchor;
};

export type LiquidAssetReferenceSyntax =
	| "asset-url-filter"
	| "asset-image-url-filter"
	| "stylesheet-tag-filter"
	| "script-tag-filter"
	| "inline-asset-content-filter";
