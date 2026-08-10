import type { OntologyKind, OntologyReference } from "../ontology/core.js";
import type { ParsedDocument } from "../parsers/parser.js";
import type { SourceAnchor, SourceRange } from "../semantic/evidence.js";

/** Exact, source-local syntax observation emitted before target projection. */
export type MechanicalFact<Kind extends OntologyKind = OntologyKind> = {
	kind: Kind;
	evidence: SourceAnchor;
};

export type FrontendLimits = {
	maxFacts: number;
	maxWork: number;
};

export type FrontendInput<Document> = {
	document: Document;
	limits: FrontendLimits;
};

export type FrontendResult<Fact extends MechanicalFact> = {
	path: string;
	language: string;
	frontend: {
		id: string;
		version: number;
	};
	facts: readonly Fact[];
	diagnostics: readonly FrontendDiagnostic[];
	boundaries: readonly FrontendBoundary[];
	coverage: readonly FrontendCoverage[];
	work: {
		visited: number;
		emitted: number;
	};
};

export type FrontendDiagnostic = {
	severity: "error" | "warning" | "information";
	code: string;
	message: string;
	range?: SourceRange;
};

/** Source-extraction limitation. Runtime/domain boundaries belong downstream. */
export type FrontendBoundary = {
	id: string;
	kind: "dynamic-syntax" | "unsupported-syntax" | "budget";
	message: string;
	range?: SourceRange;
};

/** Coverage is per source document and one mechanical fact family. */
export type FrontendCoverage = {
	family: OntologyKind;
	status: "complete" | "partial" | "unsupported";
	boundaryIds: readonly string[];
};

/**
 * Deterministic source-local projection from parser document to mechanical facts.
 * Frontends perform no filesystem lookup, target resolution, or runtime inference.
 */
export interface Frontend<
	Document extends ParsedDocument<unknown>,
	Fact extends MechanicalFact,
> {
	readonly id: string;
	readonly version: number;
	readonly languages: readonly string[];
	readonly ontology: OntologyReference;
	/** Subset of fact kinds registered by `ontology`. */
	readonly factKinds: readonly Fact["kind"][];

	extract(input: FrontendInput<Document>): FrontendResult<Fact>;
}

/** Preserves concrete document/fact inference when declaring a frontend. */
export function defineFrontend<
	Document extends ParsedDocument<unknown>,
	Fact extends MechanicalFact,
>(frontend: Frontend<Document, Fact>): Frontend<Document, Fact> {
	return frontend;
}
