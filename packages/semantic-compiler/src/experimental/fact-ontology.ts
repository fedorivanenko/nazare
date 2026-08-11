import type {
	CoverageStatus,
	SourceAuthority,
	ValueRepresentation,
} from "../ontology/core.js";
import type { JsonValue } from "../semantic/record.js";

export const FACT_ONTOLOGY_SNAPSHOT_VERSION = 2 as const;

export type FactOntologyRef = string;
export type ArtifactRef = FactOntologyRef;
export type SymbolRef = FactOntologyRef;
export type ValueRef = FactOntologyRef;
export type OperationRef = FactOntologyRef;
export type ConditionRef = FactOntologyRef;
export type SourceRef = FactOntologyRef;
export type FactRef = FactOntologyRef;

export type FactOntologyScope = {
	artifact: ArtifactRef;
	start?: number;
	end?: number;
};

export type FactOntologyArtifact = {
	ref: ArtifactRef;
	kind: "source" | "generated" | "external-snapshot";
	path: string;
	language?: string;
	role?: string;
};

export type FactOntologySymbol = {
	ref: SymbolRef;
	kind: string;
	namespace: string;
	name: string;
	scope?: FactOntologyScope;
};

export type FactOntologyValue = {
	ref: ValueRef;
	representation: ValueRepresentation;
	authority: SourceAuthority;
	resolvability:
		| "static"
		| "runtime-dependent"
		| "external-data-required"
		| "unsupported";
	expression?: string;
	resolved?: JsonValue;
};

export type FactOntologyOperation = {
	ref: OperationRef;
	kind: string;
	scope: FactOntologyScope;
	sources: readonly SourceRef[];
};

export type FactOntologyCondition = {
	ref: ConditionRef;
	operator: string;
	expression: string;
	scope?: FactOntologyScope;
	sources: readonly SourceRef[];
};

export type FactOntologySource = {
	ref: SourceRef;
	artifact: ArtifactRef;
	range: { start: number; end: number };
	line?: number;
	character?: number;
	role?: "primary" | "supporting" | "derivation-input";
};

export type PrimaryFactPredicate =
	| "DECLARES"
	| "BINDS"
	| "DERIVES_FROM"
	| "USES"
	| "PASSES"
	| "CALLS"
	| "GUARDED_BY";

export type FactOntologyFact = {
	ref: FactRef;
	claim: {
		subject: FactOntologyRef;
		predicate: PrimaryFactPredicate;
		object: FactOntologyRef;
		attributes?: Readonly<Record<string, JsonValue>>;
	};
	assertion: {
		certainty: "proven" | "inferred";
		basis:
			| "syntax"
			| "convention"
			| "resolution"
			| "bounded-analysis"
			| "external-snapshot";
		authority: readonly SourceAuthority[];
		evidence: readonly SourceRef[];
	};
	evaluation:
		| "static"
		| "runtime-dependent"
		| "external-data-required"
		| "unsupported";
	execution: "unconditional" | "conditional";
	guards?: readonly ConditionRef[];
};

export type FactOntologyCoverage = {
	family: string;
	status: CoverageStatus;
	scope: {
		artifacts?: readonly ArtifactRef[];
		languages?: readonly string[];
		kinds?: readonly string[];
	};
	reasons?: readonly { code: string; message: string }[];
};

export type FactOntologySnapshot = {
	contractVersion: typeof FACT_ONTOLOGY_SNAPSHOT_VERSION;
	revision: {
		id: string;
		repositoryFingerprint: string;
	};
	artifacts: readonly FactOntologyArtifact[];
	symbols: readonly FactOntologySymbol[];
	values: readonly FactOntologyValue[];
	operations: readonly FactOntologyOperation[];
	conditions: readonly FactOntologyCondition[];
	sources: readonly FactOntologySource[];
	facts: readonly FactOntologyFact[];
	coverage: readonly FactOntologyCoverage[];
};

export class FactOntologyValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FactOntologyValidationError";
	}
}

export function validateFactOntologySnapshot(
	snapshot: FactOntologySnapshot,
): void {
	if (snapshot.contractVersion !== FACT_ONTOLOGY_SNAPSHOT_VERSION) {
		throw new FactOntologyValidationError(
			`Expected Fact ontology version ${FACT_ONTOLOGY_SNAPSHOT_VERSION}, got ${String(snapshot.contractVersion)}`,
		);
	}
	const categories = new Map<FactOntologyRef, string>();
	for (const [category, records] of [
		["artifact", snapshot.artifacts],
		["symbol", snapshot.symbols],
		["value", snapshot.values],
		["operation", snapshot.operations],
		["condition", snapshot.conditions],
		["source", snapshot.sources],
		["fact", snapshot.facts],
	] as const) {
		for (const record of records) {
			if (categories.has(record.ref)) {
				throw new FactOntologyValidationError(`Duplicate ref ${record.ref}`);
			}
			categories.set(record.ref, category);
		}
	}
	for (const source of snapshot.sources) {
		requireCategory(categories, source.artifact, ["artifact"], source.ref);
	}
	for (const operation of snapshot.operations) {
		requireCategory(
			categories,
			operation.scope.artifact,
			["artifact"],
			operation.ref,
		);
		for (const source of operation.sources) {
			requireCategory(categories, source, ["source"], operation.ref);
		}
	}
	for (const condition of snapshot.conditions) {
		if (condition.scope) {
			requireCategory(
				categories,
				condition.scope.artifact,
				["artifact"],
				condition.ref,
			);
		}
		for (const source of condition.sources) {
			requireCategory(categories, source, ["source"], condition.ref);
		}
	}
	for (const fact of snapshot.facts) {
		if (
			![
				"static",
				"runtime-dependent",
				"external-data-required",
				"unsupported",
			].includes(fact.evaluation)
		) {
			throw new FactOntologyValidationError(
				`${fact.ref} has invalid evaluation ${String(fact.evaluation)}`,
			);
		}
		if (!["unconditional", "conditional"].includes(fact.execution)) {
			throw new FactOntologyValidationError(
				`${fact.ref} has invalid execution ${String(fact.execution)}`,
			);
		}
		validateFactEndpoints(categories, fact);
		for (const source of fact.assertion.evidence) {
			requireCategory(categories, source, ["source"], fact.ref);
		}
		for (const guard of fact.guards ?? []) {
			requireCategory(categories, guard, ["condition"], fact.ref);
		}
	}
}

function validateFactEndpoints(
	categories: ReadonlyMap<FactOntologyRef, string>,
	fact: FactOntologyFact,
): void {
	const endpoints: Readonly<
		Record<
			PrimaryFactPredicate,
			readonly [readonly string[], readonly string[]]
		>
	> = {
		DECLARES: [["artifact"], ["symbol"]],
		BINDS: [["operation"], ["symbol"]],
		DERIVES_FROM: [["value"], ["value", "operation"]],
		USES: [
			["operation", "condition"],
			["symbol", "value"],
		],
		PASSES: [["operation"], ["value"]],
		CALLS: [["operation"], ["symbol"]],
		GUARDED_BY: [["fact", "operation", "value"], ["condition"]],
	};
	const [subjects, objects] = endpoints[fact.claim.predicate];
	requireCategory(categories, fact.claim.subject, subjects, fact.ref);
	requireCategory(categories, fact.claim.object, objects, fact.ref);
}

function requireCategory(
	categories: ReadonlyMap<FactOntologyRef, string>,
	ref: FactOntologyRef,
	allowed: readonly string[],
	owner: string,
): void {
	const category = categories.get(ref);
	if (!category) {
		throw new FactOntologyValidationError(`${owner} references missing ${ref}`);
	}
	if (!allowed.includes(category)) {
		throw new FactOntologyValidationError(
			`${owner} references ${category} ${ref}; expected ${allowed.join(" or ")}`,
		);
	}
}
