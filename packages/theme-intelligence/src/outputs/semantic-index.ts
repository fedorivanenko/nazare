import type { JsonScalar, JsonValue } from "../semantic/record.js";
import type {
	SemanticEntity,
	SemanticGraphSnapshot,
	SemanticOccurrence,
} from "./semantic-graph-snapshot.js";

export const SEMANTIC_INDEX_VERSION = 1 as const;

export type IndexedRecordCategory =
	| "entity"
	| "occurrence"
	| "relation"
	| "value"
	| "predicate"
	| "boundary"
	| "coverage";

export type SemanticIndexSnapshot = {
	contractVersion: typeof SEMANTIC_INDEX_VERSION;
	revision: {
		id: string;
		repositoryFingerprint: string;
	};
	records: readonly SemanticRecordLocator[];
	byKind: readonly SemanticPosting[];
	byPath: readonly SemanticPosting[];
	byOwner: readonly SemanticPosting[];
	relationsFrom: readonly SemanticPosting[];
	relationsTo: readonly SemanticPosting[];
	identities: readonly SemanticIdentityIndexEntry[];
	evidence: readonly SemanticEvidenceIndexEntry[];
	search: SemanticSearchIndex;
};

export type SemanticRecordLocator = {
	id: string;
	category: IndexedRecordCategory;
};

export type SemanticPosting = {
	key: string;
	ids: readonly string[];
};

export type SemanticIdentityIndexEntry = {
	kind: string;
	key: string;
	id: string;
};

export type SemanticEvidenceIndexEntry = {
	path: string;
	start: number;
	end: number;
	recordId: string;
};

export type SemanticSearchIndex = {
	documents: readonly SemanticSearchDocument[];
	exact: readonly SemanticPosting[];
	normalized: readonly SemanticPosting[];
	tokens: readonly SemanticPosting[];
};

export type SemanticSearchDocument = {
	id: string;
	kind: string;
	category: "entity" | "occurrence";
	labels: readonly SemanticSearchLabel[];
};

export type SemanticSearchLabel = {
	field: "name" | "path" | "identity" | "attribute";
	value: string;
	normalized: string;
};

const MAX_SEARCH_LABEL_LENGTH = 512;

/** Builds deterministic lookup structures without changing graph truth. */
export function buildSemanticIndex(
	snapshot: SemanticGraphSnapshot,
): SemanticIndexSnapshot {
	const records: SemanticRecordLocator[] = [];
	const kinds = new Map<string, Set<string>>();
	const paths = new Map<string, Set<string>>();
	const owners = new Map<string, Set<string>>();
	const from = new Map<string, Set<string>>();
	const to = new Map<string, Set<string>>();
	const identities: SemanticIdentityIndexEntry[] = [];
	const evidence: SemanticEvidenceIndexEntry[] = [];
	const searchDocuments: SemanticSearchDocument[] = [];
	const seenIds = new Set<string>();

	for (const entity of snapshot.entities) {
		register(entity.id, "entity", entity.kind);
		if (entity.path) addPosting(paths, entity.path, entity.id);
		identities.push({
			kind: entity.kind,
			key: semanticIdentityKey(entity.kind, entity.identity.components),
			id: entity.id,
		});
		indexAssertionEvidence(entity.id, entity.assertion.evidence);
		searchDocuments.push(searchEntity(entity));
	}
	for (const occurrence of snapshot.occurrences) {
		register(occurrence.id, "occurrence", occurrence.kind);
		if (occurrence.ownerId)
			addPosting(owners, occurrence.ownerId, occurrence.id);
		indexAssertionEvidence(occurrence.id, occurrence.assertion.evidence);
		searchDocuments.push(searchOccurrence(occurrence));
	}
	for (const relation of snapshot.relations) {
		register(relation.id, "relation", relation.kind);
		addPosting(from, relation.from, relation.id);
		addPosting(to, relation.to, relation.id);
		indexAssertionEvidence(relation.id, relation.assertion.evidence);
	}
	for (const value of snapshot.values) {
		register(value.id, "value", value.slot);
		addPosting(owners, value.ownerId, value.id);
		indexAssertionEvidence(value.id, value.assertion.evidence);
	}
	for (const predicate of snapshot.predicates) {
		register(predicate.id, "predicate", predicate.kind);
		indexAssertionEvidence(predicate.id, predicate.assertion.evidence);
	}
	for (const boundary of snapshot.boundaries) {
		register(boundary.id, "boundary", boundary.kind);
		indexAssertionEvidence(boundary.id, boundary.evidence);
	}
	for (const coverage of snapshot.coverage) {
		register(coverage.id, "coverage", coverage.family);
	}

	identities.sort(
		(left, right) =>
			left.kind.localeCompare(right.kind) ||
			left.key.localeCompare(right.key) ||
			left.id.localeCompare(right.id),
	);
	evidence.sort(
		(left, right) =>
			left.path.localeCompare(right.path) ||
			left.start - right.start ||
			left.end - right.end ||
			left.recordId.localeCompare(right.recordId),
	);
	searchDocuments.sort((left, right) => left.id.localeCompare(right.id));

	return {
		contractVersion: SEMANTIC_INDEX_VERSION,
		revision: {
			id: snapshot.revision.id,
			repositoryFingerprint: snapshot.revision.repositoryFingerprint,
		},
		records: records.sort((left, right) => left.id.localeCompare(right.id)),
		byKind: postings(kinds),
		byPath: postings(paths),
		byOwner: postings(owners),
		relationsFrom: postings(from),
		relationsTo: postings(to),
		identities,
		evidence,
		search: buildSearchIndex(searchDocuments),
	};

	function register(
		id: string,
		category: IndexedRecordCategory,
		kind: string,
	): void {
		if (seenIds.has(id))
			throw new Error(`Cannot index duplicate semantic record ID ${id}`);
		seenIds.add(id);
		records.push({ id, category });
		addPosting(kinds, kind, id);
	}

	function indexAssertionEvidence(
		recordId: string,
		anchors: readonly { path: string; range: { start: number; end: number } }[],
	): void {
		for (const anchor of anchors) {
			evidence.push({
				path: anchor.path,
				start: anchor.range.start,
				end: anchor.range.end,
				recordId,
			});
		}
	}
}

export function semanticIdentityKey(
	kind: string,
	components: Readonly<Record<string, JsonScalar>>,
): string {
	return `${kind}\u0000${canonicalJson(components)}`;
}

export function normalizeSemanticSearchText(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
		.toLocaleLowerCase("en-US")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/gu, " ");
}

function searchEntity(entity: SemanticEntity): SemanticSearchDocument {
	const labels: SemanticSearchLabel[] = [];
	if (entity.name) addSearchLabel(labels, "name", entity.name);
	if (entity.path) addSearchLabel(labels, "path", entity.path);
	for (const value of Object.values(entity.identity.components)) {
		if (value !== null) addSearchLabel(labels, "identity", String(value));
	}
	addAttributeLabels(labels, entity.attributes);
	return {
		id: entity.id,
		kind: entity.kind,
		category: "entity",
		labels: canonicalLabels(labels),
	};
}

function searchOccurrence(
	occurrence: SemanticOccurrence,
): SemanticSearchDocument {
	const labels: SemanticSearchLabel[] = [];
	if (occurrence.name) addSearchLabel(labels, "name", occurrence.name);
	addAttributeLabels(labels, occurrence.attributes);
	return {
		id: occurrence.id,
		kind: occurrence.kind,
		category: "occurrence",
		labels: canonicalLabels(labels),
	};
}

function addAttributeLabels(
	labels: SemanticSearchLabel[],
	attributes: Readonly<Record<string, JsonValue>>,
): void {
	for (const value of Object.values(attributes)) {
		addJsonLabels(labels, value, 0);
	}
}

function addJsonLabels(
	labels: SemanticSearchLabel[],
	value: JsonValue,
	depth: number,
): void {
	if (depth > 2 || value === null) return;
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		addSearchLabel(labels, "attribute", String(value));
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) addJsonLabels(labels, item, depth + 1);
		return;
	}
	for (const item of Object.values(value)) {
		addJsonLabels(labels, item, depth + 1);
	}
}

function addSearchLabel(
	labels: SemanticSearchLabel[],
	field: SemanticSearchLabel["field"],
	value: string,
): void {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > MAX_SEARCH_LABEL_LENGTH) return;
	const normalized = normalizeSemanticSearchText(trimmed);
	if (!normalized) return;
	labels.push({ field, value: trimmed, normalized });
}

function canonicalLabels(
	labels: readonly SemanticSearchLabel[],
): SemanticSearchLabel[] {
	const unique = new Map<string, SemanticSearchLabel>();
	for (const label of labels) {
		unique.set(`${label.field}\u0000${label.value}`, label);
	}
	return [...unique.values()].sort(
		(left, right) =>
			left.field.localeCompare(right.field) ||
			left.value.localeCompare(right.value),
	);
}

function buildSearchIndex(
	documents: readonly SemanticSearchDocument[],
): SemanticSearchIndex {
	const exact = new Map<string, Set<string>>();
	const normalized = new Map<string, Set<string>>();
	const tokens = new Map<string, Set<string>>();
	for (const document of documents) {
		for (const label of document.labels) {
			addPosting(exact, label.value, document.id);
			addPosting(normalized, label.normalized, document.id);
			for (const token of label.normalized.split(" ")) {
				if (token) addPosting(tokens, token, document.id);
			}
		}
	}
	return {
		documents,
		exact: postings(exact),
		normalized: postings(normalized),
		tokens: postings(tokens),
	};
}

function addPosting(
	index: Map<string, Set<string>>,
	key: string,
	id: string,
): void {
	let ids = index.get(key);
	if (!ids) {
		ids = new Set();
		index.set(key, ids);
	}
	ids.add(id);
}

function postings(
	index: ReadonlyMap<string, ReadonlySet<string>>,
): SemanticPosting[] {
	return [...index.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, ids]) => ({ key, ids: [...ids].sort() }));
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}
