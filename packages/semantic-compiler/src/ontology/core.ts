/** Registered namespaced kind, for example `shopify.section`. */
export type OntologyKind = `${string}.${string}`;

export type OntologyReference = {
	namespace: string;
	version: number;
};

export type ValueRepresentation =
	| "literal"
	| "expression"
	| "derived"
	| "reference"
	| "unavailable";

export type SourceAuthority =
	| "authored-source"
	| "merchant-owned"
	| "generated-output"
	| "external-snapshot"
	| "runtime";

export type PredicateOperator =
	| "truthy"
	| "falsy"
	| "equal"
	| "not-equal"
	| "contains"
	| "not-contains"
	| "greater-than"
	| "greater-than-or-equal"
	| "less-than"
	| "less-than-or-equal"
	| "blank"
	| "not-blank"
	| "and"
	| "or"
	| "not";

export type BoundaryKind =
	| "dynamic-target"
	| "runtime-condition"
	| "merchant-configuration"
	| "shopify-runtime"
	| "browser-runtime"
	| "external-data"
	| "generated-source"
	| "unsupported"
	| "budget"
	| "ambiguous-join";

export type CoverageStatus =
	| "complete"
	| "partial"
	| "unsupported"
	| "runtime-dependent"
	| "external-data-required";
