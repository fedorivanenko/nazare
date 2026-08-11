import { createHash } from "node:crypto";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticEntity,
	SemanticOccurrence,
	SemanticPredicate,
	SemanticRelation,
	SemanticValue,
} from "../outputs/semantic-graph-snapshot.js";
import type {
	SemanticIndexedRecord,
	SemanticQueryIndex,
} from "../query/semantic-query.js";
import type { AssertionMetadata } from "../semantic/assertion.js";
import type { SourceAnchor } from "../semantic/evidence.js";
import type { JsonValue } from "../semantic/record.js";
import type {
	InspectCompleteness,
	InspectDiscoveryKind,
	InspectEvidenceMode,
	InspectFacet,
	InspectGroup,
	InspectItem,
	InspectItemAssertion,
	InspectLocation,
	InspectSymbolKind,
	InspectValue,
	SemanticInspectRequest,
	SemanticInspectResponse,
	SemanticInspectSubject,
} from "./contract.js";
import { SEMANTIC_INSPECT_CONTRACT_VERSION } from "./contract.js";
import { parseSemanticInspectRequest } from "./input.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_EVIDENCE_PER_ITEM = 3;
const MAX_EXCERPT_LENGTH = 200;
const MAX_COMPLETENESS_REASONS = 5;
const MAX_VALUE_FLOW_DEPTH = 4;
const MAX_VALUE_FLOW_SOURCES = 8;

type CoverageRequirement = {
	family: string;
	path?: string;
	globalKind?: string;
};

type ProjectionContext = {
	evidence: InspectEvidenceMode;
	missingExcerpt: boolean;
};

type InspectionPage = {
	items: InspectItem[];
	page: SemanticInspectResponse["page"];
};

export type SemanticInspectOptions = {
	source?: (path: string) => string | undefined;
};

export class SemanticInspectInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SemanticInspectInputError";
	}
}

/** Domain projection for agents. Internal record IDs never cross this boundary. */
export class SemanticInspect {
	constructor(
		readonly query: SemanticQueryIndex,
		readonly options: SemanticInspectOptions = {},
	) {}

	inspect(request: SemanticInspectRequest): SemanticInspectResponse;
	inspect(input: unknown): SemanticInspectResponse;
	inspect(input: unknown): SemanticInspectResponse {
		const request = parseSemanticInspectRequest(input);
		const evidence = request.evidence ?? "location";
		const context: ProjectionContext = { evidence, missingExcerpt: false };
		const limit = boundedLimit(request.limit);
		if ("query" in request) {
			const cursorShape = {
				query: request.query,
				kinds: request.kinds ?? [],
				evidence,
				facet: "discover",
			};
			const offset = this.#cursorOffset(request.cursor, cursorShape);
			return this.#discover(request, context, offset, limit, cursorShape);
		}
		const facet = request.facet ?? "summary";
		const cursorShape = { subject: request.subject, evidence, facet };
		const offset = this.#cursorOffset(request.cursor, cursorShape);
		return this.#inspectSubject(
			request.subject,
			facet,
			context,
			offset,
			limit,
			cursorShape,
		);
	}

	#discover(
		request: Extract<SemanticInspectRequest, { query: string }>,
		context: ProjectionContext,
		offset: number,
		limit: number,
		cursorShape: unknown,
	): SemanticInspectResponse {
		if (!request.query.trim())
			throw new SemanticInspectInputError("query must be non-empty");
		const kinds = request.kinds ?? ["snippet"];
		const semanticKinds = kinds.flatMap((kind) =>
			publicKindToSemanticKinds(kind),
		);
		const result = this.query.search(request.query, {
			kinds: semanticKinds,
			limit,
			offset,
		});
		const items = result.matches.flatMap((match): InspectItem[] => {
			const record = this.query.record(match.id);
			if (!record) return [];
			return [
				{
					...this.#projectRecord(record, context),
					retrieval: { match: match.match, score: match.score },
				} as InspectItem,
			];
		});
		const groupTotals = new Map<InspectItem["type"], number>();
		for (const kind of kinds) {
			groupTotals.set(
				kind,
				this.query.search(request.query, {
					kinds: publicKindToSemanticKinds(kind),
					limit: 1,
				}).total,
			);
		}
		const requirements = this.#discoveryRequirements(kinds);
		const completeness = this.#completeness(requirements, [], context);
		const status =
			result.total > 0 ? "found" : missingResponseStatus(completeness);
		return this.#response({
			status,
			subject: { query: request.query },
			facet: "discover",
			answer: { groups: groupItems(items, items, groupTotals) },
			completeness,
			page: {
				total: result.total,
				returned: items.length,
				...(result.truncated
					? { nextCursor: this.#cursor(offset + items.length, cursorShape) }
					: {}),
			},
		});
	}

	#inspectSubject(
		subject: SemanticInspectSubject,
		facet: InspectFacet,
		context: ProjectionContext,
		offset: number,
		limit: number,
		cursorShape: unknown,
	): SemanticInspectResponse {
		if ("symbol" in subject) {
			return this.#inspectSymbol(
				subject,
				facet,
				context,
				offset,
				limit,
				cursorShape,
			);
		}
		switch (subject.type) {
			case "file":
				return this.#inspectFile(
					subject,
					facet,
					context,
					offset,
					limit,
					cursorShape,
				);
			case "snippet":
				return this.#inspectSnippet(
					subject,
					facet,
					context,
					offset,
					limit,
					cursorShape,
				);
			case "render":
				return this.#inspectOccurrenceSubject(
					subject,
					"shopify.render-site",
					facet,
					context,
				);
			case "expression":
				return this.#inspectOccurrenceSubject(
					subject,
					"shopify.expression-site",
					facet,
					context,
				);
		}
	}

	#inspectSymbol(
		subject: Extract<SemanticInspectSubject, { symbol: string }>,
		facet: InspectFacet,
		context: ProjectionContext,
		offset: number,
		limit: number,
		cursorShape: unknown,
	): SemanticInspectResponse {
		if (subject.kind === "binding" || (!subject.kind && subject.scope)) {
			return this.#inspectBindingSymbol(
				{ ...subject, kind: "binding" },
				facet,
				context,
			);
		}
		const kinds: readonly InspectDiscoveryKind[] = subject.kind
			? [subject.kind]
			: ["snippet"];
		const matches: Array<{
			kind: InspectSymbolKind;
			entity: SemanticEntity;
		}> = [];
		if (kinds.includes("file")) {
			for (const entity of this.query
				.findByPath(subject.symbol)
				.filter((candidate) => candidate.kind === "shopify.source-file")) {
				matches.push({ kind: "file", entity });
			}
		}
		if (kinds.includes("snippet")) {
			for (const entity of this.query.findByIdentity("shopify.snippet", {
				handle: normalizeSnippetHandle(subject.symbol),
			})) {
				matches.push({ kind: "snippet", entity });
			}
		}
		const requirements: CoverageRequirement[] = [
			...(kinds.includes("file")
				? [
						{
							family: "shopify.source-files",
							globalKind: "shopify.source-file",
						},
					]
				: []),
			...(kinds.includes("snippet")
				? [
						{
							family: "shopify.snippets",
							globalKind: "shopify.snippet",
						},
					]
				: []),
		];
		if (matches.length === 0) {
			const completeness = this.#completeness(requirements, [], context);
			return this.#response({
				status: missingResponseStatus(completeness),
				subject: subjectRecord(subject),
				facet,
				completeness,
			});
		}
		if (matches.length > 1) {
			return this.#response({
				status: "ambiguous",
				subject: subjectRecord(subject),
				facet,
				candidates: matches.map(({ entity }) =>
					this.#projectEntity(entity, context),
				),
				completeness: this.#completeness(
					requirements,
					matches.map(({ entity }) => entity),
					context,
				),
			});
		}
		const match = matches[0];
		if (!match) throw new SemanticInspectInputError("Symbol resolution failed");
		const response =
			match.kind === "file"
				? this.#inspectFile(
						{ type: "file", path: match.entity.path ?? subject.symbol },
						facet,
						context,
						offset,
						limit,
						cursorShape,
					)
				: this.#inspectSnippet(
						{
							type: "snippet",
							handle: normalizeSnippetHandle(subject.symbol),
						},
						facet,
						context,
						offset,
						limit,
						cursorShape,
					);
		return {
			...response,
			subject: {
				symbol:
					match.kind === "snippet"
						? normalizeSnippetHandle(subject.symbol)
						: subject.symbol,
				kind: match.kind,
			},
		};
	}

	#inspectBindingSymbol(
		subject: Extract<SemanticInspectSubject, { symbol: string }> & {
			kind: "binding";
		},
		facet: InspectFacet,
		context: ProjectionContext,
	): SemanticInspectResponse {
		const scope = subject.scope;
		if (!scope) {
			throw new SemanticInspectInputError(
				"Binding symbol subject requires scope.path",
			);
		}
		const file = this.query
			.findByPath(scope.path)
			.find((entity) => entity.kind === "shopify.source-file");
		const requirements: CoverageRequirement[] = [
			{ family: "shopify.bindings", path: scope.path },
			{ family: "shopify.value-flow", path: scope.path },
		];
		if (!file) {
			return this.#missing(subject, requirements, context);
		}
		const ownedOccurrences = this.query
			.ownedBy(file.id)
			.filter(
				(record): record is SemanticOccurrence =>
					this.query.category(record.id) === "occurrence",
			);
		const definitions = ownedOccurrences.filter(
			(occurrence) =>
				occurrence.kind === "shopify.binding-site" &&
				occurrence.attributes.name === subject.symbol &&
				(scope.offset === undefined ||
					(Number(occurrence.attributes.scopeStart) <= scope.offset &&
						Number(occurrence.attributes.scopeEnd) >= scope.offset)),
		);
		if (definitions.length === 0) {
			return this.#missing(subject, requirements, context);
		}
		const argumentSites = ownedOccurrences.filter(
			(occurrence) =>
				occurrence.kind === "shopify.render-argument-site" &&
				occurrence.attributes.expression === subject.symbol,
		);
		const renderById = new Map<string, SemanticOccurrence>();
		for (const argument of argumentSites) {
			for (const relation of this.query.incoming(
				argument.id,
				"shopify.passes-argument",
			)) {
				const render = this.query.record(relation.from);
				if (
					render &&
					this.query.category(render.id) === "occurrence" &&
					(render as SemanticOccurrence).kind === "shopify.render-site"
				) {
					renderById.set(render.id, render as SemanticOccurrence);
				}
			}
		}
		const renders = [...renderById.values()];
		const sourceBindingResult = this.#sourceBindingOccurrences(
			definitions,
			subject.symbol,
		);
		const sourceBindings = sourceBindingResult.items;
		const records: SemanticIndexedRecord[] = [
			file,
			...definitions,
			...sourceBindings,
			...argumentSites,
			...renders,
			...definitions.flatMap((definition) => this.#relatedRecords(definition)),
			...sourceBindings.flatMap((binding) => this.#relatedRecords(binding)),
			...renders.flatMap((render) => this.#relatedRecords(render)),
		];
		const canonicalSubject = {
			symbol: subject.symbol,
			kind: "binding",
			scope,
		} as const;
		if (facet === "summary") {
			return this.#response({
				status: "found",
				subject: canonicalSubject,
				facet,
				answer: {
					summary: {
						symbol: subject.symbol,
						kind: "binding",
						path: scope.path,
						definitions: definitions.length,
						sourceBindings: sourceBindings.length,
						...(sourceBindingResult.truncated
							? { sourceBindingsTruncated: true }
							: {}),
						renderArguments: renders.length,
					},
				},
				completeness: this.#completeness(requirements, records, context),
			});
		}
		if (facet === "lineage" || facet === "usages") {
			const definitionItems = definitions.map((definition) => ({
				...this.#projectOccurrence(definition, context),
				role: "definition" as const,
			}));
			const sourceBindingItems = sourceBindings.map((binding) => ({
				...this.#projectOccurrence(binding, context),
				role: "source" as const,
			}));
			const renderItems = renders.map((render) =>
				this.#projectRender(
					render,
					context,
					this.query.outgoing(render.id, "shopify.invokes")[0],
				),
			);
			const items =
				facet === "lineage"
					? sortItems([
							...definitionItems,
							...sourceBindingItems,
							...renderItems,
						])
					: sortItems(renderItems);
			return this.#response({
				status: "found",
				subject: canonicalSubject,
				facet,
				answer: {
					summary: {
						symbol: subject.symbol,
						path: scope.path,
						definitions: definitions.length,
						sourceBindings: sourceBindings.length,
						...(sourceBindingResult.truncated
							? { sourceBindingsTruncated: true }
							: {}),
						renderArguments: renders.length,
					},
					groups: groupItems(items, items),
				},
				completeness: this.#completeness(requirements, records, context),
				page: { total: items.length, returned: items.length },
			});
		}
		return this.#unsupported(subject, facet);
	}

	#inspectFile(
		subject: Extract<SemanticInspectSubject, { type: "file" }>,
		facet: InspectFacet,
		context: ProjectionContext,
		offset: number,
		limit: number,
		cursorShape: unknown,
	): SemanticInspectResponse {
		const file = this.query
			.findByPath(subject.path)
			.find((entity) => entity.kind === "shopify.source-file");
		if (!file)
			return this.#missing(
				subject,
				this.#fileExistenceRequirements(subject.path),
				context,
			);
		const owned = this.query.ownedBy(file.id);
		const occurrences = owned.filter(
			(record): record is SemanticOccurrence =>
				this.query.category(record.id) === "occurrence",
		);
		if (facet === "summary") {
			const dependencies = this.#dependenciesForFile(file, context);
			const dependents = this.#dependentsForFile(file, context);
			return this.#response({
				status: "found",
				subject: { type: "file", path: subject.path },
				facet,
				answer: {
					summary: {
						path: subject.path,
						role: String(file.attributes.role),
						occurrences: occurrenceCounts(occurrences),
						dependencies: dependencies.items.length,
						dependents: dependents.items.length,
					},
				},
				completeness: this.#completeness(
					this.#pathRequirements(subject.path),
					[file, ...dependencies.records, ...dependents.records],
					context,
				),
			});
		}
		if (facet === "dependencies" || facet === "dependents") {
			const result =
				facet === "dependencies"
					? this.#dependenciesForFile(file, context)
					: this.#dependentsForFile(file, context);
			const page = this.#paginate(result.items, offset, limit, cursorShape);
			return this.#response({
				status: "found",
				subject: { type: "file", path: subject.path },
				facet,
				answer: { groups: groupItems(result.items, page.items) },
				completeness: this.#completeness(
					facet === "dependencies"
						? [
								{ family: "shopify.renders", path: subject.path },
								{ family: "shopify.snippets", globalKind: "shopify.snippet" },
							]
						: this.#globalRenderRequirements(),
					result.records,
					context,
				),
				page: page.page,
			});
		}
		if (facet === "occurrences") {
			const items = sortItems(
				occurrences.map((occurrence) =>
					this.#projectOccurrence(occurrence, context),
				),
			);
			const page = this.#paginate(items, offset, limit, cursorShape);
			return this.#response({
				status: "found",
				subject: { type: "file", path: subject.path },
				facet,
				answer: { groups: groupItems(items, page.items) },
				completeness: this.#completeness(
					this.#pathRequirements(subject.path),
					[file, ...occurrences],
					context,
				),
				page: page.page,
			});
		}
		return this.#unsupported(subject, facet);
	}

	#inspectSnippet(
		subject: Extract<SemanticInspectSubject, { type: "snippet" }>,
		facet: InspectFacet,
		context: ProjectionContext,
		offset: number,
		limit: number,
		cursorShape: unknown,
	): SemanticInspectResponse {
		const snippets = this.query.findByIdentity("shopify.snippet", {
			handle: normalizeSnippetHandle(subject.handle),
		});
		const requirements: CoverageRequirement[] = [
			{ family: "shopify.snippets", globalKind: "shopify.snippet" },
		];
		if (snippets.length === 0)
			return this.#missing(subject, requirements, context);
		if (snippets.length > 1) {
			return this.#response({
				status: "ambiguous",
				subject: { type: "snippet", handle: subject.handle },
				facet,
				candidates: snippets.map((snippet) =>
					this.#projectSnippet(snippet, context),
				),
				completeness: this.#completeness(requirements, snippets, context),
			});
		}
		const snippet = snippets[0];
		if (!snippet) return this.#missing(subject, requirements, context);
		const sourceFile = this.query
			.findByPath(String(snippet.attributes.path))
			.find((entity) => entity.kind === "shopify.source-file");
		const dependencies = sourceFile
			? this.#dependenciesForFile(sourceFile, context)
			: { items: [], records: [] };
		const usages = this.#usagesForSnippet(snippet, context);
		if (facet === "summary") {
			return this.#response({
				status: "found",
				subject: { type: "snippet", handle: subject.handle },
				facet,
				answer: {
					summary: {
						handle: String(snippet.identity.components.handle),
						path: String(snippet.attributes.path),
						defined: snippet.attributes.defined === true,
						dependencies: dependencies.items.length,
						usages: usages.items.length,
					},
				},
				completeness: this.#completeness(
					[
						...requirements,
						...(sourceFile
							? [{ family: "shopify.renders", path: sourceFile.path }]
							: []),
						...this.#globalRenderRequirements(),
					],
					[snippet, ...dependencies.records, ...usages.records],
					context,
				),
			});
		}
		if (
			facet === "dependencies" ||
			facet === "dependents" ||
			facet === "usages"
		) {
			const result = facet === "dependencies" ? dependencies : usages;
			const page = this.#paginate(result.items, offset, limit, cursorShape);
			return this.#response({
				status: "found",
				subject: { type: "snippet", handle: subject.handle },
				facet,
				answer: { groups: groupItems(result.items, page.items) },
				completeness: this.#completeness(
					facet === "dependencies" && sourceFile
						? [
								{ family: "shopify.renders", path: sourceFile.path },
								{ family: "shopify.value-flow", path: sourceFile.path },
								...requirements,
							]
						: [...requirements, ...this.#globalRenderRequirements()],
					result.records,
					context,
				),
				page: page.page,
			});
		}
		return this.#unsupported(subject, facet);
	}

	#inspectOccurrenceSubject(
		subject: Extract<SemanticInspectSubject, { type: "render" | "expression" }>,
		kind: "shopify.render-site" | "shopify.expression-site",
		facet: InspectFacet,
		context: ProjectionContext,
	): SemanticInspectResponse {
		if (facet !== "summary") return this.#unsupported(subject, facet);
		const matches = this.query
			.evidenceAt(subject.path, subject.offset)
			.filter(
				(record): record is SemanticOccurrence =>
					this.query.category(record.id) === "occurrence",
			)
			.filter((record) => record.kind === kind);
		const family =
			kind === "shopify.render-site" ? "shopify.renders" : "shopify.reads";
		const requirements = [
			{ family, path: subject.path },
			{ family: "shopify.value-flow", path: subject.path },
		];
		if (matches.length === 0)
			return this.#missing(subject, requirements, context);
		if (matches.length > 1) {
			return this.#response({
				status: "ambiguous",
				subject: subjectRecord(subject),
				facet,
				candidates: matches.map((match) =>
					this.#projectOccurrence(match, context),
				),
				completeness: this.#completeness(requirements, matches, context),
			});
		}
		const occurrence = matches[0];
		if (!occurrence) return this.#missing(subject, requirements, context);
		const item = this.#projectOccurrence(occurrence, context);
		const related = this.#relatedRecords(occurrence);
		return this.#response({
			status: "found",
			subject: subjectRecord(subject),
			facet,
			answer: {
				summary: itemToSummary(item),
				groups: groupItems([item], [item]),
			},
			completeness: this.#completeness(
				requirements,
				[occurrence, ...related],
				context,
			),
		});
	}

	#dependenciesForFile(
		file: SemanticEntity,
		context: ProjectionContext,
	): { items: InspectItem[]; records: SemanticIndexedRecord[] } {
		const renderSites = this.query
			.ownedBy(file.id)
			.filter(
				(record): record is SemanticOccurrence =>
					this.query.category(record.id) === "occurrence",
			)
			.filter((record) => record.kind === "shopify.render-site");
		const items: InspectItem[] = [];
		const records: SemanticIndexedRecord[] = [...renderSites];
		const targets = new Map<
			string,
			{
				entity: SemanticEntity;
				assertion: SemanticRelation["assertion"];
				resolution: "repository-exact" | "literal-convention" | "not-found";
			}
		>();
		for (const render of renderSites) {
			for (const relation of this.query.outgoing(
				render.id,
				"shopify.invokes",
			)) {
				const target = this.query.record(relation.to);
				if (!target || this.query.category(target.id) !== "entity") continue;
				targets.set(target.id, {
					entity: target as SemanticEntity,
					assertion: relation.assertion,
					resolution: String(relation.attributes.resolution) as
						| "repository-exact"
						| "literal-convention"
						| "not-found",
				});
				items.push(this.#projectRender(render, context, relation));
				records.push(relation, target, ...this.#relatedRecords(render));
			}
		}
		for (const { entity, assertion, resolution } of targets.values()) {
			items.push(this.#projectSnippet(entity, context, assertion, resolution));
		}
		return { items: sortItems(items), records };
	}

	#dependentsForFile(
		file: SemanticEntity,
		context: ProjectionContext,
	): { items: InspectItem[]; records: SemanticIndexedRecord[] } {
		const snippet = this.query
			.findByPath(file.path ?? "")
			.find((entity) => entity.kind === "shopify.snippet");
		return snippet
			? this.#usagesForSnippet(snippet, context)
			: { items: [], records: [] };
	}

	#usagesForSnippet(
		snippet: SemanticEntity,
		context: ProjectionContext,
	): { items: InspectItem[]; records: SemanticIndexedRecord[] } {
		const relations = this.query.incoming(snippet.id, "shopify.invokes");
		const items: InspectItem[] = [];
		const records: SemanticIndexedRecord[] = [...relations, snippet];
		for (const relation of relations) {
			const render = this.query.record(relation.from);
			if (!render || this.query.category(render.id) !== "occurrence") continue;
			items.push(
				this.#projectRender(render as SemanticOccurrence, context, relation),
			);
			records.push(
				render,
				...this.#relatedRecords(render as SemanticOccurrence),
			);
		}
		return { items: sortItems(items), records };
	}

	#projectRecord(
		record: SemanticIndexedRecord,
		context: ProjectionContext,
	): InspectItem {
		const category = this.query.category(record.id);
		if (category === "entity")
			return this.#projectEntity(record as SemanticEntity, context);
		if (category === "occurrence")
			return this.#projectOccurrence(record as SemanticOccurrence, context);
		throw new SemanticInspectInputError(
			"Search returned a non-subject semantic record",
		);
	}

	#projectEntity(
		entity: SemanticEntity,
		context: ProjectionContext,
	): InspectItem {
		if (entity.kind === "shopify.source-file") {
			return {
				type: "file",
				path: entity.path ?? String(entity.identity.components.path),
				role: String(entity.attributes.role),
				...this.#itemAssertion(entity.assertion, context),
			};
		}
		if (entity.kind === "shopify.snippet")
			return this.#projectSnippet(entity, context);
		throw new SemanticInspectInputError(
			`Unsupported public entity kind ${entity.kind}`,
		);
	}

	#projectSnippet(
		entity: SemanticEntity,
		context: ProjectionContext,
		assertion = entity.assertion,
		resolution?: "repository-exact" | "literal-convention" | "not-found",
	): InspectItem {
		const path = String(entity.attributes.path);
		const definingEvidence = assertion.evidence.filter(
			(anchor) => anchor.path === path,
		);
		const publicAssertion = {
			...assertion,
			evidence:
				entity.attributes.defined === true && definingEvidence.length > 0
					? definingEvidence
					: assertion.evidence,
		};
		return {
			type: "snippet",
			handle: String(entity.identity.components.handle),
			path,
			defined: entity.attributes.defined === true,
			...(resolution ? { resolution } : {}),
			...this.#itemAssertion(publicAssertion, context),
		};
	}

	#projectOccurrence(
		occurrence: SemanticOccurrence,
		context: ProjectionContext,
	): InspectItem {
		if (occurrence.kind === "shopify.render-site") {
			const relation = this.query.outgoing(occurrence.id, "shopify.invokes")[0];
			return this.#projectRender(occurrence, context, relation);
		}
		const location = occurrence.assertion.evidence[0];
		if (occurrence.kind === "shopify.binding-site") {
			const bindingValue = this.query
				.ownedBy(occurrence.id)
				.find(
					(record) =>
						this.query.category(record.id) === "value" &&
						"slot" in record &&
						record.slot === "shopify.binding-value",
				);
			return {
				type: "binding",
				symbol: String(occurrence.attributes.name),
				path: location?.path ?? "",
				offset: location?.range.start ?? 0,
				binding: String(occurrence.attributes.binding),
				scope: {
					start: Number(occurrence.attributes.scopeStart),
					end: Number(occurrence.attributes.scopeEnd),
				},
				...(bindingValue && "slot" in bindingValue
					? {
							value: this.#projectValue(bindingValue as SemanticValue, context),
						}
					: {}),
				...this.#itemAssertion(occurrence.assertion, context),
			};
		}
		if (occurrence.kind === "shopify.expression-site") {
			const readValue = this.query
				.ownedBy(occurrence.id)
				.find(
					(record) =>
						this.query.category(record.id) === "value" &&
						"slot" in record &&
						record.slot === "shopify.read-value",
				);
			const publicAssertion =
				readValue && "assertion" in readValue
					? {
							...occurrence.assertion,
							availability: readValue.assertion.availability,
							boundaryIds: readValue.assertion.boundaryIds,
						}
					: occurrence.assertion;
			return {
				type: "expression",
				path: location?.path ?? "",
				offset: location?.range.start ?? 0,
				expression: String(occurrence.attributes.expression),
				context: String(occurrence.attributes.context),
				root: String(occurrence.attributes.root),
				segments: Array.isArray(occurrence.attributes.segments)
					? occurrence.attributes.segments
					: [],
				...(readValue && "slot" in readValue
					? {
							value: this.#projectValue(readValue as SemanticValue, context),
						}
					: {}),
				...this.#itemAssertion(publicAssertion, context),
			};
		}
		return {
			type: "occurrence",
			kind: publicOccurrenceKind(occurrence.kind),
			path: location?.path ?? "",
			offset: location?.range.start ?? 0,
			attributes: occurrence.attributes,
			...this.#itemAssertion(occurrence.assertion, context),
		};
	}

	#projectRender(
		render: SemanticOccurrence,
		context: ProjectionContext,
		relation?: SemanticRelation,
	): InspectItem {
		const location = render.assertion.evidence[0];
		const argumentRelations = this.query.outgoing(
			render.id,
			"shopify.passes-argument",
		);
		const args = argumentRelations.flatMap((argumentRelation) => {
			const argument = this.query.record(argumentRelation.to);
			if (!argument || this.query.category(argument.id) !== "occurrence")
				return [];
			const semanticArgument = argument as SemanticOccurrence;
			const attributes = semanticArgument.attributes;
			const argumentEvidence = this.#evidence(
				semanticArgument.assertion.evidence,
				context,
			);
			const argumentValue = this.query
				.ownedBy(semanticArgument.id)
				.find(
					(record) =>
						this.query.category(record.id) === "value" &&
						"slot" in record &&
						record.slot === "shopify.render-argument-value",
				);
			return [
				{
					kind: String(attributes.argumentKind),
					...(typeof attributes.name === "string"
						? { name: attributes.name }
						: {}),
					expression: String(attributes.expression),
					availability:
						argumentValue && "assertion" in argumentValue
							? argumentValue.assertion.availability
							: semanticArgument.assertion.availability,
					...(argumentEvidence.length > 0
						? { evidence: argumentEvidence }
						: {}),
					...(argumentValue && "slot" in argumentValue
						? {
								value: this.#projectValue(
									argumentValue as SemanticValue,
									context,
								),
							}
						: {}),
				},
			];
		});
		const guards = (relation?.guards ?? []).flatMap((predicateId) => {
			const predicate = this.query.record(predicateId);
			if (!predicate || this.query.category(predicate.id) !== "predicate")
				return [];
			const semanticPredicate = predicate as SemanticPredicate;
			const predicateEvidence = this.#evidence(
				semanticPredicate.assertion.evidence,
				context,
			);
			return [
				{
					operator: semanticPredicate.operator,
					expression: String(semanticPredicate.attributes.expression),
					availability: semanticPredicate.assertion.availability,
					...(predicateEvidence.length > 0
						? { evidence: predicateEvidence }
						: {}),
				},
			];
		});
		const targetValue = this.query
			.ownedBy(render.id)
			.find(
				(record) =>
					this.query.category(record.id) === "value" &&
					"slot" in record &&
					record.slot === "shopify.render-target",
			);
		const publicAssertion = relation
			? {
					...relation.assertion,
					evidence: relation.assertion.evidence.filter(
						(anchor) => anchor.path === location?.path,
					),
				}
			: targetValue && "assertion" in targetValue
				? {
						...render.assertion,
						availability: targetValue.assertion.availability,
						boundaryIds: targetValue.assertion.boundaryIds,
					}
				: render.assertion;
		return {
			type: "render",
			path: location?.path ?? "",
			offset: location?.range.start ?? 0,
			target: String(render.attributes.target),
			targetKind: String(render.attributes.targetKind) as "literal" | "dynamic",
			...(relation
				? {
						resolution: String(relation.attributes.resolution) as
							| "repository-exact"
							| "literal-convention"
							| "not-found",
					}
				: {}),
			...(args.length > 0 ? { arguments: args } : {}),
			...(guards.length > 0 ? { guards } : {}),
			...this.#itemAssertion(publicAssertion, context),
		};
	}

	#projectValue(
		value: SemanticValue,
		context: ProjectionContext,
	): InspectValue {
		const derivedFrom: NonNullable<InspectValue["derivedFrom"]>[number][] = [];
		const queue = value.sourceValueIds.map((id) => ({ id, depth: 1 }));
		const seen = new Set<string>();
		let lineageTruncated = false;
		while (queue.length > 0 && derivedFrom.length < MAX_VALUE_FLOW_SOURCES) {
			const current = queue.shift();
			if (!current || seen.has(current.id)) continue;
			seen.add(current.id);
			const source = this.query.record(current.id);
			if (
				!source ||
				this.query.category(source.id) !== "value" ||
				!("slot" in source)
			)
				continue;
			const semanticValue = source as SemanticValue;
			const evidence = this.#evidence(
				semanticValue.assertion.evidence,
				context,
			);
			derivedFrom.push({
				role: publicValueRole(semanticValue.slot),
				...(semanticValue.expression !== undefined
					? { expression: semanticValue.expression }
					: {}),
				...(semanticValue.resolved !== undefined
					? { resolved: semanticValue.resolved }
					: {}),
				availability: semanticValue.assertion.availability,
				...(evidence.length > 0 ? { evidence } : {}),
			});
			if (current.depth < MAX_VALUE_FLOW_DEPTH) {
				for (const id of semanticValue.sourceValueIds) {
					queue.push({ id, depth: current.depth + 1 });
				}
			} else if (semanticValue.sourceValueIds.length > 0) {
				lineageTruncated = true;
			}
		}
		if (queue.length > 0) lineageTruncated = true;
		return {
			representation: value.representation,
			authority: value.authority,
			availability: value.assertion.availability,
			...(value.expression !== undefined
				? { expression: value.expression }
				: {}),
			...(value.resolved !== undefined ? { resolved: value.resolved } : {}),
			...(lineageTruncated ? { lineageTruncated: true as const } : {}),
			...(derivedFrom.length > 0 ? { derivedFrom } : {}),
		};
	}

	#itemAssertion(
		assertion: AssertionMetadata,
		context: ProjectionContext,
	): InspectItemAssertion {
		const evidence = this.#evidence(assertion.evidence, context);
		return {
			certainty: assertion.epistemic.status,
			availability: assertion.availability,
			...(evidence.length > 0 ? { evidence } : {}),
		};
	}

	#evidence(
		anchors: readonly SourceAnchor[],
		context: ProjectionContext,
	): InspectLocation[] {
		if (context.evidence === "none") return [];
		return anchors.slice(0, MAX_EVIDENCE_PER_ITEM).map((anchor) => {
			const source = this.options.source?.(anchor.path);
			const position = source
				? sourcePosition(source, anchor.range.start)
				: undefined;
			let excerpt: string | undefined;
			if (context.evidence === "excerpt") {
				if (source === undefined) context.missingExcerpt = true;
				else
					excerpt = source
						.slice(anchor.range.start, anchor.range.end)
						.slice(0, MAX_EXCERPT_LENGTH);
			}
			return {
				path: anchor.path,
				start: anchor.range.start,
				end: anchor.range.end,
				...(position ?? {}),
				...(excerpt !== undefined ? { excerpt } : {}),
			};
		});
	}

	#sourceBindingOccurrences(
		definitions: readonly SemanticOccurrence[],
		symbol: string,
	): { items: SemanticOccurrence[]; truncated: boolean } {
		const queue = definitions.flatMap((definition) =>
			this.query
				.ownedBy(definition.id)
				.filter(
					(record): record is SemanticValue =>
						this.query.category(record.id) === "value" &&
						"sourceValueIds" in record,
				)
				.flatMap((value) => value.sourceValueIds),
		);
		const seen = new Set<string>();
		const bindings = new Map<string, SemanticOccurrence>();
		const maxVisitedValues = MAX_VALUE_FLOW_SOURCES * 8;
		while (queue.length > 0 && seen.size < maxVisitedValues) {
			const id = queue.shift();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const record = this.query.record(id);
			if (
				!record ||
				this.query.category(record.id) !== "value" ||
				!("sourceValueIds" in record)
			)
				continue;
			const value = record as SemanticValue;
			const owner = this.query.record(value.ownerId);
			if (
				owner &&
				this.query.category(owner.id) === "occurrence" &&
				(owner as SemanticOccurrence).kind === "shopify.binding-site" &&
				(owner as SemanticOccurrence).attributes.name !== symbol
			) {
				bindings.set(owner.id, owner as SemanticOccurrence);
			}
			for (const sourceId of value.sourceValueIds) queue.push(sourceId);
		}
		return {
			items: [...bindings.values()].sort((left, right) => {
				const leftAnchor = left.assertion.evidence[0];
				const rightAnchor = right.assertion.evidence[0];
				return (
					(leftAnchor?.path ?? "").localeCompare(rightAnchor?.path ?? "") ||
					(leftAnchor?.range.start ?? 0) - (rightAnchor?.range.start ?? 0)
				);
			}),
			truncated: queue.length > 0,
		};
	}

	#relatedRecords(occurrence: SemanticOccurrence): SemanticIndexedRecord[] {
		return [
			...this.query.ownedBy(occurrence.id),
			...this.query.outgoing(occurrence.id),
			...this.query.incoming(occurrence.id),
		];
	}

	#pathRequirements(path: string): CoverageRequirement[] {
		return [
			{ family: "shopify.source-files", path },
			{ family: "shopify.reads", path },
			{ family: "shopify.bindings", path },
			{ family: "shopify.filters", path },
			{ family: "shopify.value-flow", path },
			{ family: "shopify.conditions", path },
			{ family: "shopify.renders", path },
			{ family: "shopify.schema-regions", path },
			{ family: "shopify.asset-references", path },
			{ family: "shopify.locale-references", path },
		];
	}

	#fileExistenceRequirements(path: string): CoverageRequirement[] {
		return path.startsWith("snippets/")
			? [{ family: "shopify.snippets", globalKind: "shopify.snippet" }]
			: [{ family: "shopify.source-files", globalKind: "shopify.source-file" }];
	}

	#globalRenderRequirements(): CoverageRequirement[] {
		const paths = this.query
			.findByKind("shopify.source-file")
			.filter(
				(record) =>
					this.query.category(record.id) === "entity" &&
					(record as SemanticEntity).attributes.language === "liquid",
			)
			.map((record) => (record as SemanticEntity).path)
			.filter((path): path is string => Boolean(path));
		return [
			{ family: "shopify.source-files", globalKind: "shopify.source-file" },
			...paths.flatMap((path) => [
				{ family: "shopify.renders", path },
				{ family: "shopify.value-flow", path },
			]),
		];
	}

	#discoveryRequirements(
		kinds: readonly InspectDiscoveryKind[],
	): CoverageRequirement[] {
		const requirements: CoverageRequirement[] = [
			{ family: "shopify.source-files", globalKind: "shopify.source-file" },
		];
		if (kinds.includes("snippet")) {
			requirements.push({
				family: "shopify.snippets",
				globalKind: "shopify.snippet",
			});
		}
		return requirements;
	}

	#completeness(
		requirements: readonly CoverageRequirement[],
		records: readonly SemanticIndexedRecord[],
		context: ProjectionContext,
	): InspectCompleteness {
		let status: InspectCompleteness["status"] = "complete";
		const families = [
			...new Set(
				requirements.map(({ family }) => publicCoverageFamily(family)),
			),
		].sort();
		const paths = [
			...new Set(requirements.flatMap(({ path }) => (path ? [path] : []))),
		].sort();
		const boundaryIds = new Set<string>();
		const reasons: Array<{ code: string; message: string }> = [];
		for (const requirement of requirements) {
			const coverage = this.#coverage(requirement);
			const complete = coverage.find(
				({ status: coverageStatus }) => coverageStatus === "complete",
			);
			if (complete) continue;
			if (coverage.length === 0) {
				status = worseCompleteness(status, "external-data-required");
				reasons.push({
					code: "COVERAGE_UNAVAILABLE",
					message: `No ${requirement.family} coverage proves this scope complete`,
				});
				continue;
			}
			for (const item of coverage) {
				status = worseCompleteness(status, coverageStatus(item.status));
				for (const boundaryId of item.boundaryIds) boundaryIds.add(boundaryId);
			}
		}
		for (const record of records) {
			if ("assertion" in record) {
				status = worseCompleteness(
					status,
					availabilityStatus(record.assertion.availability),
				);
				for (const boundaryId of record.assertion.boundaryIds)
					boundaryIds.add(boundaryId);
			}
			if (this.query.category(record.id) === "boundary")
				boundaryIds.add(record.id);
		}
		for (const boundaryId of boundaryIds) {
			const boundary = this.query.record(boundaryId);
			if (!boundary || this.query.category(boundary.id) !== "boundary")
				continue;
			const semanticBoundary = boundary as SemanticBoundary;
			status = worseCompleteness(status, boundaryStatus(semanticBoundary));
			reasons.push({
				code: semanticBoundary.kind,
				message: semanticBoundary.message,
			});
		}
		if (context.missingExcerpt) {
			status = worseCompleteness(status, "partial");
			reasons.push({
				code: "EVIDENCE_SOURCE_UNAVAILABLE",
				message:
					"Excerpt evidence was requested but source text was unavailable",
			});
		}
		const uniqueReasons = uniqueReasonList(reasons);
		return {
			status,
			scope: {
				...(paths.length > 0 ? { paths } : {}),
				families,
			},
			...(uniqueReasons.length > 0
				? {
						reasons: uniqueReasons.slice(0, MAX_COMPLETENESS_REASONS),
						...(uniqueReasons.length > MAX_COMPLETENESS_REASONS
							? {
									additionalReasons:
										uniqueReasons.length - MAX_COMPLETENESS_REASONS,
								}
							: {}),
					}
				: {}),
		};
	}

	#coverage(requirement: CoverageRequirement): SemanticCoverage[] {
		const coverage = this.query.coverageFor(
			requirement.family,
			requirement.path,
		);
		return requirement.globalKind
			? coverage.filter(
					(item) =>
						!item.scope.paths &&
						(item.scope.kinds as readonly string[] | undefined)?.includes(
							requirement.globalKind ?? "",
						),
				)
			: coverage;
	}

	#missing(
		subject: SemanticInspectSubject,
		requirements: readonly CoverageRequirement[],
		context: ProjectionContext,
	): SemanticInspectResponse {
		const completeness = this.#completeness(requirements, [], context);
		return this.#response({
			status: missingResponseStatus(completeness),
			subject: subjectRecord(subject),
			facet: "summary",
			completeness,
		});
	}

	#unsupported(
		subject: SemanticInspectSubject,
		facet: InspectFacet,
	): SemanticInspectResponse {
		return this.#response({
			status: "unsupported",
			subject: subjectRecord(subject),
			facet,
			completeness: {
				status: "unsupported",
				scope: { families: [] },
				reasons: [
					{
						code: "UNSUPPORTED_FACET",
						message: `Facet ${facet} is not supported for ${subjectKind(subject)}`,
					},
				],
			},
		});
	}

	#paginate(
		items: readonly InspectItem[],
		offset: number,
		limit: number,
		cursorShape: unknown,
	): InspectionPage {
		const pageItems = items.slice(offset, offset + limit);
		return {
			items: pageItems,
			page: {
				total: items.length,
				returned: pageItems.length,
				...(offset + pageItems.length < items.length
					? { nextCursor: this.#cursor(offset + pageItems.length, cursorShape) }
					: {}),
			},
		};
	}

	#cursor(offset: number, shape: unknown): string {
		return Buffer.from(
			JSON.stringify({
				v: 1,
				r: this.query.snapshot.revision.id,
				p: this.query.snapshot.revision.repositoryFingerprint,
				q: requestFingerprint(shape),
				o: offset,
			}),
		).toString("base64url");
	}

	#cursorOffset(cursor: string | undefined, shape: unknown): number {
		if (!cursor) return 0;
		let parsed: unknown;
		try {
			parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		} catch {
			throw new SemanticInspectInputError("Invalid inspect cursor");
		}
		if (!parsed || typeof parsed !== "object") {
			throw new SemanticInspectInputError("Invalid inspect cursor");
		}
		const value = parsed as Record<string, unknown>;
		if (
			value.v !== 1 ||
			value.r !== this.query.snapshot.revision.id ||
			value.p !== this.query.snapshot.revision.repositoryFingerprint ||
			value.q !== requestFingerprint(shape) ||
			!Number.isSafeInteger(value.o) ||
			Number(value.o) < 0
		) {
			throw new SemanticInspectInputError("Stale or mismatched inspect cursor");
		}
		return Number(value.o);
	}

	#response(
		response: Omit<SemanticInspectResponse, "contractVersion" | "revision">,
	): SemanticInspectResponse {
		return {
			contractVersion: SEMANTIC_INSPECT_CONTRACT_VERSION,
			revision: {
				id: this.query.snapshot.revision.id,
				repositoryFingerprint:
					this.query.snapshot.revision.repositoryFingerprint,
			},
			...response,
		};
	}
}

function publicKindToSemanticKinds(kind: InspectDiscoveryKind): string[] {
	return kind === "file" ? ["shopify.source-file"] : ["shopify.snippet"];
}

function publicOccurrenceKind(kind: string): string {
	const names: Readonly<Record<string, string>> = {
		"shopify.expression-site": "expression",
		"shopify.binding-site": "binding",
		"shopify.filter-site": "filter",
		"shopify.condition-site": "condition",
		"shopify.render-site": "render",
		"shopify.render-argument-site": "renderArgument",
		"shopify.schema-region": "schema",
		"shopify.asset-reference-site": "assetReference",
		"shopify.locale-reference-site": "localeReference",
	};
	return names[kind] ?? "other";
}

function publicValueRole(slot: string): string {
	const names: Readonly<Record<string, string>> = {
		"shopify.read-value": "read",
		"shopify.binding-value": "binding",
		"shopify.filter-input": "filterInput",
		"shopify.filter-argument": "filterArgument",
		"shopify.filter-result": "filterResult",
		"shopify.render-target": "renderTarget",
		"shopify.render-argument-value": "renderArgument",
		"shopify.condition-operand": "conditionOperand",
	};
	return names[slot] ?? "source";
}

function publicCoverageFamily(family: string): string {
	return family.startsWith("shopify.")
		? family.slice("shopify.".length)
		: family;
}

function subjectRecord(
	subject: SemanticInspectSubject,
): Readonly<Record<string, JsonValue>> {
	return { ...subject };
}

function subjectKind(subject: SemanticInspectSubject): string {
	return "symbol" in subject ? (subject.kind ?? "symbol") : subject.type;
}

function normalizeSnippetHandle(handle: string): string {
	return handle.replace(/^snippets\//u, "").replace(/\.liquid$/u, "");
}

function occurrenceCounts(
	occurrences: readonly SemanticOccurrence[],
): Readonly<Record<string, JsonValue>> {
	const counts: Record<string, number> = {};
	for (const occurrence of occurrences) {
		const kind = publicOccurrenceKind(occurrence.kind);
		counts[kind] = (counts[kind] ?? 0) + 1;
	}
	return Object.fromEntries(
		Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function itemToSummary(item: InspectItem): Readonly<Record<string, JsonValue>> {
	const {
		evidence: _evidence,
		certainty: _certainty,
		availability: _availability,
		type: _type,
		...summary
	} = item;
	return summary as Readonly<Record<string, JsonValue>>;
}

function groupItems(
	allItems: readonly InspectItem[],
	pageItems: readonly InspectItem[],
	providedTotals?: ReadonlyMap<InspectItem["type"], number>,
): InspectGroup[] {
	const totals = new Map<InspectItem["type"], number>(providedTotals);
	if (!providedTotals) {
		for (const item of allItems)
			totals.set(item.type, (totals.get(item.type) ?? 0) + 1);
	}
	const groups = new Map<InspectItem["type"], InspectItem[]>();
	for (const item of pageItems) {
		const items = groups.get(item.type) ?? [];
		items.push(item);
		groups.set(item.type, items);
	}
	return [...groups.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([kind, items]) => ({
			kind,
			total: totals.get(kind) ?? items.length,
			items,
		}));
}

function sortItems(items: readonly InspectItem[]): InspectItem[] {
	return [...items].sort((left, right) =>
		JSON.stringify(left).localeCompare(JSON.stringify(right)),
	);
}

function boundedLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_LIMIT;
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new SemanticInspectInputError("limit must be a positive integer");
	}
	return Math.min(MAX_LIMIT, limit);
}

function requestFingerprint(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function sourcePosition(
	source: string,
	offset: number,
): { line: number; character: number } {
	let line = 1;
	let lineStart = 0;
	for (let index = 0; index < Math.min(offset, source.length); index += 1) {
		if (source.charCodeAt(index) === 10) {
			line += 1;
			lineStart = index + 1;
		}
	}
	return { line, character: offset - lineStart + 1 };
}

function availabilityStatus(
	availability: AssertionMetadata["availability"],
): InspectCompleteness["status"] {
	return availability === "static" ? "complete" : availability;
}

function coverageStatus(
	status: SemanticCoverage["status"],
): InspectCompleteness["status"] {
	return status;
}

function boundaryStatus(
	boundary: SemanticBoundary,
): InspectCompleteness["status"] {
	if (boundary.kind === "unresolved-reference") return "complete";
	if (
		boundary.kind === "shopify-runtime" ||
		boundary.kind === "browser-runtime" ||
		boundary.kind === "runtime-condition" ||
		boundary.kind === "dynamic-target"
	)
		return "runtime-dependent";
	if (
		boundary.kind === "external-data" ||
		boundary.kind === "merchant-configuration"
	)
		return "external-data-required";
	if (boundary.kind === "budget" || boundary.kind === "ambiguous-join")
		return "partial";
	return "unsupported";
}

function worseCompleteness(
	left: InspectCompleteness["status"],
	right: InspectCompleteness["status"],
): InspectCompleteness["status"] {
	const rank: Record<InspectCompleteness["status"], number> = {
		complete: 0,
		partial: 1,
		"runtime-dependent": 2,
		"external-data-required": 3,
		unsupported: 4,
	};
	return rank[left] >= rank[right] ? left : right;
}

function missingResponseStatus(
	completeness: InspectCompleteness,
): SemanticInspectResponse["status"] {
	return completeness.status === "complete"
		? "not-found"
		: completeness.status === "unsupported"
			? "unsupported"
			: "external-data-required";
}

function uniqueReasonList(
	reasons: readonly { code: string; message: string }[],
): Array<{ code: string; message: string }> {
	const unique = new Map<string, { code: string; message: string }>();
	for (const reason of reasons)
		unique.set(`${reason.code}\u0000${reason.message}`, reason);
	return [...unique.values()].sort(
		(left, right) =>
			left.code.localeCompare(right.code) ||
			left.message.localeCompare(right.message),
	);
}
