import type {
	OntologyAttribute,
	OntologyEndpoint,
	OntologyEntityKind,
	OntologyModule,
	OntologyOccurrenceKind,
	OntologyPredicateKind,
	OntologyRelationKind,
	OntologyValueSlot,
} from "../ontology/module.js";
import type {
	CoverageScope,
	SemanticEntity,
	SemanticGraphSnapshot,
	SemanticOccurrence,
	SemanticPredicate,
	SemanticRelation,
	SemanticValue,
} from "../outputs/semantic-graph-snapshot.js";
import type { AssertionMetadata } from "../semantic/assertion.js";
import type { SourceAnchor } from "../semantic/evidence.js";
import type { JsonValue, SemanticRecordId } from "../semantic/record.js";

export type SemanticGraphContractIssue = {
	code: string;
	path: string;
	message: string;
};

export type SemanticGraphContractResult = {
	valid: boolean;
	issues: readonly SemanticGraphContractIssue[];
};

type RecordCategory =
	| "entity"
	| "occurrence"
	| "relation"
	| "value"
	| "predicate"
	| "boundary";

type RegisteredRecord = {
	category: RecordCategory;
	kind?: string;
};

export class InvalidOntologyError extends Error {
	readonly issues: readonly SemanticGraphContractIssue[];

	constructor(issues: readonly SemanticGraphContractIssue[]) {
		super(`Invalid semantic ontology: ${issues.length} contract issue(s)`);
		this.name = "InvalidOntologyError";
		this.issues = issues;
	}
}

export class InvalidSemanticGraphError extends Error {
	readonly issues: readonly SemanticGraphContractIssue[];

	constructor(issues: readonly SemanticGraphContractIssue[]) {
		super(`Invalid semantic graph: ${issues.length} contract issue(s)`);
		this.name = "InvalidSemanticGraphError";
		this.issues = issues;
	}
}

/** Compiles ontology modules into executable semantic graph constraints. */
export class SemanticGraphContract {
	readonly ontologies: readonly OntologyModule[];

	readonly #entities = new Map<string, OntologyEntityKind>();
	readonly #occurrences = new Map<string, OntologyOccurrenceKind>();
	readonly #relations = new Map<string, OntologyRelationKind>();
	readonly #values = new Map<string, OntologyValueSlot>();
	readonly #predicates = new Map<string, OntologyPredicateKind>();
	readonly #coverageFamilies = new Set<string>();
	readonly #boundaryKinds = new Set<string>();

	constructor(ontologies: readonly OntologyModule[]) {
		this.ontologies = [...ontologies].sort((left, right) =>
			left.namespace.localeCompare(right.namespace),
		);
		const issues = this.#compile();
		if (issues.length > 0) throw new InvalidOntologyError(issues);
	}

	validate(snapshot: SemanticGraphSnapshot): SemanticGraphContractResult {
		const issues: SemanticGraphContractIssue[] = [];
		const records = new Map<SemanticRecordId, RegisteredRecord>();
		const boundaries = new Set(
			snapshot.boundaries.map((boundary) => boundary.id),
		);

		if (snapshot.contractVersion !== 1) {
			pushIssue(
				issues,
				"SNAPSHOT_CONTRACT_VERSION_MISMATCH",
				"contractVersion",
				`Unsupported snapshot contract version ${snapshot.contractVersion}`,
			);
		}
		this.#validateOntologyReferences(snapshot, issues);
		registerRecords(snapshot.entities, "entity", records, issues, "entities");
		registerRecords(
			snapshot.occurrences,
			"occurrence",
			records,
			issues,
			"occurrences",
		);
		registerRecords(
			snapshot.relations,
			"relation",
			records,
			issues,
			"relations",
		);
		registerRecords(snapshot.values, "value", records, issues, "values");
		registerRecords(
			snapshot.predicates,
			"predicate",
			records,
			issues,
			"predicates",
		);
		registerRecords(
			snapshot.boundaries,
			"boundary",
			records,
			issues,
			"boundaries",
		);

		this.#validateEntities(snapshot.entities, boundaries, records, issues);
		this.#validateOccurrences(
			snapshot.occurrences,
			boundaries,
			records,
			issues,
		);
		this.#validateRelations(snapshot.relations, boundaries, records, issues);
		this.#validateValues(snapshot.values, boundaries, records, issues);
		this.#validatePredicates(snapshot.predicates, boundaries, records, issues);

		for (const [index, boundary] of snapshot.boundaries.entries()) {
			const path = `boundaries[${index}]`;
			if (!this.#boundaryKinds.has(boundary.kind)) {
				pushIssue(
					issues,
					"UNKNOWN_BOUNDARY_KIND",
					`${path}.kind`,
					`Boundary kind ${boundary.kind} is not declared`,
				);
			}
			validateReferences(
				boundary.subjectIds,
				records,
				`${path}.subjectIds`,
				issues,
			);
			validateEvidence(boundary.evidence, `${path}.evidence`, issues);
		}

		for (const [index, coverage] of snapshot.coverage.entries()) {
			const path = `coverage[${index}]`;
			if (!this.#coverageFamilies.has(coverage.family)) {
				pushIssue(
					issues,
					"UNKNOWN_COVERAGE_FAMILY",
					`${path}.family`,
					`Coverage family ${coverage.family} is not declared`,
				);
			}
			if (emptyCoverageScope(coverage.scope)) {
				pushIssue(
					issues,
					"EMPTY_COVERAGE_SCOPE",
					`${path}.scope`,
					"Coverage scope must identify at least one path, language, kind, or subject",
				);
			}
			validateReferences(
				coverage.boundaryIds,
				new Map([...boundaries].map((id) => [id, { category: "boundary" }])),
				`${path}.boundaryIds`,
				issues,
			);
		}

		for (const [index, diagnostic] of snapshot.diagnostics.entries()) {
			validateEvidence(
				diagnostic.evidence,
				`diagnostics[${index}].evidence`,
				issues,
			);
		}

		validateCanonicalOrder(snapshot.entities, "entities", issues);
		validateCanonicalOrder(snapshot.occurrences, "occurrences", issues);
		validateCanonicalOrder(snapshot.relations, "relations", issues);
		validateCanonicalOrder(snapshot.values, "values", issues);
		validateCanonicalOrder(snapshot.predicates, "predicates", issues);
		validateCanonicalOrder(snapshot.boundaries, "boundaries", issues);
		validateCanonicalOrder(snapshot.coverage, "coverage", issues);

		return { valid: issues.length === 0, issues };
	}

	assert(snapshot: SemanticGraphSnapshot): void {
		const result = this.validate(snapshot);
		if (!result.valid) throw new InvalidSemanticGraphError(result.issues);
	}

	#compile(): SemanticGraphContractIssue[] {
		const issues: SemanticGraphContractIssue[] = [];
		const namespaces = new Set<string>();
		const declaredKinds = new Set<string>();
		for (const [moduleIndex, ontology] of this.ontologies.entries()) {
			const path = `ontologies[${moduleIndex}]`;
			if (namespaces.has(ontology.namespace)) {
				pushIssue(
					issues,
					"DUPLICATE_ONTOLOGY_NAMESPACE",
					`${path}.namespace`,
					`Ontology namespace ${ontology.namespace} is duplicated`,
				);
			}
			namespaces.add(ontology.namespace);
			registerDefinitions(
				ontology.entityKinds,
				ontology.namespace,
				this.#entities,
				declaredKinds,
				`${path}.entityKinds`,
				issues,
			);
			registerDefinitions(
				ontology.occurrenceKinds,
				ontology.namespace,
				this.#occurrences,
				declaredKinds,
				`${path}.occurrenceKinds`,
				issues,
			);
			registerDefinitions(
				ontology.relationKinds,
				ontology.namespace,
				this.#relations,
				declaredKinds,
				`${path}.relationKinds`,
				issues,
			);
			registerDefinitions(
				ontology.valueSlots,
				ontology.namespace,
				this.#values,
				declaredKinds,
				`${path}.valueSlots`,
				issues,
			);
			registerDefinitions(
				ontology.predicateKinds,
				ontology.namespace,
				this.#predicates,
				declaredKinds,
				`${path}.predicateKinds`,
				issues,
			);
			for (const boundaryKind of ontology.boundaryKinds) {
				if (this.#boundaryKinds.has(boundaryKind)) {
					pushIssue(
						issues,
						"DUPLICATE_BOUNDARY_KIND",
						`${path}.boundaryKinds`,
						`Boundary kind ${boundaryKind} is declared more than once`,
					);
				}
				this.#boundaryKinds.add(boundaryKind);
			}
			for (const [index, family] of ontology.coverageFamilies.entries()) {
				validateOwnedKind(
					family.kind,
					ontology.namespace,
					`${path}.coverageFamilies[${index}].kind`,
					issues,
				);
				if (declaredKinds.has(family.kind)) {
					pushIssue(
						issues,
						"DUPLICATE_ONTOLOGY_KIND",
						`${path}.coverageFamilies[${index}].kind`,
						`Ontology kind ${family.kind} is duplicated`,
					);
				}
				declaredKinds.add(family.kind);
				this.#coverageFamilies.add(family.kind);
			}
		}

		for (const [kind, definition] of this.#occurrences) {
			validateDeclaredKinds(
				definition.ownerKinds,
				this.#entities,
				`occurrenceKinds.${kind}.ownerKinds`,
				issues,
			);
		}
		for (const [kind, definition] of this.#relations) {
			validateEndpointDefinition(
				definition.from,
				this.#entities,
				this.#occurrences,
				`relationKinds.${kind}.from`,
				issues,
			);
			validateEndpointDefinition(
				definition.to,
				this.#entities,
				this.#occurrences,
				`relationKinds.${kind}.to`,
				issues,
			);
		}
		for (const [kind, definition] of this.#values) {
			const owners = new Map<string, unknown>();
			for (const ownerKind of [
				...this.#entities.keys(),
				...this.#occurrences.keys(),
			]) {
				owners.set(ownerKind, true);
			}
			validateDeclaredKinds(
				definition.ownerKinds,
				owners,
				`valueSlots.${kind}.ownerKinds`,
				issues,
			);
		}
		return issues;
	}

	#validateOntologyReferences(
		snapshot: SemanticGraphSnapshot,
		issues: SemanticGraphContractIssue[],
	): void {
		const expected = this.ontologies.map(({ namespace, version }) => ({
			namespace,
			version,
		}));
		if (JSON.stringify(snapshot.ontologies) !== JSON.stringify(expected)) {
			pushIssue(
				issues,
				"ONTOLOGY_VERSION_MISMATCH",
				"ontologies",
				"Snapshot ontology references do not match compiled contract",
			);
		}
	}

	#validateEntities(
		entities: readonly SemanticEntity[],
		boundaries: ReadonlySet<string>,
		records: ReadonlyMap<string, unknown>,
		issues: SemanticGraphContractIssue[],
	): void {
		for (const [index, entity] of entities.entries()) {
			const path = `entities[${index}]`;
			const definition = this.#entities.get(entity.kind);
			if (!definition) {
				pushIssue(issues, "UNKNOWN_ENTITY_KIND", `${path}.kind`, entity.kind);
				continue;
			}
			if (entity.identity.scheme !== entity.kind) {
				pushIssue(
					issues,
					"IDENTITY_SCHEME_MISMATCH",
					`${path}.identity.scheme`,
					`Expected ${entity.kind}, got ${entity.identity.scheme}`,
				);
			}
			validateIdentity(entity, definition, path, issues);
			validateAttributes(
				entity.attributes,
				definition.attributes,
				path,
				issues,
			);
			validateAssertion(entity.assertion, boundaries, records, path, issues);
		}
	}

	#validateOccurrences(
		occurrences: readonly SemanticOccurrence[],
		boundaries: ReadonlySet<string>,
		records: ReadonlyMap<string, { category?: string; kind?: string }>,
		issues: SemanticGraphContractIssue[],
	): void {
		for (const [index, occurrence] of occurrences.entries()) {
			const path = `occurrences[${index}]`;
			const definition = this.#occurrences.get(occurrence.kind);
			if (!definition) {
				pushIssue(
					issues,
					"UNKNOWN_OCCURRENCE_KIND",
					`${path}.kind`,
					occurrence.kind,
				);
				continue;
			}
			if (occurrence.ownerId) {
				const owner = records.get(occurrence.ownerId);
				if (
					owner?.category !== "entity" ||
					!owner.kind ||
					!definition.ownerKinds.includes(owner.kind as never)
				) {
					pushIssue(
						issues,
						"INVALID_OCCURRENCE_OWNER",
						`${path}.ownerId`,
						`Owner ${occurrence.ownerId} is not allowed for ${occurrence.kind}`,
					);
				}
			} else if (definition.ownerKinds.length > 0) {
				pushIssue(
					issues,
					"MISSING_OCCURRENCE_OWNER",
					`${path}.ownerId`,
					`Occurrence ${occurrence.kind} requires an owner`,
				);
			}
			validateAttributes(
				occurrence.attributes,
				definition.attributes,
				path,
				issues,
			);
			validateAssertion(
				occurrence.assertion,
				boundaries,
				records,
				path,
				issues,
			);
		}
	}

	#validateRelations(
		relations: readonly SemanticRelation[],
		boundaries: ReadonlySet<string>,
		records: ReadonlyMap<string, { category?: string; kind?: string }>,
		issues: SemanticGraphContractIssue[],
	): void {
		for (const [index, relation] of relations.entries()) {
			const path = `relations[${index}]`;
			const definition = this.#relations.get(relation.kind);
			if (!definition) {
				pushIssue(
					issues,
					"UNKNOWN_RELATION_KIND",
					`${path}.kind`,
					relation.kind,
				);
				continue;
			}
			validateEndpoint(
				relation.from,
				definition.from,
				records,
				`${path}.from`,
				issues,
			);
			validateEndpoint(
				relation.to,
				definition.to,
				records,
				`${path}.to`,
				issues,
			);
			if (!definition.allowsGuards && relation.guards.length > 0) {
				pushIssue(
					issues,
					"RELATION_GUARDS_NOT_ALLOWED",
					`${path}.guards`,
					`Relation ${relation.kind} does not allow guards`,
				);
			}
			validateReferencesOfCategory(
				relation.guards,
				"predicate",
				records,
				`${path}.guards`,
				issues,
			);
			validateAttributes(
				relation.attributes,
				definition.attributes,
				path,
				issues,
			);
			validateAssertion(relation.assertion, boundaries, records, path, issues);
		}
	}

	#validateValues(
		values: readonly SemanticValue[],
		boundaries: ReadonlySet<string>,
		records: ReadonlyMap<string, { category?: string; kind?: string }>,
		issues: SemanticGraphContractIssue[],
	): void {
		for (const [index, value] of values.entries()) {
			const path = `values[${index}]`;
			const definition = this.#values.get(value.slot);
			if (!definition) {
				pushIssue(issues, "UNKNOWN_VALUE_SLOT", `${path}.slot`, value.slot);
				continue;
			}
			const owner = records.get(value.ownerId);
			if (
				!owner?.kind ||
				!definition.ownerKinds.includes(owner.kind as never)
			) {
				pushIssue(
					issues,
					"INVALID_VALUE_OWNER",
					`${path}.ownerId`,
					`Owner ${value.ownerId} is not allowed for ${value.slot}`,
				);
			}
			validateReferencesOfCategory(
				value.sourceValueIds,
				"value",
				records,
				`${path}.sourceValueIds`,
				issues,
			);
			validateAttributes(value.attributes, definition.attributes, path, issues);
			validateAssertion(value.assertion, boundaries, records, path, issues);
		}
	}

	#validatePredicates(
		predicates: readonly SemanticPredicate[],
		boundaries: ReadonlySet<string>,
		records: ReadonlyMap<string, { category?: string; kind?: string }>,
		issues: SemanticGraphContractIssue[],
	): void {
		for (const [index, predicate] of predicates.entries()) {
			const path = `predicates[${index}]`;
			const definition = this.#predicates.get(predicate.kind);
			if (!definition) {
				pushIssue(
					issues,
					"UNKNOWN_PREDICATE_KIND",
					`${path}.kind`,
					predicate.kind,
				);
				continue;
			}
			if (!definition.operators.includes(predicate.operator)) {
				pushIssue(
					issues,
					"INVALID_PREDICATE_OPERATOR",
					`${path}.operator`,
					`Operator ${predicate.operator} is not allowed for ${predicate.kind}`,
				);
			}
			for (const [operandIndex, operand] of predicate.operands.entries()) {
				if (operand.kind === "literal") continue;
				const id =
					operand.kind === "value"
						? operand.valueId
						: operand.kind === "subject"
							? operand.subjectId
							: operand.predicateId;
				const category =
					operand.kind === "value"
						? "value"
						: operand.kind === "predicate"
							? "predicate"
							: undefined;
				if (category) {
					validateReferencesOfCategory(
						[id],
						category,
						records,
						`${path}.operands[${operandIndex}]`,
						issues,
					);
				} else {
					validateSubjectReference(
						id,
						records,
						`${path}.operands[${operandIndex}]`,
						issues,
					);
				}
			}
			validateAttributes(
				predicate.attributes,
				definition.attributes,
				path,
				issues,
			);
			validateAssertion(predicate.assertion, boundaries, records, path, issues);
		}
	}
}

function registerDefinitions<T extends { kind: string }>(
	definitions: readonly T[],
	namespace: string,
	target: Map<string, T>,
	allKinds: Set<string>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	for (const [index, definition] of definitions.entries()) {
		const itemPath = `${path}[${index}].kind`;
		validateOwnedKind(definition.kind, namespace, itemPath, issues);
		if (allKinds.has(definition.kind)) {
			pushIssue(
				issues,
				"DUPLICATE_ONTOLOGY_KIND",
				itemPath,
				`Ontology kind ${definition.kind} is duplicated`,
			);
		}
		allKinds.add(definition.kind);
		target.set(definition.kind, definition);
	}
}

function validateOwnedKind(
	kind: string,
	namespace: string,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	if (
		!kind.startsWith(`${namespace}.`) ||
		kind.length === namespace.length + 1
	) {
		pushIssue(
			issues,
			"ONTOLOGY_KIND_NAMESPACE_MISMATCH",
			path,
			`Kind ${kind} must belong to namespace ${namespace}`,
		);
	}
}

function validateDeclaredKinds(
	kinds: readonly string[],
	declarations: ReadonlyMap<string, unknown>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	for (const [index, kind] of kinds.entries()) {
		if (!declarations.has(kind)) {
			pushIssue(
				issues,
				"UNKNOWN_ONTOLOGY_KIND_REFERENCE",
				`${path}[${index}]`,
				`Ontology kind ${kind} is not declared`,
			);
		}
	}
}

function validateEndpointDefinition(
	endpoint: OntologyEndpoint,
	entities: ReadonlyMap<string, unknown>,
	occurrences: ReadonlyMap<string, unknown>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	if (endpoint.categories.length === 0 || endpoint.kinds.length === 0) {
		pushIssue(
			issues,
			"EMPTY_RELATION_ENDPOINT",
			path,
			"Relation endpoint must declare categories and kinds",
		);
	}
	for (const [index, kind] of endpoint.kinds.entries()) {
		const declared =
			(endpoint.categories.includes("entity") && entities.has(kind)) ||
			(endpoint.categories.includes("occurrence") && occurrences.has(kind));
		if (!declared) {
			pushIssue(
				issues,
				"INVALID_RELATION_ENDPOINT_KIND",
				`${path}.kinds[${index}]`,
				`Endpoint kind ${kind} does not match an allowed category`,
			);
		}
	}
}

function registerRecords(
	recordsToAdd: readonly { id: string; kind?: string }[],
	category: RecordCategory,
	records: Map<string, RegisteredRecord>,
	issues: SemanticGraphContractIssue[],
	path: string,
): void {
	for (const [index, record] of recordsToAdd.entries()) {
		if (records.has(record.id)) {
			pushIssue(
				issues,
				"DUPLICATE_RECORD_ID",
				`${path}[${index}].id`,
				`Record ID ${record.id} is duplicated`,
			);
			continue;
		}
		records.set(record.id, { category, kind: record.kind });
	}
}

function validateIdentity(
	entity: SemanticEntity,
	definition: OntologyEntityKind,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	const components = new Map(
		definition.identity.map((component) => [component.name, component]),
	);
	for (const component of definition.identity) {
		if (component.required && !(component.name in entity.identity.components)) {
			pushIssue(
				issues,
				"MISSING_IDENTITY_COMPONENT",
				`${path}.identity.components.${component.name}`,
				`Identity component ${component.name} is required`,
			);
		}
	}
	for (const [name, value] of Object.entries(entity.identity.components)) {
		const component = components.get(name);
		if (!component) {
			pushIssue(
				issues,
				"UNKNOWN_IDENTITY_COMPONENT",
				`${path}.identity.components.${name}`,
				`Identity component ${name} is not declared`,
			);
			continue;
		}
		if (typeof value !== component.type) {
			pushIssue(
				issues,
				"INVALID_IDENTITY_COMPONENT_TYPE",
				`${path}.identity.components.${name}`,
				`Expected ${component.type}, got ${typeof value}`,
			);
		}
	}
}

function validateAttributes(
	attributes: Readonly<Record<string, JsonValue>>,
	definitions: readonly OntologyAttribute[],
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	const declared = new Map(
		definitions.map((attribute) => [attribute.name, attribute]),
	);
	for (const definition of definitions) {
		if (definition.required && !(definition.name in attributes)) {
			pushIssue(
				issues,
				"MISSING_ATTRIBUTE",
				`${path}.attributes.${definition.name}`,
				`Attribute ${definition.name} is required`,
			);
		}
	}
	for (const [name, value] of Object.entries(attributes)) {
		const definition = declared.get(name);
		if (!definition) {
			pushIssue(
				issues,
				"UNKNOWN_ATTRIBUTE",
				`${path}.attributes.${name}`,
				`Attribute ${name} is not declared`,
			);
			continue;
		}
		if (!matchesAttributeType(value, definition.type)) {
			pushIssue(
				issues,
				"INVALID_ATTRIBUTE_TYPE",
				`${path}.attributes.${name}`,
				`Attribute ${name} must be ${definition.type}`,
			);
		}
	}
}

function matchesAttributeType(
	value: JsonValue,
	type: OntologyAttribute["type"],
): boolean {
	if (type === "null") return value === null;
	if (type === "array") return Array.isArray(value);
	if (type === "object")
		return typeof value === "object" && value !== null && !Array.isArray(value);
	return typeof value === type;
}

function validateEndpoint(
	id: string,
	definition: OntologyEndpoint,
	records: ReadonlyMap<string, { category?: string; kind?: string }>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	const record = records.get(id);
	if (
		!record?.kind ||
		!definition.categories.includes(record.category as never) ||
		!definition.kinds.includes(record.kind as never)
	) {
		pushIssue(
			issues,
			"INVALID_RELATION_ENDPOINT",
			path,
			`Record ${id} is not an allowed endpoint`,
		);
	}
}

function validateAssertion(
	assertion: AssertionMetadata,
	boundaries: ReadonlySet<string>,
	records: ReadonlyMap<string, unknown>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	validateEvidence(assertion.evidence, `${path}.assertion.evidence`, issues);
	for (const [index, boundaryId] of assertion.boundaryIds.entries()) {
		if (!boundaries.has(boundaryId)) {
			pushIssue(
				issues,
				"UNKNOWN_BOUNDARY_REFERENCE",
				`${path}.assertion.boundaryIds[${index}]`,
				`Boundary ${boundaryId} does not exist`,
			);
		}
	}
	validateReferences(
		assertion.provenance.sourceIds,
		records,
		`${path}.assertion.provenance.sourceIds`,
		issues,
	);
	if (assertion.derivation) {
		validateReferences(
			assertion.derivation.inputIds,
			records,
			`${path}.assertion.derivation.inputIds`,
			issues,
		);
		if (assertion.derivation.depth < 0 || assertion.derivation.work < 0) {
			pushIssue(
				issues,
				"INVALID_DERIVATION_COST",
				`${path}.assertion.derivation`,
				"Derivation depth and work must be non-negative",
			);
		}
	}
}

function validateEvidence(
	evidence: readonly SourceAnchor[],
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	for (const [index, anchor] of evidence.entries()) {
		if (
			anchor.path.length === 0 ||
			anchor.range.start < 0 ||
			anchor.range.end < anchor.range.start
		) {
			pushIssue(
				issues,
				"INVALID_SOURCE_ANCHOR",
				`${path}[${index}]`,
				"Source anchor needs a path and valid half-open range",
			);
		}
	}
}

function validateReferences(
	ids: readonly string[],
	records: ReadonlyMap<string, unknown>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	for (const [index, id] of ids.entries()) {
		if (!records.has(id)) {
			pushIssue(
				issues,
				"UNKNOWN_RECORD_REFERENCE",
				`${path}[${index}]`,
				`Record ${id} does not exist`,
			);
		}
	}
}

function validateReferencesOfCategory(
	ids: readonly string[],
	category: RecordCategory,
	records: ReadonlyMap<string, { category?: string }>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	for (const [index, id] of ids.entries()) {
		if (records.get(id)?.category !== category) {
			pushIssue(
				issues,
				"INVALID_RECORD_REFERENCE_CATEGORY",
				`${path}[${index}]`,
				`Record ${id} must reference category ${category}`,
			);
		}
	}
}

function validateSubjectReference(
	id: string,
	records: ReadonlyMap<string, { category?: string }>,
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	const category = records.get(id)?.category;
	if (category !== "entity" && category !== "occurrence") {
		pushIssue(
			issues,
			"INVALID_SUBJECT_REFERENCE",
			path,
			`Record ${id} must reference an entity or occurrence`,
		);
	}
}

function validateCanonicalOrder(
	records: readonly { id: string }[],
	path: string,
	issues: SemanticGraphContractIssue[],
): void {
	for (let index = 1; index < records.length; index++) {
		if (records[index - 1]?.id.localeCompare(records[index]?.id ?? "") > 0) {
			pushIssue(
				issues,
				"NON_CANONICAL_ORDER",
				path,
				`${path} must be sorted by ID`,
			);
			return;
		}
	}
}

function emptyCoverageScope(scope: CoverageScope): boolean {
	return !(
		scope.paths?.length ||
		scope.languages?.length ||
		scope.kinds?.length ||
		scope.subjectIds?.length
	);
}

function pushIssue(
	issues: SemanticGraphContractIssue[],
	code: string,
	path: string,
	message: string,
): void {
	issues.push({ code, path, message });
}
