import type { OntologyAttribute, OntologyModule } from "../ontology/module.js";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticDiagnostic,
	SemanticEntity,
	SemanticGraphSnapshot,
	SemanticOccurrence,
	SemanticPredicate,
	SemanticRelation,
	SemanticRevision,
	SemanticValue,
} from "../outputs/semantic-graph-snapshot.js";
import type { AssertionMetadata } from "../semantic/assertion.js";
import type { SourceAnchor } from "../semantic/evidence.js";
import type { JsonValue } from "../semantic/record.js";
import type { SemanticContribution } from "./semantic-contribution.js";
import type { SemanticGraphContract } from "./semantic-graph-contract.js";

export type SemanticGraphAssemblyInput = {
	revision: SemanticRevision;
	contributions: readonly SemanticContribution[];
	repositoryScope: {
		status: "complete" | "partial";
	};
};

export type SemanticAssemblyContext = {
	repositoryScope: SemanticGraphAssemblyInput["repositoryScope"];
	contributions: readonly SemanticContribution[];
	ontologies: readonly OntologyModule[];
};

export type SemanticAssemblyDraft = {
	entities: SemanticEntity[];
	occurrences: SemanticOccurrence[];
	relations: SemanticRelation[];
	values: SemanticValue[];
	predicates: SemanticPredicate[];
	boundaries: SemanticBoundary[];
	coverage: SemanticCoverage[];
	diagnostics: SemanticDiagnostic[];
};

export type SemanticAssemblyPass = {
	id: string;
	apply(draft: SemanticAssemblyDraft, context: SemanticAssemblyContext): void;
};

export type SemanticAssemblyIssue = {
	code: string;
	recordId: string;
	message: string;
};

export class SemanticAssemblyError extends Error {
	readonly issues: readonly SemanticAssemblyIssue[];

	constructor(issues: readonly SemanticAssemblyIssue[]) {
		super(`Semantic graph assembly failed: ${issues.length} conflict(s)`);
		this.name = "SemanticAssemblyError";
		this.issues = issues;
	}
}

/** Merges bounded contributions, runs target passes, then validates one snapshot. */
export class SemanticGraphAssembler {
	readonly #attributeDefinitions = new Map<
		string,
		ReadonlyMap<string, OntologyAttribute>
	>();

	constructor(
		readonly contract: SemanticGraphContract,
		readonly passes: readonly SemanticAssemblyPass[] = [],
	) {
		for (const ontology of contract.ontologies) {
			for (const definition of [
				...ontology.entityKinds,
				...ontology.occurrenceKinds,
				...ontology.relationKinds,
				...ontology.valueSlots,
				...ontology.predicateKinds,
			]) {
				this.#attributeDefinitions.set(
					definition.kind,
					new Map(
						definition.attributes.map((attribute) => [
							attribute.name,
							attribute,
						]),
					),
				);
			}
		}
	}

	assemble(input: SemanticGraphAssemblyInput): SemanticGraphSnapshot {
		const attributeDefinitions = this.#attributeDefinitions;
		const issues: SemanticAssemblyIssue[] = [];
		const categories = new Map<string, string>();
		const entities = new Map<string, SemanticEntity>();
		const occurrences = new Map<string, SemanticOccurrence>();
		const relations = new Map<string, SemanticRelation>();
		const values = new Map<string, SemanticValue>();
		const predicates = new Map<string, SemanticPredicate>();
		const boundaries = new Map<string, SemanticBoundary>();
		const coverage = new Map<string, SemanticCoverage>();
		const diagnostics = new Map<string, SemanticDiagnostic>();

		for (const contribution of input.contributions) {
			mergeRecords(contribution.entities, entities, "entity", mergeEntity);
			mergeRecords(
				contribution.occurrences,
				occurrences,
				"occurrence",
				mergeOccurrence,
			);
			mergeRecords(
				contribution.relations,
				relations,
				"relation",
				mergeRelation,
			);
			mergeRecords(contribution.values, values, "value", mergeValue);
			mergeRecords(
				contribution.predicates,
				predicates,
				"predicate",
				mergePredicate,
			);
			mergeRecords(
				contribution.boundaries,
				boundaries,
				"boundary",
				mergeBoundary,
			);
			mergeRecords(contribution.coverage, coverage, "coverage", mergeCoverage);
			for (const diagnostic of contribution.diagnostics) {
				const key = canonicalJson({
					severity: diagnostic.severity,
					code: diagnostic.code,
					message: diagnostic.message,
				});
				const existing = diagnostics.get(key);
				diagnostics.set(
					key,
					existing
						? {
								...existing,
								evidence: mergeEvidence(existing.evidence, diagnostic.evidence),
							}
						: structuredClone(diagnostic),
				);
			}
		}

		if (issues.length > 0) throw new SemanticAssemblyError(issues);

		const draft: SemanticAssemblyDraft = {
			entities: [...entities.values()],
			occurrences: [...occurrences.values()],
			relations: [...relations.values()],
			values: [...values.values()],
			predicates: [...predicates.values()],
			boundaries: [...boundaries.values()],
			coverage: [...coverage.values()],
			diagnostics: [...diagnostics.values()],
		};
		const context: SemanticAssemblyContext = {
			repositoryScope: input.repositoryScope,
			contributions: input.contributions,
			ontologies: this.contract.ontologies,
		};
		for (const pass of this.passes) pass.apply(draft, context);

		const snapshot: SemanticGraphSnapshot = {
			contractVersion: 1,
			revision: {
				...structuredClone(input.revision),
				externalInputs: Object.fromEntries(
					Object.entries(input.revision.externalInputs).sort(
						([left], [right]) => left.localeCompare(right),
					),
				),
			},
			ontologies: this.contract.ontologies.map(({ namespace, version }) => ({
				namespace,
				version,
			})),
			entities: sortRecords(draft.entities),
			occurrences: sortRecords(draft.occurrences),
			relations: sortRecords(draft.relations),
			values: sortRecords(draft.values),
			predicates: sortRecords(draft.predicates),
			boundaries: sortRecords(draft.boundaries),
			coverage: sortRecords(draft.coverage),
			diagnostics: [...draft.diagnostics].sort(compareDiagnostic),
		};
		this.contract.assert(snapshot);
		return snapshot;

		function mergeRecords<Record extends { id: string }>(
			records: readonly Record[],
			target: Map<string, Record>,
			category: string,
			merge: (left: Record, right: Record) => Record,
		): void {
			for (const record of records) {
				const previousCategory = categories.get(record.id);
				if (previousCategory && previousCategory !== category) {
					conflict(
						record.id,
						`Record ID is used by both ${previousCategory} and ${category}`,
					);
					continue;
				}
				categories.set(record.id, category);
				const existing = target.get(record.id);
				target.set(
					record.id,
					existing ? merge(existing, record) : structuredClone(record),
				);
			}
		}

		function mergeEntity(
			left: SemanticEntity,
			right: SemanticEntity,
		): SemanticEntity {
			requireEqual(left.id, "kind", left.kind, right.kind);
			requireEqual(left.id, "identity", left.identity, right.identity);
			return {
				...left,
				name: mergeOptional(left.id, "name", left.name, right.name),
				path: mergeOptional(left.id, "path", left.path, right.path),
				attributes: mergeAttributes(
					left.id,
					left.kind,
					left.attributes,
					right.attributes,
				),
				assertion: mergeAssertion(left.id, left.assertion, right.assertion),
			};
		}

		function mergeOccurrence(
			left: SemanticOccurrence,
			right: SemanticOccurrence,
		): SemanticOccurrence {
			requireEqual(left.id, "kind", left.kind, right.kind);
			requireEqual(left.id, "ownerId", left.ownerId, right.ownerId);
			return {
				...left,
				name: mergeOptional(left.id, "name", left.name, right.name),
				attributes: mergeAttributes(
					left.id,
					left.kind,
					left.attributes,
					right.attributes,
				),
				assertion: mergeAssertion(left.id, left.assertion, right.assertion),
			};
		}

		function mergeRelation(
			left: SemanticRelation,
			right: SemanticRelation,
		): SemanticRelation {
			requireEqual(left.id, "kind", left.kind, right.kind);
			requireEqual(left.id, "from", left.from, right.from);
			requireEqual(left.id, "to", left.to, right.to);
			return {
				...left,
				guards: unionStrings(left.guards, right.guards),
				attributes: mergeAttributes(
					left.id,
					left.kind,
					left.attributes,
					right.attributes,
				),
				assertion: mergeAssertion(left.id, left.assertion, right.assertion),
			};
		}

		function mergeValue(
			left: SemanticValue,
			right: SemanticValue,
		): SemanticValue {
			for (const property of [
				"ownerId",
				"slot",
				"representation",
				"authority",
				"expression",
				"resolved",
			] as const) {
				requireEqual(left.id, property, left[property], right[property]);
			}
			return {
				...left,
				sourceValueIds: unionStrings(left.sourceValueIds, right.sourceValueIds),
				attributes: mergeAttributes(
					left.id,
					left.slot,
					left.attributes,
					right.attributes,
				),
				assertion: mergeAssertion(left.id, left.assertion, right.assertion),
			};
		}

		function mergePredicate(
			left: SemanticPredicate,
			right: SemanticPredicate,
		): SemanticPredicate {
			requireEqual(left.id, "kind", left.kind, right.kind);
			requireEqual(left.id, "operator", left.operator, right.operator);
			requireEqual(left.id, "operands", left.operands, right.operands);
			return {
				...left,
				attributes: mergeAttributes(
					left.id,
					left.kind,
					left.attributes,
					right.attributes,
				),
				assertion: mergeAssertion(left.id, left.assertion, right.assertion),
			};
		}

		function mergeBoundary(
			left: SemanticBoundary,
			right: SemanticBoundary,
		): SemanticBoundary {
			requireEqual(left.id, "kind", left.kind, right.kind);
			requireEqual(left.id, "message", left.message, right.message);
			return {
				...left,
				subjectIds: unionStrings(left.subjectIds, right.subjectIds),
				evidence: mergeEvidence(left.evidence, right.evidence),
				attributes: mergeAttributes(
					left.id,
					"",
					left.attributes,
					right.attributes,
				),
			};
		}

		function mergeCoverage(
			left: SemanticCoverage,
			right: SemanticCoverage,
		): SemanticCoverage {
			requireEqual(left.id, "family", left.family, right.family);
			requireEqual(left.id, "extractor", left.extractor, right.extractor);
			return {
				...left,
				scope: {
					paths: unionOptionalStrings(left.scope.paths, right.scope.paths),
					languages: unionOptionalStrings(
						left.scope.languages,
						right.scope.languages,
					),
					kinds: unionOptionalStrings(left.scope.kinds, right.scope.kinds),
					subjectIds: unionOptionalStrings(
						left.scope.subjectIds,
						right.scope.subjectIds,
					),
				},
				status: conservativeCoverageStatus(left.status, right.status),
				boundaryIds: unionStrings(left.boundaryIds, right.boundaryIds),
			};
		}

		function mergeAttributes(
			recordId: string,
			kind: string,
			left: Readonly<Record<string, JsonValue>>,
			right: Readonly<Record<string, JsonValue>>,
		): Readonly<Record<string, JsonValue>> {
			const merged: Record<string, JsonValue> = {};
			const definitions = attributeDefinitions.get(kind);
			for (const name of [
				...new Set([...Object.keys(left), ...Object.keys(right)]),
			].sort()) {
				const leftValue = left[name];
				const rightValue = right[name];
				if (leftValue === undefined) {
					if (rightValue !== undefined)
						merged[name] = structuredClone(rightValue);
					continue;
				}
				if (rightValue === undefined || equal(leftValue, rightValue)) {
					merged[name] = structuredClone(leftValue);
					continue;
				}
				const policy = definitions?.get(name)?.merge ?? "require-equal";
				if (
					policy === "boolean-or" &&
					typeof leftValue === "boolean" &&
					typeof rightValue === "boolean"
				) {
					merged[name] = leftValue || rightValue;
					continue;
				}
				if (
					policy === "array-union" &&
					Array.isArray(leftValue) &&
					Array.isArray(rightValue)
				) {
					merged[name] = mergeJsonArrays(leftValue, rightValue);
					continue;
				}
				conflict(recordId, `Attribute ${name} has incompatible values`);
				merged[name] =
					canonicalJson(leftValue).localeCompare(canonicalJson(rightValue)) <= 0
						? structuredClone(leftValue)
						: structuredClone(rightValue);
			}
			return merged;
		}

		function mergeAssertion(
			recordId: string,
			left: AssertionMetadata,
			right: AssertionMetadata,
		): AssertionMetadata {
			let derivation = left.derivation ?? right.derivation;
			if (
				left.derivation &&
				right.derivation &&
				!equal(left.derivation, right.derivation)
			) {
				conflict(recordId, "Assertions have incompatible derivations");
				derivation =
					canonicalJson(left.derivation).localeCompare(
						canonicalJson(right.derivation),
					) <= 0
						? left.derivation
						: right.derivation;
			}
			return {
				epistemic: strongerEpistemic(left.epistemic, right.epistemic),
				availability: conservativeAvailability(
					left.availability,
					right.availability,
				),
				provenance: {
					authorities: unionStrings(
						left.provenance.authorities,
						right.provenance.authorities,
					),
					sourceIds: unionStrings(
						left.provenance.sourceIds,
						right.provenance.sourceIds,
					),
				},
				evidence: mergeEvidence(left.evidence, right.evidence),
				...(derivation ? { derivation: structuredClone(derivation) } : {}),
				boundaryIds: unionStrings(left.boundaryIds, right.boundaryIds),
			};
		}

		function requireEqual(
			recordId: string,
			property: string,
			left: unknown,
			right: unknown,
		): void {
			if (!equal(left, right)) {
				conflict(recordId, `Property ${property} has incompatible values`);
			}
		}

		function mergeOptional<Value>(
			recordId: string,
			property: string,
			left: Value | undefined,
			right: Value | undefined,
		): Value | undefined {
			if (left === undefined) return structuredClone(right);
			if (right === undefined) return structuredClone(left);
			requireEqual(recordId, property, left, right);
			return canonicalJson(left).localeCompare(canonicalJson(right)) <= 0
				? structuredClone(left)
				: structuredClone(right);
		}

		function conflict(recordId: string, message: string): void {
			issues.push({ code: "SEMANTIC_RECORD_CONFLICT", recordId, message });
		}
	}
}

function mergeEvidence(
	left: readonly SourceAnchor[],
	right: readonly SourceAnchor[],
): SourceAnchor[] {
	const evidence = new Map<string, SourceAnchor>();
	for (const anchor of [...left, ...right]) {
		evidence.set(canonicalJson(anchor), structuredClone(anchor));
	}
	return [...evidence.values()].sort(compareAnchor);
}

function mergeJsonArrays(
	left: readonly JsonValue[],
	right: readonly JsonValue[],
): JsonValue[] {
	const values = new Map<string, JsonValue>();
	for (const value of [...left, ...right]) {
		values.set(canonicalJson(value), structuredClone(value));
	}
	return [...values.entries()]
		.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
		.map(([, value]) => value);
}

function unionStrings<Value extends string>(
	left: readonly Value[],
	right: readonly Value[],
): Value[] {
	return [...new Set([...left, ...right])].sort();
}

function unionOptionalStrings<Value extends string>(
	left: readonly Value[] | undefined,
	right: readonly Value[] | undefined,
): Value[] | undefined {
	if (!left && !right) return undefined;
	return unionStrings(left ?? [], right ?? []);
}

function conservativeCoverageStatus(
	left: SemanticCoverage["status"],
	right: SemanticCoverage["status"],
): SemanticCoverage["status"] {
	const rank: Record<SemanticCoverage["status"], number> = {
		complete: 0,
		partial: 1,
		"runtime-dependent": 2,
		"external-data-required": 3,
		unsupported: 4,
	};
	return rank[left] >= rank[right] ? left : right;
}

function conservativeAvailability(
	left: AssertionMetadata["availability"],
	right: AssertionMetadata["availability"],
): AssertionMetadata["availability"] {
	const rank: Record<AssertionMetadata["availability"], number> = {
		static: 0,
		"runtime-dependent": 1,
		"external-data-required": 2,
		unsupported: 3,
	};
	return rank[left] >= rank[right] ? left : right;
}

function strongerEpistemic(
	left: AssertionMetadata["epistemic"],
	right: AssertionMetadata["epistemic"],
): AssertionMetadata["epistemic"] {
	const basisRank: Record<AssertionMetadata["epistemic"]["basis"], number> = {
		convention: 0,
		"bounded-analysis": 1,
		resolution: 2,
		"external-snapshot": 3,
		syntax: 4,
	};
	const leftRank = (left.status === "proven" ? 100 : 0) + basisRank[left.basis];
	const rightRank =
		(right.status === "proven" ? 100 : 0) + basisRank[right.basis];
	return structuredClone(leftRank >= rightRank ? left : right);
}

function equal(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function sortRecords<Record extends { id: string }>(
	records: readonly Record[],
): Record[] {
	return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function compareAnchor(left: SourceAnchor, right: SourceAnchor): number {
	return (
		left.path.localeCompare(right.path) ||
		left.range.start - right.range.start ||
		left.range.end - right.range.end ||
		(left.role ?? "").localeCompare(right.role ?? "")
	);
}

function compareDiagnostic(
	left: SemanticDiagnostic,
	right: SemanticDiagnostic,
): number {
	return (
		left.code.localeCompare(right.code) ||
		left.message.localeCompare(right.message) ||
		canonicalJson(left.evidence).localeCompare(canonicalJson(right.evidence))
	);
}
