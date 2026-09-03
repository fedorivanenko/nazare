import type {
	BoundaryKind,
	CoverageStatus,
	OntologyKind,
	OntologyReference,
	PredicateOperator,
	SourceAuthority,
	ValueRepresentation,
} from "../ontology/core.js";
import type { AssertionMetadata } from "../semantic/assertion.js";
import type { SourceAnchor } from "../semantic/evidence.js";
import type {
	JsonScalar,
	JsonValue,
	SemanticAttributes,
	SemanticBoundaryId,
	SemanticEntityId,
	SemanticOccurrenceId,
	SemanticPredicateId,
	SemanticRecordId,
	SemanticRelationId,
	SemanticValueId,
} from "../semantic/record.js";

/**
 * Internal, serializable compiler output. Inspect projects bounded domain views
 * from this snapshot and must not expose its record IDs as public API.
 *
 * Snapshot invariants:
 * - every ID is unique and every reference resolves;
 * - every namespaced kind is declared by a listed ontology version;
 * - every assertion states confidence, availability, provenance, and evidence;
 * - completeness is claimed only through scoped coverage records;
 * - arrays use deterministic canonical ordering.
 */
export const SEMANTIC_GRAPH_SNAPSHOT_VERSION = 1 as const;

export type SemanticGraphSnapshot = {
	contractVersion: typeof SEMANTIC_GRAPH_SNAPSHOT_VERSION;
	revision: SemanticRevision;
	ontologies: readonly OntologyReference[];
	entities: readonly SemanticEntity[];
	occurrences: readonly SemanticOccurrence[];
	relations: readonly SemanticRelation[];
	values: readonly SemanticValue[];
	predicates: readonly SemanticPredicate[];
	boundaries: readonly SemanticBoundary[];
	coverage: readonly SemanticCoverage[];
	diagnostics: readonly SemanticDiagnostic[];
};

/** Snapshot identity changes when any semantic input or ontology changes. */
export type SemanticRevision = {
	id: string;
	compilerVersion: string;
	repositoryFingerprint: string;
	git?: {
		commit: string;
		dirty: boolean;
	};
	externalInputs: Readonly<Record<string, string>>;
};

export type SemanticEntity = {
	id: SemanticEntityId;
	kind: OntologyKind;
	identity: SemanticIdentity;
	name?: string;
	path?: string;
	attributes: SemanticAttributes;
	assertion: AssertionMetadata;
};

/** Exact source use. Occurrences retain repeated calls, guards, and evidence. */
export type SemanticOccurrence = {
	id: SemanticOccurrenceId;
	kind: OntologyKind;
	ownerId?: SemanticEntityId;
	name?: string;
	attributes: SemanticAttributes;
	assertion: AssertionMetadata;
};

export type SemanticIdentity = {
	scheme: OntologyKind;
	components: Readonly<Record<string, JsonScalar>>;
};

export type SemanticRelation = {
	id: SemanticRelationId;
	kind: OntologyKind;
	from: SemanticEntityId | SemanticOccurrenceId;
	to: SemanticEntityId | SemanticOccurrenceId;
	guards: readonly SemanticPredicateId[];
	attributes: SemanticAttributes;
	assertion: AssertionMetadata;
};

/** Value ownership is separate from source authority and representation. */
export type SemanticValue = {
	id: SemanticValueId;
	ownerId: SemanticEntityId | SemanticOccurrenceId;
	slot: OntologyKind;
	representation: ValueRepresentation;
	authority: SourceAuthority;
	expression?: string;
	resolved?: JsonValue;
	sourceValueIds: readonly SemanticValueId[];
	attributes: SemanticAttributes;
	assertion: AssertionMetadata;
};

export type SemanticPredicate = {
	id: SemanticPredicateId;
	kind: OntologyKind;
	operator: PredicateOperator;
	operands: readonly PredicateOperand[];
	attributes: SemanticAttributes;
	assertion: AssertionMetadata;
};

export type PredicateOperand =
	| { kind: "value"; valueId: SemanticValueId }
	| {
			kind: "subject";
			subjectId: SemanticEntityId | SemanticOccurrenceId;
	  }
	| { kind: "predicate"; predicateId: SemanticPredicateId }
	| { kind: "literal"; value: JsonValue };

/** Why an otherwise plausible answer cannot be strengthened further. */
export type SemanticBoundary = {
	id: SemanticBoundaryId;
	kind: BoundaryKind;
	message: string;
	subjectIds: readonly SemanticRecordId[];
	evidence: readonly SourceAnchor[];
	attributes: SemanticAttributes;
};

/** Completeness claim applies only to one extractor family and explicit scope. */
export type SemanticCoverage = {
	id: string;
	family: OntologyKind;
	scope: CoverageScope;
	status: CoverageStatus;
	extractor?: {
		id: string;
		version: number;
	};
	boundaryIds: readonly SemanticBoundaryId[];
};

export type CoverageScope = {
	paths?: readonly string[];
	languages?: readonly string[];
	kinds?: readonly OntologyKind[];
	subjectIds?: readonly SemanticRecordId[];
};

export type SemanticDiagnostic = {
	severity: "error" | "warning" | "information";
	code: string;
	message: string;
	evidence: readonly SourceAnchor[];
};
