import type { SourceAnchor } from "../../semantic/evidence.js";
import type { MechanicalFact } from "../frontend.js";

export const CSS_MECHANICAL_FACT_KINDS = ["css.class-selector"] as const;

export type CssMechanicalFactKind = (typeof CSS_MECHANICAL_FACT_KINDS)[number];

export type CssFact = CssClassSelectorFact;

export type CssClassSelectorFact = MechanicalFact<"css.class-selector"> & {
	name: string;
	nameEvidence: SourceAnchor;
	selectorEvidence: SourceAnchor;
};
