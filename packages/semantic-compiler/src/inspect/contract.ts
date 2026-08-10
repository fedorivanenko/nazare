import type { JsonValue } from "../semantic/record.js";

export const SEMANTIC_INSPECT_CONTRACT_VERSION = 1 as const;

export type SemanticInspectRequest =
	| {
			query: string;
			kinds?: readonly ("file" | "snippet" | "render" | "expression")[];
			evidence?: InspectEvidenceMode;
			limit?: number;
			cursor?: string;
	  }
	| {
			subject: SemanticInspectSubject;
			facet?: InspectFacet;
			evidence?: InspectEvidenceMode;
			limit?: number;
			cursor?: string;
	  };

export type SemanticInspectSubject =
	| { type: "file"; path: string }
	| { type: "snippet"; handle: string }
	| { type: "render"; path: string; offset: number }
	| { type: "expression"; path: string; offset: number };

export type InspectFacet =
	| "summary"
	| "dependencies"
	| "dependents"
	| "usages"
	| "occurrences";

export type InspectEvidenceMode = "none" | "location" | "excerpt";

export type SemanticInspectResponse = {
	contractVersion: typeof SEMANTIC_INSPECT_CONTRACT_VERSION;
	revision: {
		id: string;
		repositoryFingerprint: string;
	};
	status:
		| "found"
		| "not-found"
		| "ambiguous"
		| "external-data-required"
		| "unsupported";
	subject: Readonly<Record<string, JsonValue>>;
	facet: "discover" | InspectFacet;
	answer?: {
		summary?: Readonly<Record<string, JsonValue>>;
		groups?: readonly InspectGroup[];
	};
	candidates?: readonly InspectItem[];
	completeness: InspectCompleteness;
	page?: InspectPage;
};

export type InspectGroup = {
	kind: InspectItem["type"];
	total: number;
	items: readonly InspectItem[];
};

export type InspectItem =
	| InspectFileItem
	| InspectSnippetItem
	| InspectRenderItem
	| InspectExpressionItem
	| InspectOccurrenceItem;

export type InspectItemAssertion = {
	certainty: "proven" | "inferred";
	/** Retrieval rank only; never changes semantic certainty. */
	retrieval?: {
		match: "exact" | "normalized" | "inferred";
		score: number;
	};
	availability:
		| "static"
		| "runtime-dependent"
		| "external-data-required"
		| "unsupported";
	evidence?: readonly InspectLocation[];
};

export type InspectFileItem = InspectItemAssertion & {
	type: "file";
	path: string;
	role: string;
};

export type InspectSnippetItem = InspectItemAssertion & {
	type: "snippet";
	handle: string;
	path: string;
	defined: boolean;
	resolution?: "repository-exact" | "literal-convention" | "not-found";
};

export type InspectRenderItem = InspectItemAssertion & {
	type: "render";
	path: string;
	offset: number;
	target: string;
	targetKind: "literal" | "dynamic";
	resolution?: "repository-exact" | "literal-convention" | "not-found";
	arguments?: readonly {
		kind: string;
		name?: string;
		expression: string;
		availability: InspectItemAssertion["availability"];
		value?: InspectValue;
	}[];
	guards?: readonly {
		operator: string;
		expression: string;
		availability: InspectItemAssertion["availability"];
	}[];
};

export type InspectExpressionItem = InspectItemAssertion & {
	type: "expression";
	path: string;
	offset: number;
	expression: string;
	context: string;
	root: string;
	segments: readonly JsonValue[];
	value?: InspectValue;
};

export type InspectValue = {
	representation:
		| "literal"
		| "expression"
		| "derived"
		| "reference"
		| "unavailable";
	authority:
		| "authored-source"
		| "merchant-owned"
		| "generated-output"
		| "external-snapshot"
		| "runtime";
	availability: InspectItemAssertion["availability"];
	expression?: string;
	resolved?: JsonValue;
	lineageTruncated?: true;
	derivedFrom?: readonly {
		role: string;
		expression?: string;
		resolved?: JsonValue;
		availability: InspectItemAssertion["availability"];
		evidence?: readonly InspectLocation[];
	}[];
};

export type InspectOccurrenceItem = InspectItemAssertion & {
	type: "occurrence";
	kind: string;
	path: string;
	offset: number;
	attributes: Readonly<Record<string, JsonValue>>;
};

export type InspectLocation = {
	path: string;
	start: number;
	end: number;
	line?: number;
	character?: number;
	excerpt?: string;
};

export type InspectCompleteness = {
	status:
		| "complete"
		| "partial"
		| "runtime-dependent"
		| "external-data-required"
		| "unsupported";
	scope: {
		paths?: readonly string[];
		families: readonly string[];
	};
	reasons?: readonly {
		code: string;
		message: string;
	}[];
	additionalReasons?: number;
};

export type InspectPage = {
	total: number;
	returned: number;
	nextCursor?: string;
};
