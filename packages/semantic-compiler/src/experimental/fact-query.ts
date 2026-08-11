import type { CoverageStatus } from "../ontology/core.js";
import type {
	FactOntologyArtifact,
	FactOntologyCondition,
	FactOntologyFact,
	FactOntologyOperation,
	FactOntologyRef,
	FactOntologySnapshot,
	FactOntologySource,
	FactOntologySymbol,
	FactOntologyValue,
} from "./fact-ontology.js";

export type CompactCallSummary = {
	subject: {
		ref: string;
		name: string;
		kind: string;
	};
	calls: {
		total: number;
		artifacts: number;
		conditional: number;
		unconditional: number;
		items: readonly {
			ref: string;
			path: string;
			offset: number;
			line?: number;
			execution: "unconditional" | "conditional";
		}[];
	};
	argumentContract: readonly {
		ref: string;
		slot: string;
		calls: number;
		totalCalls: number;
	}[];
	coverage: {
		family: "renders";
		status: CoverageStatus;
		coveredArtifacts: number;
		completeArtifacts: number;
		uncertainArtifacts: number;
		totalArtifacts: number;
		reasons?: readonly { code: string; message: string }[];
	};
};

export type CompactUseSummary = {
	subject: { ref: string; name: string; kind: string };
	uses: {
		total: number;
		artifacts: number;
		items: readonly {
			ref: string;
			path: string;
			offset: number;
			role: string;
		}[];
	};
	roles: readonly {
		ref: string;
		role: string;
		uses: number;
	}[];
};

export type ExpandedFact = {
	fact: FactOntologyFact;
	subject:
		| FactOntologyArtifact
		| FactOntologySymbol
		| FactOntologyValue
		| FactOntologyOperation
		| FactOntologyCondition
		| FactOntologyFact;
	object:
		| FactOntologyArtifact
		| FactOntologySymbol
		| FactOntologyValue
		| FactOntologyOperation
		| FactOntologyCondition
		| FactOntologyFact;
	evidence: readonly FactOntologySource[];
	guards: readonly FactOntologyCondition[];
	relatedFacts: readonly FactOntologyFact[];
};

export class FactOntologyQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FactOntologyQueryError";
	}
}

export class FactOntologyQuery {
	readonly #records: ReadonlyMap<FactOntologyRef, ExpandedFact["subject"]>;
	readonly #artifacts: ReadonlyMap<string, FactOntologyArtifact>;
	readonly #operations: ReadonlyMap<string, FactOntologyOperation>;
	readonly #sources: ReadonlyMap<string, FactOntologySource>;
	readonly #conditions: ReadonlyMap<string, FactOntologyCondition>;
	readonly #facts: ReadonlyMap<string, FactOntologyFact>;
	readonly #aggregates = new Map<string, readonly string[]>();

	constructor(readonly snapshot: FactOntologySnapshot) {
		this.#records = new Map(
			[
				...snapshot.artifacts,
				...snapshot.symbols,
				...snapshot.values,
				...snapshot.operations,
				...snapshot.conditions,
				...snapshot.facts,
			].map((record) => [record.ref, record]),
		);
		this.#artifacts = new Map(
			snapshot.artifacts.map((artifact) => [artifact.ref, artifact]),
		);
		this.#operations = new Map(
			snapshot.operations.map((operation) => [operation.ref, operation]),
		);
		this.#sources = new Map(
			snapshot.sources.map((source) => [source.ref, source]),
		);
		this.#conditions = new Map(
			snapshot.conditions.map((condition) => [condition.ref, condition]),
		);
		this.#facts = new Map(snapshot.facts.map((fact) => [fact.ref, fact]));
	}

	usesOf(symbolName: string, kind: string): CompactUseSummary {
		const symbol = this.#resolveSymbol(symbolName, kind);
		const uses = this.snapshot.facts.filter(
			(fact) =>
				fact.claim.predicate === "USES" && fact.claim.object === symbol.ref,
		);
		const roleFacts = new Map<string, string[]>();
		const items = uses.map((fact) => {
			const operation = this.#operations.get(fact.claim.subject);
			if (!operation) {
				throw new FactOntologyQueryError(`Use ${fact.ref} has no operation`);
			}
			const artifact = this.#artifacts.get(operation.scope.artifact);
			if (!artifact) {
				throw new FactOntologyQueryError(`Use ${fact.ref} has no artifact`);
			}
			const role = String(fact.claim.attributes?.role ?? "uses");
			const entries = roleFacts.get(role) ?? [];
			entries.push(fact.ref);
			roleFacts.set(role, entries);
			return {
				ref: fact.ref,
				path: artifact.path,
				offset: operation.scope.start ?? 0,
				role,
			};
		});
		return {
			subject: { ref: symbol.ref, name: symbol.name, kind: symbol.kind },
			uses: {
				total: items.length,
				artifacts: new Set(items.map(({ path }) => path)).size,
				items: items.sort(
					(left, right) =>
						left.path.localeCompare(right.path) || left.offset - right.offset,
				),
			},
			roles: [...roleFacts.entries()]
				.map(([role, factRefs]) => {
					const ref = `aggregate:${this.snapshot.revision.id.slice(0, 12)}:${shortHash(`${symbol.ref}\0USES\0${role}`)}`;
					this.#aggregates.set(ref, factRefs.sort());
					return { ref, role, uses: factRefs.length };
				})
				.sort(
					(left, right) =>
						right.uses - left.uses || left.role.localeCompare(right.role),
				),
		};
	}

	callsTo(symbolName: string, kind = "shopify.snippet"): CompactCallSummary {
		const symbol = this.#resolveSymbol(symbolName, kind);
		const calls = this.snapshot.facts.filter(
			(fact) =>
				fact.claim.predicate === "CALLS" && fact.claim.object === symbol.ref,
		);
		const callItems = calls.map((call) => {
			const operation = this.#operations.get(call.claim.subject);
			if (!operation) {
				throw new FactOntologyQueryError(`Call ${call.ref} has no operation`);
			}
			const artifact = this.#artifacts.get(operation.scope.artifact);
			if (!artifact) {
				throw new FactOntologyQueryError(`Call ${call.ref} has no artifact`);
			}
			const source = call.assertion.evidence
				.map((ref) => this.#sources.get(ref))
				.find((candidate) => candidate?.artifact === artifact.ref);
			return {
				ref: call.ref,
				path: artifact.path,
				offset: source?.range.start ?? operation.scope.start ?? 0,
				...(source?.line ? { line: source.line } : {}),
				execution: call.execution,
			};
		});
		const callOperations = new Set(calls.map((call) => call.claim.subject));
		const passes = this.snapshot.facts.filter(
			(fact) =>
				fact.claim.predicate === "PASSES" &&
				callOperations.has(fact.claim.subject),
		);
		const contract = new Map<string, { calls: Set<string>; facts: string[] }>();
		for (const pass of passes) {
			const slot = String(pass.claim.attributes?.slot ?? "$positional");
			const entry = contract.get(slot) ?? { calls: new Set(), facts: [] };
			entry.calls.add(pass.claim.subject);
			entry.facts.push(pass.ref);
			contract.set(slot, entry);
		}
		const renderCoverage = this.snapshot.coverage.filter(
			(coverage) => coverage.family === "shopify.renders",
		);
		const coveredArtifactRefs = new Set(
			renderCoverage.flatMap((coverage) => coverage.scope.artifacts ?? []),
		);
		const completeArtifactRefs = new Set(
			renderCoverage
				.filter(({ status }) => status === "complete")
				.flatMap((coverage) => coverage.scope.artifacts ?? []),
		);
		const liquidArtifacts = this.snapshot.artifacts.filter(
			(artifact) => artifact.language === "liquid",
		).length;
		const reasons = uniqueReasons(
			renderCoverage.flatMap((coverage) => coverage.reasons ?? []),
		);
		return {
			subject: { ref: symbol.ref, name: symbol.name, kind: symbol.kind },
			calls: {
				total: calls.length,
				artifacts: new Set(callItems.map(({ path }) => path)).size,
				conditional: calls.filter(
					({ execution }) => execution === "conditional",
				).length,
				unconditional: calls.filter(
					({ execution }) => execution === "unconditional",
				).length,
				items: callItems.sort(
					(left, right) =>
						left.path.localeCompare(right.path) || left.offset - right.offset,
				),
			},
			argumentContract: [...contract.entries()]
				.map(([slot, entry]) => {
					const ref = `aggregate:${this.snapshot.revision.id.slice(0, 12)}:${shortHash(`${symbol.ref}\0${slot}`)}`;
					this.#aggregates.set(ref, entry.facts.sort());
					return {
						ref,
						slot,
						calls: entry.calls.size,
						totalCalls: calls.length,
					};
				})
				.sort(
					(left, right) =>
						right.calls - left.calls || left.slot.localeCompare(right.slot),
				),
			coverage: {
				family: "renders",
				status: worstCoverage(renderCoverage.map(({ status }) => status)),
				coveredArtifacts: coveredArtifactRefs.size,
				completeArtifacts: completeArtifactRefs.size,
				uncertainArtifacts: Math.max(
					0,
					liquidArtifacts - completeArtifactRefs.size,
				),
				totalArtifacts: liquidArtifacts,
				...(reasons.length > 0 ? { reasons } : {}),
			},
		};
	}

	#resolveSymbol(symbolName: string, kind: string): FactOntologySymbol {
		const matches = this.snapshot.symbols.filter(
			(symbol) => symbol.name === symbolName && symbol.kind === kind,
		);
		if (matches.length === 0) {
			throw new FactOntologyQueryError(
				`Symbol not found: ${kind}:${symbolName}`,
			);
		}
		if (matches.length > 1) {
			throw new FactOntologyQueryError(
				`Ambiguous symbol: ${kind}:${symbolName}`,
			);
		}
		const symbol = matches[0];
		if (!symbol) throw new FactOntologyQueryError("Symbol resolution failed");
		return symbol;
	}

	expandAggregate(ref: string): readonly ExpandedFact[] {
		const factRefs = this.#aggregates.get(ref);
		if (!factRefs) {
			throw new FactOntologyQueryError(`Aggregate not found: ${ref}`);
		}
		return factRefs.map((factRef) => this.expand(factRef));
	}

	expand(ref: string): ExpandedFact {
		const fact = this.#facts.get(ref);
		if (!fact) throw new FactOntologyQueryError(`Fact not found: ${ref}`);
		const subject = this.#records.get(fact.claim.subject);
		const object = this.#records.get(fact.claim.object);
		if (!subject || !object) {
			throw new FactOntologyQueryError(`Fact ${ref} has unresolved endpoints`);
		}
		const relatedFacts =
			fact.claim.predicate === "CALLS"
				? this.snapshot.facts.filter(
						(candidate) =>
							candidate.claim.subject === fact.claim.subject &&
							candidate.claim.predicate === "PASSES",
					)
				: [];
		return {
			fact,
			subject,
			object,
			evidence: fact.assertion.evidence.flatMap((source) => {
				const record = this.#sources.get(source);
				return record ? [record] : [];
			}),
			guards: (fact.guards ?? []).flatMap((guard) => {
				const condition = this.#conditions.get(guard);
				return condition ? [condition] : [];
			}),
			relatedFacts,
		};
	}
}

function shortHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function worstCoverage(statuses: readonly CoverageStatus[]): CoverageStatus {
	const rank: Readonly<Record<CoverageStatus, number>> = {
		complete: 0,
		"runtime-dependent": 1,
		partial: 2,
		"external-data-required": 3,
		unsupported: 4,
	};
	return (
		[...statuses].sort((left, right) => rank[right] - rank[left])[0] ??
		"external-data-required"
	);
}

function uniqueReasons(
	reasons: readonly { code: string; message: string }[],
): { code: string; message: string }[] {
	return [
		...new Map(
			reasons.map((reason) => [`${reason.code}\0${reason.message}`, reason]),
		).values(),
	].sort(
		(left, right) =>
			left.code.localeCompare(right.code) ||
			left.message.localeCompare(right.message),
	);
}
