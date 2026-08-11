import type { SourceAnchor } from "../../semantic/evidence.js";
import type { MechanicalFact } from "../frontend.js";

export const JAVASCRIPT_MECHANICAL_FACT_KINDS = [
	"javascript.class-list-operation",
] as const;

export type JavaScriptMechanicalFactKind =
	(typeof JAVASCRIPT_MECHANICAL_FACT_KINDS)[number];

export type JavaScriptFact = JavaScriptClassListOperationFact;

export type JavaScriptClassListOperationFact =
	MechanicalFact<"javascript.class-list-operation"> & {
		action: "reads" | "adds" | "removes" | "toggles";
		name: string;
		nameEvidence: SourceAnchor;
		operationEvidence: SourceAnchor;
	};
