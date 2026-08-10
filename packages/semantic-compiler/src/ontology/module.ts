import type { BoundaryKind, OntologyKind, PredicateOperator } from "./core.js";

/** Declarative, versioned semantic vocabulary supplied to the compiler. */
export type OntologyModule = {
	namespace: string;
	version: number;
	entityKinds: readonly OntologyEntityKind[];
	occurrenceKinds: readonly OntologyOccurrenceKind[];
	relationKinds: readonly OntologyRelationKind[];
	valueSlots: readonly OntologyValueSlot[];
	predicateKinds: readonly OntologyPredicateKind[];
	boundaryKinds: readonly BoundaryKind[];
	coverageFamilies: readonly OntologyCoverageFamily[];
};

export type OntologyEntityKind = {
	kind: OntologyKind;
	identity: readonly OntologyIdentityComponent[];
	attributes: readonly OntologyAttribute[];
};

export type OntologyOccurrenceKind = {
	kind: OntologyKind;
	ownerKinds: readonly OntologyKind[];
	attributes: readonly OntologyAttribute[];
};

export type OntologyRelationKind = {
	kind: OntologyKind;
	from: OntologyEndpoint;
	to: OntologyEndpoint;
	attributes: readonly OntologyAttribute[];
	allowsGuards: boolean;
};

export type OntologyValueSlot = {
	kind: OntologyKind;
	ownerKinds: readonly OntologyKind[];
	attributes: readonly OntologyAttribute[];
};

export type OntologyPredicateKind = {
	kind: OntologyKind;
	operators: readonly PredicateOperator[];
	attributes: readonly OntologyAttribute[];
};

export type OntologyCoverageFamily = {
	kind: OntologyKind;
	description: string;
};

export type OntologyEndpoint = {
	categories: readonly ("entity" | "occurrence")[];
	kinds: readonly OntologyKind[];
};

export type OntologyIdentityComponent = {
	name: string;
	type: "string" | "number" | "boolean";
	required: boolean;
	normalization?: "none" | "lowercase" | "path";
};

export type OntologyAttribute = {
	name: string;
	type: OntologyAttributeType;
	required: boolean;
};

export type OntologyAttributeType =
	| "string"
	| "number"
	| "boolean"
	| "null"
	| "array"
	| "object";
