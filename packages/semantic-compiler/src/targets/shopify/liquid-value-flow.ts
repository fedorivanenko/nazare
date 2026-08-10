import type {
	SemanticAssemblyDraft,
	SemanticAssemblyPass,
} from "../../compiler/semantic-graph-assembler.js";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticEntity,
	SemanticOccurrence,
	SemanticRelation,
	SemanticValue,
} from "../../outputs/semantic-graph-snapshot.js";
export type ShopifyLiquidValueFlowLimits = {
	maxLinks: number;
	maxDepth: number;
};

const DEFAULT_LIMITS: ShopifyLiquidValueFlowLimits = {
	maxLinks: 100_000,
	maxDepth: 8,
};

/** Links bounded local/filter/render argument provenance without executing Liquid. */
export function createShopifyLiquidValueFlowPass(
	limits: ShopifyLiquidValueFlowLimits = DEFAULT_LIMITS,
): SemanticAssemblyPass {
	return {
		id: `shopify-liquid-value-flow:v1:${limits.maxLinks}:${limits.maxDepth}`,
		apply(draft, context) {
			applyValueFlow(draft, limits, context.repositoryScope.status);
		},
	};
}

export const shopifyLiquidValueFlowPass = createShopifyLiquidValueFlowPass();

type Binding = {
	occurrence: SemanticOccurrence;
	value: SemanticValue;
	path: string;
	start: number;
	scopeStart: number;
	scopeEnd: number;
	name: string;
};

function applyValueFlow(
	draft: SemanticAssemblyDraft,
	limits: ShopifyLiquidValueFlowLimits,
	repositoryStatus: "complete" | "partial",
): void {
	draft.entities.sort(compareId);
	draft.occurrences.sort(compareId);
	draft.relations.sort(compareId);
	draft.values.sort(compareId);
	draft.predicates.sort(compareId);
	draft.boundaries.sort(compareId);
	draft.coverage.sort(compareId);
	const values = new Map(draft.values.map((value) => [value.id, value]));
	const occurrences = new Map(
		draft.occurrences.map((occurrence) => [occurrence.id, occurrence]),
	);
	const entities = new Map(draft.entities.map((entity) => [entity.id, entity]));
	const valuesByOwner = groupBy(draft.values, ({ ownerId }) => ownerId);
	const outgoing = groupBy(draft.relations, ({ from }) => from);
	const incoming = groupBy(draft.relations, ({ to }) => to);
	const bindings = new Map<string, Binding[]>();
	const filterResults = new Map<string, SemanticValue>();
	let links = 0;
	let bounded = false;

	for (const occurrence of draft.occurrences) {
		const path = occurrence.assertion.evidence[0]?.path;
		const start = occurrence.assertion.evidence[0]?.range.start;
		if (path === undefined || start === undefined) continue;
		if (occurrence.kind === "shopify.binding-site") {
			const value = valuesByOwner
				.get(occurrence.id)
				?.find(({ slot }) => slot === "shopify.binding-value");
			if (!value) continue;
			const name = String(occurrence.attributes.name);
			const binding: Binding = {
				occurrence,
				value,
				path,
				start,
				scopeStart: Number(occurrence.attributes.scopeStart),
				scopeEnd: Number(occurrence.attributes.scopeEnd),
				name,
			};
			const key = `${path}\0${name}`;
			const entries = bindings.get(key) ?? [];
			entries.push(binding);
			bindings.set(key, entries);
		}
		if (occurrence.kind === "shopify.filter-site") {
			const result = valuesByOwner
				.get(occurrence.id)
				?.find(({ slot }) => slot === "shopify.filter-result");
			if (result) filterResults.set(valueKey(result), result);
		}
	}
	for (const entries of bindings.values()) {
		entries.sort((left, right) => left.start - right.start);
	}

	for (const value of draft.values) {
		if (bounded) break;
		if (value.slot !== "shopify.filter-result") {
			const filterResult = filterResults.get(valueKey(value));
			if (filterResult && filterResult.id !== value.id) {
				bounded = !addLink(value, filterResult.id);
				if (bounded) break;
			}
		}
		const root = expressionRoot(value.expression);
		const evidence = value.assertion.evidence[0];
		if (!root || !evidence) continue;
		const candidates = bindings.get(`${evidence.path}\0${root}`) ?? [];
		const binding = [...candidates]
			.reverse()
			.find(
				(candidate) =>
					candidate.start < evidence.range.start &&
					candidate.scopeStart <= evidence.range.start &&
					evidence.range.end <= candidate.scopeEnd,
			);
		if (binding) bounded = !addLink(value, binding.value.id);
	}

	if (!bounded) {
		for (const invokes of draft.relations.filter(
			({ kind }) => kind === "shopify.invokes",
		)) {
			const render = occurrences.get(invokes.from);
			const snippet = entities.get(invokes.to);
			if (!render || !snippet) continue;
			const targetFile = targetFileForSnippet(snippet, incoming, entities);
			if (!targetFile) continue;
			const argumentsForRender = (outgoing.get(render.id) ?? [])
				.filter(({ kind }) => kind === "shopify.passes-argument")
				.flatMap((relation) => {
					const argument = occurrences.get(relation.to);
					return argument ? [argument] : [];
				});
			for (const argument of argumentsForRender) {
				const argumentValue = valuesByOwner
					.get(argument.id)
					?.find(({ slot }) => slot === "shopify.render-argument-value");
				if (!argumentValue) continue;
				const parameter =
					typeof argument.attributes.name === "string"
						? argument.attributes.name
						: snippet.name;
				if (!parameter) continue;
				for (const read of draft.occurrences) {
					if (
						read.kind !== "shopify.expression-site" ||
						read.ownerId !== targetFile.id ||
						read.attributes.root !== parameter
					)
						continue;
					const readValue = valuesByOwner
						.get(read.id)
						?.find(({ slot }) => slot === "shopify.read-value");
					if (!readValue) continue;
					if (!addLink(readValue, argumentValue.id)) {
						bounded = true;
						break;
					}
				}
				if (bounded) break;
			}
			if (bounded) break;
		}
	}

	const forcedRuntime = openRenderContextValues(
		draft,
		occurrences,
		entities,
		valuesByOwner,
		outgoing,
		incoming,
		repositoryStatus,
	);
	bounded =
		propagateValueAssertions(
			draft.values,
			values,
			limits.maxDepth,
			forcedRuntime,
		) || bounded;
	pruneResolvedRuntimeSubjects(draft);
	projectCoverage(draft, bounded);

	function addLink(value: SemanticValue, sourceValueId: string): boolean {
		if (
			value.id === sourceValueId ||
			value.sourceValueIds.includes(sourceValueId)
		)
			return true;
		if (links >= limits.maxLinks) return false;
		value.sourceValueIds = [...value.sourceValueIds, sourceValueId].sort();
		links += 1;
		return true;
	}
}

function openRenderContextValues(
	draft: SemanticAssemblyDraft,
	occurrences: ReadonlyMap<string, SemanticOccurrence>,
	entities: ReadonlyMap<string, SemanticEntity>,
	valuesByOwner: ReadonlyMap<string, readonly SemanticValue[]>,
	outgoing: ReadonlyMap<string, readonly SemanticRelation[]>,
	incoming: ReadonlyMap<string, readonly SemanticRelation[]>,
	repositoryStatus: "complete" | "partial",
): Set<string> {
	const forcedRuntime = new Set<string>();
	const dynamicTargetExists = draft.occurrences.some(
		({ kind, attributes }) =>
			kind === "shopify.render-site" && attributes.targetKind === "dynamic",
	);
	const snippetByFile = new Map<string, SemanticEntity>();
	for (const relation of draft.relations) {
		if (relation.kind !== "shopify.defines") continue;
		const snippet = entities.get(relation.to);
		if (snippet?.kind === "shopify.snippet") {
			snippetByFile.set(relation.from, snippet);
		}
	}
	for (const read of draft.occurrences) {
		if (read.kind !== "shopify.expression-site" || !read.ownerId) continue;
		const snippet = snippetByFile.get(read.ownerId);
		if (!snippet) continue;
		const root = String(read.attributes.root);
		const calls = (incoming.get(snippet.id) ?? []).filter(
			({ kind }) => kind === "shopify.invokes",
		);
		const contextClosed =
			repositoryStatus === "complete" &&
			!dynamicTargetExists &&
			calls.length > 0 &&
			calls.every((call) =>
				(outgoing.get(call.from) ?? [])
					.filter(({ kind }) => kind === "shopify.passes-argument")
					.some((argumentRelation) => {
						const argument = occurrences.get(argumentRelation.to);
						if (!argument) return false;
						const parameter =
							typeof argument.attributes.name === "string"
								? argument.attributes.name
								: snippet.name;
						return parameter === root;
					}),
			);
		if (contextClosed) continue;
		const value = valuesByOwner
			.get(read.id)
			?.find(({ slot }) => slot === "shopify.read-value");
		if (value?.sourceValueIds.length) forcedRuntime.add(value.id);
	}
	return forcedRuntime;
}

function propagateValueAssertions(
	allValues: readonly SemanticValue[],
	values: ReadonlyMap<string, SemanticValue>,
	maxDepth: number,
	forcedRuntime: ReadonlySet<string>,
): boolean {
	for (let iteration = 0; iteration < maxDepth; iteration += 1) {
		let changed = false;
		for (const value of allValues) {
			if (value.sourceValueIds.length === 0) continue;
			const sources = value.sourceValueIds.flatMap((sourceId) => {
				const source = values.get(sourceId);
				return source ? [source] : [];
			});
			if (sources.length === 0) continue;
			const availability = worstAvailability([
				...sources.map(({ assertion }) => assertion.availability),
				...(forcedRuntime.has(value.id)
					? (["runtime-dependent"] as const)
					: []),
			]);
			const boundaryIds = [
				...new Set([
					...sources.flatMap(({ assertion }) => assertion.boundaryIds),
					...(forcedRuntime.has(value.id) ? value.assertion.boundaryIds : []),
				]),
			].sort();
			const depth = Math.min(
				maxDepth,
				1 +
					Math.max(
						0,
						...sources.map(({ assertion }) => assertion.derivation?.depth ?? 0),
					),
			);
			const next = {
				...value.assertion,
				epistemic: {
					status: "inferred" as const,
					basis: "bounded-analysis" as const,
				},
				availability,
				provenance: {
					...value.assertion.provenance,
					sourceIds: [
						...new Set([
							...value.assertion.provenance.sourceIds,
							...value.sourceValueIds,
						]),
					].sort(),
				},
				boundaryIds,
				derivation: {
					rule: "shopify.value-flow" as const,
					inputIds: value.sourceValueIds,
					depth,
					work:
						value.sourceValueIds.length +
						sources.reduce(
							(total, source) =>
								total + (source.assertion.derivation?.work ?? 0),
							0,
						),
				},
			};
			if (JSON.stringify(next) !== JSON.stringify(value.assertion)) {
				value.assertion = next;
				value.representation = "derived";
				changed = true;
			}
		}
		if (!changed) return false;
	}
	return true;
}

function pruneResolvedRuntimeSubjects(draft: SemanticAssemblyDraft): void {
	const staticValues = new Set(
		draft.values
			.filter(({ assertion }) => assertion.availability === "static")
			.map(({ id }) => id),
	);
	for (const boundary of draft.boundaries) {
		if (boundary.kind !== "shopify-runtime") continue;
		boundary.subjectIds = boundary.subjectIds.filter(
			(subjectId) => !staticValues.has(subjectId),
		);
	}
	const retained = draft.boundaries.filter(
		(boundary) =>
			boundary.kind !== "shopify-runtime" || boundary.subjectIds.length > 0,
	);
	draft.boundaries.splice(0, draft.boundaries.length, ...retained);
}

function projectCoverage(draft: SemanticAssemblyDraft, bounded: boolean): void {
	const existing = new Set(draft.coverage.map(({ id }) => id));
	for (const file of draft.entities.filter(
		(entity): entity is SemanticEntity => entity.kind === "shopify.source-file",
	)) {
		if (!file.path || file.attributes.language !== "liquid") continue;
		const inputs = draft.coverage.filter(
			({ family, scope }) =>
				scope.paths?.includes(file.path ?? "") &&
				[
					"shopify.reads",
					"shopify.bindings",
					"shopify.filters",
					"shopify.renders",
				].includes(family),
		);
		const boundaryIds = [
			...new Set(inputs.flatMap((coverage) => coverage.boundaryIds)),
		].sort();
		let status: SemanticCoverage["status"] = inputs.some(
			({ status: inputStatus }) => inputStatus !== "complete",
		)
			? "partial"
			: "complete";
		if (bounded) {
			const boundary = ensureBudgetBoundary(draft, file);
			boundaryIds.push(boundary.id);
			status = "partial";
		}
		const id = recordId("coverage", "shopify.value-flow", file.path);
		if (existing.has(id)) continue;
		draft.coverage.push({
			id,
			family: "shopify.value-flow",
			scope: { paths: [file.path], languages: ["liquid"] },
			status,
			extractor: { id: "shopify-liquid-value-flow", version: 1 },
			boundaryIds: [...new Set(boundaryIds)].sort(),
		});
	}
}

function ensureBudgetBoundary(
	draft: SemanticAssemblyDraft,
	file: SemanticEntity,
): SemanticBoundary {
	const id = recordId(
		"boundary",
		"shopify.value-flow",
		"budget",
		file.path ?? "",
	);
	const existing = draft.boundaries.find((boundary) => boundary.id === id);
	if (existing) return existing;
	const boundary: SemanticBoundary = {
		id,
		kind: "budget",
		message: "Liquid value-flow work or depth budget exhausted",
		subjectIds: [file.id],
		evidence: file.assertion.evidence,
		attributes: {},
	};
	draft.boundaries.push(boundary);
	return boundary;
}

function targetFileForSnippet(
	snippet: SemanticEntity,
	incoming: ReadonlyMap<string, readonly { kind: string; from: string }[]>,
	entities: ReadonlyMap<string, SemanticEntity>,
): SemanticEntity | undefined {
	for (const relation of incoming.get(snippet.id) ?? []) {
		if (relation.kind !== "shopify.defines") continue;
		const file = entities.get(relation.from);
		if (file?.kind === "shopify.source-file") return file;
	}
	return undefined;
}

function valueKey(value: SemanticValue): string {
	const evidence = value.assertion.evidence[0];
	return `${evidence?.path ?? ""}:${evidence?.range.start ?? -1}:${
		evidence?.range.end ?? -1
	}:${value.expression ?? ""}`;
}

function expressionRoot(expression?: string): string | undefined {
	if (!expression) return undefined;
	return /^([A-Za-z_][A-Za-z0-9_-]*)(?:\s|\.|\[|$)/u.exec(
		expression.trim(),
	)?.[1];
}

function worstAvailability(
	values: readonly SemanticValue["assertion"]["availability"][],
): SemanticValue["assertion"]["availability"] {
	const rank = {
		static: 0,
		"runtime-dependent": 1,
		"external-data-required": 2,
		unsupported: 3,
	} as const;
	return values.reduce(
		(worst, value) => (rank[value] > rank[worst] ? value : worst),
		"static",
	);
}

function groupBy<Item, Key extends string>(
	items: readonly Item[],
	key: (item: Item) => Key,
): Map<Key, Item[]> {
	const groups = new Map<Key, Item[]>();
	for (const item of items) {
		const itemKey = key(item);
		const values = groups.get(itemKey) ?? [];
		values.push(item);
		groups.set(itemKey, values);
	}
	return groups;
}

function compareId(left: { id: string }, right: { id: string }): number {
	return left.id.localeCompare(right.id);
}

function recordId(...parts: readonly string[]): string {
	return parts.map((part) => encodeURIComponent(part)).join(":");
}
