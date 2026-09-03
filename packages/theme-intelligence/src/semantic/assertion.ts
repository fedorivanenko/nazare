import type { OntologyKind, SourceAuthority } from "../ontology/core.js";
import type { SourceAnchor } from "./evidence.js";
import type { SemanticBoundaryId, SemanticRecordId } from "./record.js";

/** Confidence, availability, and provenance are independent dimensions. */
export type AssertionMetadata = {
	epistemic: {
		status: "proven" | "inferred";
		basis:
			| "syntax"
			| "convention"
			| "resolution"
			| "bounded-analysis"
			| "external-snapshot";
	};
	availability:
		| "static"
		| "runtime-dependent"
		| "external-data-required"
		| "unsupported";
	provenance: SemanticProvenance;
	evidence: readonly SourceAnchor[];
	derivation?: SemanticDerivation;
	boundaryIds: readonly SemanticBoundaryId[];
};

export type SemanticProvenance = {
	authorities: readonly SourceAuthority[];
	sourceIds: readonly SemanticRecordId[];
};

export type SemanticDerivation = {
	rule: OntologyKind;
	inputIds: readonly SemanticRecordId[];
	depth: number;
	work: number;
};
