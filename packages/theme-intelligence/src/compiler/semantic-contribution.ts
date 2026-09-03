import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticDiagnostic,
	SemanticEntity,
	SemanticOccurrence,
	SemanticPredicate,
	SemanticRelation,
	SemanticValue,
} from "../outputs/semantic-graph-snapshot.js";

/** Canonically ordered records projected from one bounded compiler input scope. */
export type SemanticContribution = {
	scope: {
		paths: readonly string[];
		languages: readonly string[];
	};
	entities: readonly SemanticEntity[];
	occurrences: readonly SemanticOccurrence[];
	relations: readonly SemanticRelation[];
	values: readonly SemanticValue[];
	predicates: readonly SemanticPredicate[];
	boundaries: readonly SemanticBoundary[];
	coverage: readonly SemanticCoverage[];
	diagnostics: readonly SemanticDiagnostic[];
};
