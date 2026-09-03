import { createHash } from "node:crypto";
import type {
	SemanticEntity,
	SemanticGraphSnapshot,
	SemanticOccurrence,
	SemanticRelation,
	SemanticValue,
} from "../outputs/semantic-graph-snapshot.js";
import type { AssertionMetadata } from "../semantic/assertion.js";
import type { SourceAnchor } from "../semantic/evidence.js";
import type { JsonValue } from "../semantic/record.js";
import {
	FACT_ONTOLOGY_SNAPSHOT_VERSION,
	type FactOntologyArtifact,
	type FactOntologyCondition,
	type FactOntologyCoverage,
	type FactOntologyFact,
	type FactOntologyOperation,
	type FactOntologyRef,
	type FactOntologySnapshot,
	type FactOntologySource,
	type FactOntologySymbol,
	type FactOntologyValue,
	type PrimaryFactPredicate,
	validateFactOntologySnapshot,
} from "./fact-ontology.js";

type ProjectionState = {
	snapshot: SemanticGraphSnapshot;
	artifacts: Map<string, FactOntologyArtifact>;
	artifactByPath: Map<string, FactOntologyArtifact>;
	symbols: Map<string, FactOntologySymbol>;
	operations: Map<string, FactOntologyOperation>;
	conditions: Map<string, FactOntologyCondition>;
	values: Map<string, FactOntologyValue>;
	sources: Map<string, FactOntologySource>;
	facts: Map<string, FactOntologyFact>;
	entityRefs: Map<string, FactOntologyRef>;
	occurrenceRefs: Map<string, FactOntologyRef>;
	predicateRefs: Map<string, FactOntologyRef>;
	valueRefs: Map<string, FactOntologyRef>;
	bindingSymbolRefs: Map<string, FactOntologyRef>;
	entitiesById: Map<string, SemanticEntity>;
	occurrencesById: Map<string, SemanticOccurrence>;
	valuesByOwner: Map<string, SemanticValue[]>;
	bindingsByPathAndName: Map<string, SemanticOccurrence[]>;
	revisionHash: string;
};

/** Experimental lossless-normalization adapter. Existing snapshot remains authoritative. */
export function projectSnapshotToFactOntology(
	snapshot: SemanticGraphSnapshot,
): FactOntologySnapshot {
	const state: ProjectionState = {
		snapshot,
		artifacts: new Map(),
		artifactByPath: new Map(),
		symbols: new Map(),
		operations: new Map(),
		conditions: new Map(),
		values: new Map(),
		sources: new Map(),
		facts: new Map(),
		entityRefs: new Map(),
		occurrenceRefs: new Map(),
		predicateRefs: new Map(),
		valueRefs: new Map(),
		bindingSymbolRefs: new Map(),
		entitiesById: new Map(
			snapshot.entities.map((entity) => [entity.id, entity]),
		),
		occurrencesById: new Map(
			snapshot.occurrences.map((occurrence) => [occurrence.id, occurrence]),
		),
		valuesByOwner: groupValuesByOwner(snapshot.values),
		bindingsByPathAndName: groupBindings(snapshot.occurrences),
		revisionHash: shortHash(snapshot.revision.id),
	};

	projectArtifacts(state);
	projectSources(state);
	projectEntities(state);
	projectOperations(state);
	projectConditions(state);
	projectValues(state);
	projectDeclarationsAndBindings(state);
	projectValueFacts(state);
	projectUsageFacts(state);
	projectRelationFacts(state);

	const result: FactOntologySnapshot = {
		contractVersion: FACT_ONTOLOGY_SNAPSHOT_VERSION,
		revision: {
			id: snapshot.revision.id,
			repositoryFingerprint: snapshot.revision.repositoryFingerprint,
		},
		artifacts: sorted(state.artifacts.values()),
		symbols: sorted(state.symbols.values()),
		values: sorted(state.values.values()),
		operations: sorted(state.operations.values()),
		conditions: sorted(state.conditions.values()),
		sources: sorted(state.sources.values()),
		facts: sorted(state.facts.values()),
		coverage: projectCoverage(state),
	};
	validateFactOntologySnapshot(result);
	return result;
}

function projectArtifacts(state: ProjectionState): void {
	const paths = new Set<string>();
	const sourceEntities = new Map<string, SemanticEntity>();
	for (const entity of state.snapshot.entities) {
		if (entity.kind === "shopify.source-file" && entity.path) {
			paths.add(entity.path);
			sourceEntities.set(entity.path, entity);
		}
	}
	for (const anchor of allAnchors(state.snapshot)) paths.add(anchor.path);
	for (const path of [...paths].sort()) {
		const entity = sourceEntities.get(path);
		const artifact: FactOntologyArtifact = {
			ref: artifactRef(path),
			kind: sourceArtifactKind(entity),
			path,
			...(typeof entity?.attributes.language === "string"
				? { language: entity.attributes.language }
				: {}),
			...(typeof entity?.attributes.role === "string"
				? { role: entity.attributes.role }
				: {}),
		};
		state.artifacts.set(artifact.ref, artifact);
		state.artifactByPath.set(path, artifact);
		if (entity) state.entityRefs.set(entity.id, artifact.ref);
	}
}

function projectSources(state: ProjectionState): void {
	for (const anchor of allAnchors(state.snapshot)) sourceRef(state, anchor);
}

function projectEntities(state: ProjectionState): void {
	for (const entity of state.snapshot.entities) {
		if (entity.kind === "shopify.source-file") continue;
		const symbol = entitySymbol(state, entity);
		state.symbols.set(symbol.ref, symbol);
		state.entityRefs.set(entity.id, symbol.ref);
	}
}

function projectOperations(state: ProjectionState): void {
	const bases = new Map<string, number>();
	for (const occurrence of state.snapshot.occurrences) {
		const anchor = occurrence.assertion.evidence[0];
		const path =
			anchor?.path ?? ownerPath(state, occurrence.ownerId) ?? "unknown";
		const artifact = ensureArtifact(state, path);
		const start = anchor?.range.start ?? 0;
		const end = anchor?.range.end ?? start;
		const base = `operation:${escapeRef(occurrence.kind)}:${escapeRef(path)}:${start}:${end}`;
		const ordinal = bases.get(base) ?? 0;
		bases.set(base, ordinal + 1);
		const ref = ordinal === 0 ? base : `${base}:${ordinal}`;
		const operation: FactOntologyOperation = {
			ref,
			kind: occurrence.kind,
			scope: { artifact: artifact.ref, start, end },
			sources: occurrence.assertion.evidence.map((item) =>
				sourceRef(state, item),
			),
		};
		state.operations.set(ref, operation);
		state.occurrenceRefs.set(occurrence.id, ref);
		if (occurrence.kind === "shopify.binding-site") {
			const symbol = bindingSymbol(occurrence, artifact);
			state.symbols.set(symbol.ref, symbol);
			state.bindingSymbolRefs.set(occurrence.id, symbol.ref);
		}
	}
}

function projectConditions(state: ProjectionState): void {
	const bases = new Map<string, number>();
	for (const predicate of state.snapshot.predicates) {
		const anchor = predicate.assertion.evidence[0];
		const path = anchor?.path ?? "unknown";
		const artifact = ensureArtifact(state, path);
		const start = anchor?.range.start ?? 0;
		const end = anchor?.range.end ?? start;
		const base = `condition:${escapeRef(predicate.operator)}:${escapeRef(path)}:${start}:${end}`;
		const ordinal = bases.get(base) ?? 0;
		bases.set(base, ordinal + 1);
		const ref = ordinal === 0 ? base : `${base}:${ordinal}`;
		const condition: FactOntologyCondition = {
			ref,
			operator: predicate.operator,
			expression: String(predicate.attributes.expression ?? predicate.operator),
			scope: { artifact: artifact.ref, start, end },
			sources: predicate.assertion.evidence.map((item) =>
				sourceRef(state, item),
			),
		};
		state.conditions.set(ref, condition);
		state.predicateRefs.set(predicate.id, ref);
	}
}

function projectValues(state: ProjectionState): void {
	const ordinals = new Map<string, number>();
	for (const value of state.snapshot.values) {
		const owner =
			state.occurrenceRefs.get(value.ownerId) ??
			state.entityRefs.get(value.ownerId) ??
			"unresolved-owner";
		const base = `value:${escapeRef(owner)}:${escapeRef(value.slot)}`;
		const ordinal = ordinals.get(base) ?? 0;
		ordinals.set(base, ordinal + 1);
		const ref = `${base}:${ordinal}`;
		state.valueRefs.set(value.id, ref);
		state.values.set(ref, {
			ref,
			representation: value.representation,
			authority: value.authority,
			resolvability: value.assertion.availability,
			...(value.expression !== undefined
				? { expression: value.expression }
				: {}),
			...(value.resolved !== undefined ? { resolved: value.resolved } : {}),
		});
	}
}

function projectDeclarationsAndBindings(state: ProjectionState): void {
	for (const entity of state.snapshot.entities) {
		if (entity.kind === "shopify.source-file") continue;
		const symbol = state.entityRefs.get(entity.id);
		const path = entity.path ?? String(entity.attributes.path ?? "");
		const artifact = state.artifactByPath.get(path);
		if (symbol && artifact) {
			addFact(state, "DECLARES", artifact.ref, symbol, entity.assertion);
		}
	}
	for (const occurrence of state.snapshot.occurrences) {
		if (occurrence.kind !== "shopify.binding-site") continue;
		const operation = state.occurrenceRefs.get(occurrence.id);
		const symbol = state.bindingSymbolRefs.get(occurrence.id);
		const anchor = occurrence.assertion.evidence[0];
		const artifact = anchor ? state.artifactByPath.get(anchor.path) : undefined;
		if (!operation || !symbol) continue;
		addFact(state, "BINDS", operation, symbol, occurrence.assertion, {
			binding: occurrence.attributes.binding ?? "unknown",
		});
		if (artifact)
			addFact(state, "DECLARES", artifact.ref, symbol, occurrence.assertion);
	}
}

function projectValueFacts(state: ProjectionState): void {
	for (const value of state.snapshot.values) {
		const valueRef = state.valueRefs.get(value.id);
		if (!valueRef) continue;
		const owner = state.occurrenceRefs.get(value.ownerId);
		if (owner) addFact(state, "DERIVES_FROM", valueRef, owner, value.assertion);
		for (const sourceId of value.sourceValueIds) {
			const source = state.valueRefs.get(sourceId);
			if (source)
				addFact(state, "DERIVES_FROM", valueRef, source, value.assertion);
		}
	}
}

function projectUsageFacts(state: ProjectionState): void {
	for (const occurrence of state.snapshot.occurrences) {
		const operation = state.occurrenceRefs.get(occurrence.id);
		if (!operation) continue;
		if (occurrence.kind === "shopify.expression-site") {
			const root = String(
				occurrence.attributes.root ?? occurrence.name ?? "unknown",
			);
			const symbol = referenceSymbol(state, occurrence, root);
			addFact(state, "USES", operation, symbol.ref, occurrence.assertion, {
				role: "reads",
			});
		}
	}
	for (const predicate of state.snapshot.predicates) {
		const condition = state.predicateRefs.get(predicate.id);
		if (!condition) continue;
		for (const operand of predicate.operands) {
			if (operand.kind !== "value") continue;
			const value = state.valueRefs.get(operand.valueId);
			if (value)
				addFact(state, "USES", condition, value, predicate.assertion, {
					role: "input",
				});
		}
	}
}

function projectRelationFacts(state: ProjectionState): void {
	for (const relation of state.snapshot.relations) {
		if (relation.kind === "shopify.invokes") projectCall(state, relation);
		if (relation.kind === "shopify.emits-attribute")
			projectUse(state, relation, "emits");
		if (relation.kind === "shopify.selects-class")
			projectUse(state, relation, "selects");
		if (relation.kind === "shopify.emits-class")
			projectUse(state, relation, "emits");
		if (relation.kind === "shopify.uses-class") {
			projectUse(state, relation, String(relation.attributes.role ?? "uses"));
		}
		if (relation.kind === "shopify.passes-argument")
			projectPass(state, relation);
	}
}

function projectUse(
	state: ProjectionState,
	relation: SemanticRelation,
	role: string,
): void {
	const operation = state.occurrenceRefs.get(relation.from);
	const symbol = state.entityRefs.get(relation.to);
	if (!operation || !symbol) return;
	const guards = relation.guards.flatMap((id) => {
		const ref = state.predicateRefs.get(id);
		return ref ? [ref] : [];
	});
	const use = addFact(
		state,
		"USES",
		operation,
		symbol,
		relation.assertion,
		{ ...relation.attributes, role },
		guards,
	);
	for (const guard of guards) {
		addFact(state, "GUARDED_BY", use.ref, guard, relation.assertion);
	}
}

function projectCall(state: ProjectionState, relation: SemanticRelation): void {
	const operation = state.occurrenceRefs.get(relation.from);
	const symbol = state.entityRefs.get(relation.to);
	if (!operation || !symbol) return;
	const guards = relation.guards.flatMap((id) => {
		const ref = state.predicateRefs.get(id);
		return ref ? [ref] : [];
	});
	const operationArtifact = state.operations.get(operation)?.scope.artifact;
	const operationPath = operationArtifact
		? state.artifacts.get(operationArtifact)?.path
		: undefined;
	const callAssertion = operationPath
		? {
				...relation.assertion,
				evidence: relation.assertion.evidence.filter(
					(anchor) => anchor.path === operationPath,
				),
			}
		: relation.assertion;
	const call = addFact(
		state,
		"CALLS",
		operation,
		symbol,
		callAssertion,
		relation.attributes,
		guards,
	);
	for (const guard of guards) {
		addFact(state, "GUARDED_BY", call.ref, guard, callAssertion);
	}
}

function projectPass(state: ProjectionState, relation: SemanticRelation): void {
	const operation = state.occurrenceRefs.get(relation.from);
	if (!operation) return;
	const argument = state.occurrencesById.get(relation.to);
	if (!argument) return;
	const values = state.valuesByOwner.get(argument.id) ?? [];
	for (const value of values) {
		const valueRef = state.valueRefs.get(value.id);
		if (!valueRef) continue;
		addFact(state, "PASSES", operation, valueRef, relation.assertion, {
			...relation.attributes,
			...(typeof argument.attributes.name === "string"
				? { slot: argument.attributes.name }
				: {}),
			argumentKind: argument.attributes.argumentKind ?? "unknown",
		});
	}
}

function addFact(
	state: ProjectionState,
	predicate: PrimaryFactPredicate,
	subject: FactOntologyRef,
	object: FactOntologyRef,
	assertion: AssertionMetadata,
	attributes?: Readonly<Record<string, JsonValue>>,
	guards: readonly string[] = [],
): FactOntologyFact {
	const evidence = assertion.evidence.map((anchor) => sourceRef(state, anchor));
	const claim = {
		subject,
		predicate,
		object,
		...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
	};
	const identity = JSON.stringify({ claim, evidence, guards });
	const ref = `fact:${state.revisionHash}:${shortHash(identity)}`;
	const fact: FactOntologyFact = {
		ref,
		claim,
		assertion: {
			certainty: assertion.epistemic.status,
			basis: assertion.epistemic.basis,
			authority: assertion.provenance.authorities,
			evidence,
		},
		evaluation: assertion.availability,
		execution: guards.length > 0 ? "conditional" : "unconditional",
		...(guards.length > 0 ? { guards } : {}),
	};
	const existing = state.facts.get(ref);
	if (existing && JSON.stringify(existing) !== JSON.stringify(fact)) {
		throw new Error(`Fact ref collision ${ref}`);
	}
	state.facts.set(ref, fact);
	return fact;
}

function projectCoverage(state: ProjectionState): FactOntologyCoverage[] {
	const boundaryById = new Map(
		state.snapshot.boundaries.map((boundary) => [boundary.id, boundary]),
	);
	return state.snapshot.coverage
		.map((coverage): FactOntologyCoverage => {
			const artifacts = (coverage.scope.paths ?? []).flatMap((path) => {
				const artifact = state.artifactByPath.get(path);
				return artifact ? [artifact.ref] : [];
			});
			const reasons = coverage.boundaryIds.flatMap((id) => {
				const boundary = boundaryById.get(id);
				return boundary
					? [{ code: boundary.kind, message: boundary.message }]
					: [];
			});
			return {
				family: coverage.family,
				status: coverage.status,
				scope: {
					...(artifacts.length > 0
						? { artifacts: [...new Set(artifacts)].sort() }
						: {}),
					...(coverage.scope.languages
						? { languages: coverage.scope.languages }
						: {}),
					...(coverage.scope.kinds ? { kinds: coverage.scope.kinds } : {}),
				},
				...(reasons.length > 0 ? { reasons } : {}),
			};
		})
		.sort((left, right) =>
			JSON.stringify(left).localeCompare(JSON.stringify(right)),
		);
}

function entitySymbol(
	state: ProjectionState,
	entity: SemanticEntity,
): FactOntologySymbol {
	const name =
		entity.name ??
		Object.values(entity.identity.components)
			.filter((value) => value !== null)
			.map(String)
			.join(":");
	const kind =
		entity.kind === "shopify.dom-attribute"
			? "dom.attribute"
			: entity.kind === "shopify.css-class"
				? "css.class"
				: entity.kind;
	const namespace =
		entity.kind === "shopify.dom-attribute"
			? "dom"
			: entity.kind === "shopify.css-class"
				? "css"
				: entity.kind.includes(".")
					? entity.kind.slice(0, entity.kind.lastIndexOf("."))
					: "semantic";
	const path =
		entity.path ??
		(typeof entity.attributes.path === "string"
			? entity.attributes.path
			: entity.kind === "shopify.css-class" &&
					typeof entity.identity.components.path === "string"
				? entity.identity.components.path
				: undefined);
	const ref =
		entity.kind === "shopify.css-class" && path
			? `symbol:${escapeRef(kind)}:${escapeRef(path)}:${escapeRef(name)}`
			: `symbol:${escapeRef(kind)}:${escapeRef(name)}`;
	const artifact = path ? state.artifactByPath.get(path) : undefined;
	return {
		ref,
		kind,
		namespace,
		name,
		...(artifact ? { scope: { artifact: artifact.ref } } : {}),
	};
}

function bindingSymbol(
	occurrence: SemanticOccurrence,
	artifact: FactOntologyArtifact,
): FactOntologySymbol {
	const name = String(
		occurrence.attributes.name ?? occurrence.name ?? "unknown",
	);
	const end = Number(
		occurrence.attributes.scopeEnd ??
			occurrence.assertion.evidence[0]?.range.end ??
			0,
	);
	const ref = `symbol:liquid.binding:${escapeRef(artifact.path)}:${escapeRef(name)}:${end}`;
	return {
		ref,
		kind: "liquid.binding",
		namespace: "liquid",
		name,
		scope: {
			artifact: artifact.ref,
			start: Number(occurrence.attributes.scopeStart ?? 0),
			end,
		},
	};
}

function referenceSymbol(
	state: ProjectionState,
	occurrence: SemanticOccurrence,
	name: string,
): FactOntologySymbol {
	const anchor = occurrence.assertion.evidence[0];
	const path = anchor?.path ?? "unknown";
	const position = anchor?.range.start ?? 0;
	const binding = (state.bindingsByPathAndName.get(`${path}\0${name}`) ?? [])
		.filter(
			(candidate) =>
				Number(candidate.attributes.scopeStart) <= position &&
				Number(candidate.attributes.scopeEnd) >= position,
		)
		.sort(
			(left, right) =>
				Number(right.attributes.scopeStart) -
				Number(left.attributes.scopeStart),
		)[0];
	if (binding) {
		const ref = state.bindingSymbolRefs.get(binding.id);
		const symbol = ref ? state.symbols.get(ref) : undefined;
		if (symbol) return symbol;
	}
	const artifact = ensureArtifact(state, path);
	const ref = `symbol:liquid.reference:${escapeRef(path)}:${escapeRef(name)}`;
	const symbol: FactOntologySymbol = {
		ref,
		kind: "liquid.reference",
		namespace: "liquid",
		name,
		scope: { artifact: artifact.ref },
	};
	state.symbols.set(ref, symbol);
	return symbol;
}

function sourceRef(state: ProjectionState, anchor: SourceAnchor): string {
	const artifact = ensureArtifact(state, anchor.path);
	const ref = `source:${escapeRef(anchor.path)}:${anchor.range.start}:${anchor.range.end}:${anchor.role ?? "primary"}`;
	if (!state.sources.has(ref)) {
		state.sources.set(ref, {
			ref,
			artifact: artifact.ref,
			range: anchor.range,
			...(anchor.start
				? {
						line: anchor.start.line,
						character: anchor.start.character,
					}
				: {}),
			...(anchor.role ? { role: anchor.role } : {}),
		});
	}
	return ref;
}

function ensureArtifact(
	state: ProjectionState,
	path: string,
): FactOntologyArtifact {
	const existing = state.artifactByPath.get(path);
	if (existing) return existing;
	const artifact: FactOntologyArtifact = {
		ref: artifactRef(path),
		kind: "source",
		path,
	};
	state.artifacts.set(artifact.ref, artifact);
	state.artifactByPath.set(path, artifact);
	return artifact;
}

function ownerPath(
	state: ProjectionState,
	ownerId: string | undefined,
): string | undefined {
	if (!ownerId) return undefined;
	return state.entitiesById.get(ownerId)?.path;
}

function allAnchors(snapshot: SemanticGraphSnapshot): SourceAnchor[] {
	return [
		...snapshot.entities.flatMap((record) => record.assertion.evidence),
		...snapshot.occurrences.flatMap((record) => record.assertion.evidence),
		...snapshot.relations.flatMap((record) => record.assertion.evidence),
		...snapshot.values.flatMap((record) => record.assertion.evidence),
		...snapshot.predicates.flatMap((record) => record.assertion.evidence),
		...snapshot.boundaries.flatMap((record) => record.evidence),
		...snapshot.diagnostics.flatMap((record) => record.evidence),
	];
}

function groupValuesByOwner(
	values: readonly SemanticValue[],
): Map<string, SemanticValue[]> {
	const grouped = new Map<string, SemanticValue[]>();
	for (const value of values) {
		const entries = grouped.get(value.ownerId) ?? [];
		entries.push(value);
		grouped.set(value.ownerId, entries);
	}
	return grouped;
}

function groupBindings(
	occurrences: readonly SemanticOccurrence[],
): Map<string, SemanticOccurrence[]> {
	const grouped = new Map<string, SemanticOccurrence[]>();
	for (const occurrence of occurrences) {
		if (occurrence.kind !== "shopify.binding-site") continue;
		const path = occurrence.assertion.evidence[0]?.path;
		const name = occurrence.attributes.name;
		if (!path || typeof name !== "string") continue;
		const key = `${path}\0${name}`;
		const entries = grouped.get(key) ?? [];
		entries.push(occurrence);
		grouped.set(key, entries);
	}
	return grouped;
}

function sourceArtifactKind(
	entity: SemanticEntity | undefined,
): FactOntologyArtifact["kind"] {
	const role = entity?.attributes.role;
	return role === "generated"
		? "generated"
		: role === "external"
			? "external-snapshot"
			: "source";
}

function artifactRef(path: string): string {
	return `artifact:${escapeRef(path)}`;
}

function escapeRef(value: string): string {
	return encodeURIComponent(value).replaceAll("%", "~");
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function sorted<Record extends { ref: string }>(
	values: Iterable<Record>,
): Record[] {
	return [...values].sort((left, right) => left.ref.localeCompare(right.ref));
}
