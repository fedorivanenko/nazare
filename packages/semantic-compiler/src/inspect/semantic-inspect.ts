import { createHash } from "node:crypto";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticEntity,
	SemanticOccurrence,
	SemanticPredicate,
	SemanticRelation,
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
	InspectEvidenceMode,
	InspectFacet,
	InspectGroup,
	InspectItem,
	InspectItemAssertion,
	InspectLocation,
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
		const kinds = request.kinds ?? ["file", "snippet", "render", "expression"];
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
		const requirements = [{ family, path: subject.path }];
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
		for (const render of renderSites) {
			for (const relation of this.query.outgoing(
				render.id,
				"shopify.invokes",
			)) {
				const target = this.query.record(relation.to);
				if (!target || this.query.category(target.id) !== "entity") continue;
				items.push(
					this.#projectSnippet(
						target as SemanticEntity,
						context,
						relation.assertion,
						String(relation.attributes.resolution) as
							| "repository-exact"
							| "literal-convention"
							| "not-found",
					),
				);
				records.push(relation, target);
			}
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
		return {
			type: "snippet",
			handle: String(entity.identity.components.handle),
			path: String(entity.attributes.path),
			defined: entity.attributes.defined === true,
			...(resolution ? { resolution } : {}),
			...this.#itemAssertion(assertion, context),
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
			const attributes = (argument as SemanticOccurrence).attributes;
			return [
				{
					kind: String(attributes.argumentKind),
					...(typeof attributes.name === "string"
						? { name: attributes.name }
						: {}),
					expression: String(attributes.expression),
				},
			];
		});
		const guards = (relation?.guards ?? []).flatMap((predicateId) => {
			const predicate = this.query.record(predicateId);
			if (!predicate || this.query.category(predicate.id) !== "predicate")
				return [];
			const semanticPredicate = predicate as SemanticPredicate;
			return [
				{
					operator: semanticPredicate.operator,
					expression: String(semanticPredicate.attributes.expression),
					availability: semanticPredicate.assertion.availability,
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
			? relation.assertion
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
			.filter((record) => this.query.category(record.id) === "entity")
			.map((record) => (record as SemanticEntity).path)
			.filter((path): path is string => Boolean(path));
		return [
			{ family: "shopify.source-files", globalKind: "shopify.source-file" },
			...paths.map((path) => ({ family: "shopify.renders", path })),
		];
	}

	#discoveryRequirements(
		kinds: readonly ("file" | "snippet" | "render" | "expression")[],
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
		const paths = this.query
			.findByKind("shopify.source-file")
			.filter((record) => this.query.category(record.id) === "entity")
			.map((record) => (record as SemanticEntity).path)
			.filter((path): path is string => Boolean(path));
		if (kinds.includes("render")) {
			for (const path of paths)
				requirements.push({ family: "shopify.renders", path });
		}
		if (kinds.includes("expression")) {
			for (const path of paths)
				requirements.push({ family: "shopify.reads", path });
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
						message: `Facet ${facet} is not supported for ${subject.type}`,
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

function publicKindToSemanticKinds(
	kind: "file" | "snippet" | "render" | "expression",
): string[] {
	return kind === "file"
		? ["shopify.source-file"]
		: kind === "snippet"
			? ["shopify.snippet"]
			: kind === "render"
				? ["shopify.render-site"]
				: ["shopify.expression-site"];
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
