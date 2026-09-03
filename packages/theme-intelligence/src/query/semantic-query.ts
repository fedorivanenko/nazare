import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticEntity,
	SemanticGraphSnapshot,
	SemanticOccurrence,
	SemanticPredicate,
	SemanticRelation,
	SemanticValue,
} from "../outputs/semantic-graph-snapshot.js";
import {
	buildSemanticIndex,
	type IndexedRecordCategory,
	normalizeSemanticSearchText,
	type SemanticIndexSnapshot,
	type SemanticPosting,
	type SemanticSearchDocument,
	type SemanticSearchLabel,
	semanticIdentityKey,
} from "../outputs/semantic-index.js";
import type { JsonScalar } from "../semantic/record.js";

export type SemanticIndexedRecord =
	| SemanticEntity
	| SemanticOccurrence
	| SemanticRelation
	| SemanticValue
	| SemanticPredicate
	| SemanticBoundary
	| SemanticCoverage;

export type SemanticSearchOptions = {
	kinds?: readonly string[];
	categories?: readonly ("entity" | "occurrence")[];
	limit?: number;
	offset?: number;
};

export type SemanticSearchMatch = {
	id: string;
	kind: string;
	category: "entity" | "occurrence";
	match: "exact" | "normalized" | "inferred";
	score: number;
	field: SemanticSearchLabel["field"];
	label: string;
};

export type SemanticSearchResult = {
	query: string;
	normalizedQuery: string;
	total: number;
	offset: number;
	returned: number;
	truncated: boolean;
	matches: readonly SemanticSearchMatch[];
};

export class SemanticIndexRevisionMismatchError extends Error {
	constructor() {
		super("Semantic index revision does not match graph snapshot revision");
		this.name = "SemanticIndexRevisionMismatchError";
	}
}

/** Internal exact lookup and bounded discovery over one immutable snapshot. */
export class SemanticQueryIndex {
	readonly snapshot: SemanticGraphSnapshot;
	readonly index: SemanticIndexSnapshot;
	readonly #records = new Map<string, SemanticIndexedRecord>();
	readonly #recordCategories = new Map<string, IndexedRecordCategory>();
	readonly #postingsByKind: ReadonlyMap<string, readonly string[]>;
	readonly #postingsByPath: ReadonlyMap<string, readonly string[]>;
	readonly #postingsByOwner: ReadonlyMap<string, readonly string[]>;
	readonly #relationsFrom: ReadonlyMap<string, readonly string[]>;
	readonly #relationsTo: ReadonlyMap<string, readonly string[]>;
	readonly #identities = new Map<string, string[]>();
	readonly #documents = new Map<string, SemanticSearchDocument>();
	readonly #searchExact: ReadonlyMap<string, readonly string[]>;
	readonly #searchNormalized: ReadonlyMap<string, readonly string[]>;
	readonly #searchTokens: ReadonlyMap<string, readonly string[]>;

	constructor(
		snapshot: SemanticGraphSnapshot,
		index: SemanticIndexSnapshot = buildSemanticIndex(snapshot),
	) {
		if (
			index.revision.id !== snapshot.revision.id ||
			index.revision.repositoryFingerprint !==
				snapshot.revision.repositoryFingerprint
		) {
			throw new SemanticIndexRevisionMismatchError();
		}
		this.snapshot = snapshot;
		this.index = index;
		for (const record of [
			...snapshot.entities,
			...snapshot.occurrences,
			...snapshot.relations,
			...snapshot.values,
			...snapshot.predicates,
			...snapshot.boundaries,
			...snapshot.coverage,
		]) {
			this.#records.set(record.id, record);
		}
		for (const locator of index.records) {
			this.#recordCategories.set(locator.id, locator.category);
		}
		this.#postingsByKind = postingMap(index.byKind);
		this.#postingsByPath = postingMap(index.byPath);
		this.#postingsByOwner = postingMap(index.byOwner);
		this.#relationsFrom = postingMap(index.relationsFrom);
		this.#relationsTo = postingMap(index.relationsTo);
		for (const identity of index.identities) {
			const ids = this.#identities.get(identity.key) ?? [];
			ids.push(identity.id);
			this.#identities.set(identity.key, ids);
		}
		for (const document of index.search.documents) {
			this.#documents.set(document.id, document);
		}
		this.#searchExact = postingMap(index.search.exact);
		this.#searchNormalized = postingMap(index.search.normalized);
		this.#searchTokens = postingMap(index.search.tokens);
	}

	record(id: string): SemanticIndexedRecord | undefined {
		return this.#records.get(id);
	}

	category(id: string): IndexedRecordCategory | undefined {
		return this.#recordCategories.get(id);
	}

	findByKind(kind: string): SemanticIndexedRecord[] {
		return this.#recordsFor(this.#postingsByKind.get(kind));
	}

	findByPath(path: string): SemanticEntity[] {
		return this.#recordsFor(this.#postingsByPath.get(path)).filter(
			(record): record is SemanticEntity =>
				this.category(record.id) === "entity",
		);
	}

	findByIdentity(
		kind: string,
		components: Readonly<Record<string, JsonScalar>>,
	): SemanticEntity[] {
		return this.#recordsFor(
			this.#identities.get(semanticIdentityKey(kind, components)),
		).filter(
			(record): record is SemanticEntity =>
				this.category(record.id) === "entity",
		);
	}

	ownedBy(ownerId: string): SemanticIndexedRecord[] {
		return this.#recordsFor(this.#postingsByOwner.get(ownerId));
	}

	outgoing(subjectId: string, kind?: string): SemanticRelation[] {
		return this.#relations(this.#relationsFrom.get(subjectId), kind);
	}

	incoming(subjectId: string, kind?: string): SemanticRelation[] {
		return this.#relations(this.#relationsTo.get(subjectId), kind);
	}

	evidenceAt(
		path: string,
		start: number,
		end = start,
	): SemanticIndexedRecord[] {
		const ids = new Set<string>();
		for (const entry of this.index.evidence) {
			if (entry.path !== path) continue;
			const overlaps =
				start === end
					? entry.start <= start && start < entry.end
					: entry.start < end && start < entry.end;
			if (overlaps) ids.add(entry.recordId);
		}
		return this.#recordsFor([...ids].sort());
	}

	coverageFor(family: string, path?: string): SemanticCoverage[] {
		const coverage = this.findByKind(family).filter(
			(record): record is SemanticCoverage =>
				this.category(record.id) === "coverage",
		);
		return coverage.filter(
			(record) =>
				!path || !record.scope.paths || record.scope.paths.includes(path),
		);
	}

	search(
		query: string,
		options: SemanticSearchOptions = {},
	): SemanticSearchResult {
		const rawQuery = query.trim();
		const normalizedQuery = normalizeSemanticSearchText(rawQuery);
		const offset = Math.max(0, Math.trunc(options.offset ?? 0));
		const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 20)));
		if (!rawQuery || !normalizedQuery) {
			return {
				query: rawQuery,
				normalizedQuery,
				total: 0,
				offset,
				returned: 0,
				truncated: false,
				matches: [],
			};
		}

		const exactIds = new Set(this.#searchExact.get(rawQuery) ?? []);
		const normalizedIds = new Set(
			this.#searchNormalized.get(normalizedQuery) ?? [],
		);
		const queryTokens = [
			...new Set(normalizedQuery.split(" ").filter(Boolean)),
		];
		const inferredIds = intersectPostings(
			queryTokens.map((token) => this.#searchTokens.get(token) ?? []),
		);
		const candidateIds = new Set([
			...exactIds,
			...normalizedIds,
			...inferredIds,
		]);
		const kindFilter = options.kinds ? new Set(options.kinds) : undefined;
		const categoryFilter = options.categories
			? new Set(options.categories)
			: undefined;
		const matches: SemanticSearchMatch[] = [];
		for (const id of candidateIds) {
			const document = this.#documents.get(id);
			if (!document) continue;
			if (kindFilter && !kindFilter.has(document.kind)) continue;
			if (categoryFilter && !categoryFilter.has(document.category)) continue;
			const match = exactIds.has(id)
				? "exact"
				: normalizedIds.has(id)
					? "normalized"
					: "inferred";
			const label = bestLabel(
				document.labels,
				rawQuery,
				normalizedQuery,
				queryTokens,
				match,
			);
			matches.push({
				id,
				kind: document.kind,
				category: document.category,
				match,
				score: matchScore(match, label.field, queryTokens.length),
				field: label.field,
				label: label.value,
			});
		}
		matches.sort(
			(left, right) =>
				right.score - left.score ||
				left.kind.localeCompare(right.kind) ||
				left.id.localeCompare(right.id),
		);
		const page = matches.slice(offset, offset + limit);
		return {
			query: rawQuery,
			normalizedQuery,
			total: matches.length,
			offset,
			returned: page.length,
			truncated: offset + page.length < matches.length,
			matches: page,
		};
	}

	#recordsFor(ids: readonly string[] | undefined): SemanticIndexedRecord[] {
		if (!ids) return [];
		const records: SemanticIndexedRecord[] = [];
		for (const id of ids) {
			const record = this.#records.get(id);
			if (record) records.push(record);
		}
		return records;
	}

	#relations(
		ids: readonly string[] | undefined,
		kind?: string,
	): SemanticRelation[] {
		const relations = this.#recordsFor(ids).filter(
			(record): record is SemanticRelation =>
				this.category(record.id) === "relation",
		);
		return relations.filter((relation) => !kind || relation.kind === kind);
	}
}

function postingMap(
	postings: readonly SemanticPosting[],
): ReadonlyMap<string, readonly string[]> {
	return new Map(postings.map(({ key, ids }) => [key, ids]));
}

function intersectPostings(
	postings: readonly (readonly string[])[],
): Set<string> {
	if (
		postings.length === 0 ||
		postings.some((posting) => posting.length === 0)
	) {
		return new Set();
	}
	const [first = [], ...rest] = [...postings].sort(
		(left, right) => left.length - right.length,
	);
	return new Set(
		first.filter((id) => rest.every((posting) => posting.includes(id))),
	);
}

function bestLabel(
	labels: readonly SemanticSearchLabel[],
	rawQuery: string,
	normalizedQuery: string,
	queryTokens: readonly string[],
	match: SemanticSearchMatch["match"],
): SemanticSearchLabel {
	const candidates = labels.filter((label) => {
		if (match === "exact") return label.value === rawQuery;
		if (match === "normalized") return label.normalized === normalizedQuery;
		const tokens = new Set(label.normalized.split(" "));
		return queryTokens.every((token) => tokens.has(token));
	});
	const pool = candidates.length > 0 ? candidates : labels;
	return (
		[...pool].sort(
			(left, right) =>
				fieldWeight(right.field) - fieldWeight(left.field) ||
				left.value.length - right.value.length ||
				left.value.localeCompare(right.value),
		)[0] ?? { field: "attribute", value: rawQuery, normalized: normalizedQuery }
	);
}

function matchScore(
	match: SemanticSearchMatch["match"],
	field: SemanticSearchLabel["field"],
	queryTokenCount: number,
): number {
	const base = match === "exact" ? 300 : match === "normalized" ? 200 : 100;
	return base + fieldWeight(field) + Math.min(20, queryTokenCount);
}

function fieldWeight(field: SemanticSearchLabel["field"]): number {
	return field === "name"
		? 40
		: field === "path"
			? 30
			: field === "identity"
				? 20
				: 10;
}
