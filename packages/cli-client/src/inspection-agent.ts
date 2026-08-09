import type {
	InspectionPublicGraph,
	PublicEntity,
	PublicRelation,
} from "./inspection-public-contract.js";
import { inspectionPublicGraph } from "./inspection-public-graph.js";
import type { ShopifyQuerySession } from "./shopify-query-session.js";

export const INSPECTION_AGENT_CONTRACT_VERSION = 3 as const;

const QUESTIONS = [
	"summary",
	"dependencies",
	"dependents",
	"usages",
	"impact",
	"diagnostics",
] as const;
const EVIDENCE_MODES = ["none", "location", "excerpt"] as const;
const BEHAVIOR_KINDS = [
	"domClass",
	"domId",
	"domAttribute",
	"customElement",
	"customEvent",
	"customProperty",
	"other",
] as const;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_LOCATIONS_PER_ITEM = 3;
const MAX_EXCERPT_LENGTH = 200;
const INSPECT_ARGUMENT_KEYS = new Set([
	"subject",
	"question",
	"evidence",
	"limit",
	"cursor",
]);

type Question = (typeof QUESTIONS)[number];
type EvidenceMode = (typeof EVIDENCE_MODES)[number];
type BehaviorKind = (typeof BEHAVIOR_KINDS)[number];

type InspectSubject =
	| { type: "project" }
	| { type: "file"; path: string }
	| { type: "behavior"; name: string; kind?: BehaviorKind }
	| {
			type: "metafield";
			owner: string;
			namespace: string;
			key: string;
	  }
	| { type: "symbol"; name: string; path?: string }
	| { type: "diagnostic"; code?: string; path?: string };

type Position = { line: number; character: number };
type Location = {
	path: string;
	start?: Position;
	end?: Position;
	excerpt?: string;
};

type InspectionAnswer = {
	contractVersion: typeof INSPECTION_AGENT_CONTRACT_VERSION;
	revision: number;
	status: "found" | "notFound" | "ambiguous";
	subject: Record<string, unknown>;
	answer?: Record<string, unknown>;
	candidates?: readonly Record<string, unknown>[];
	completeness: {
		status: "complete" | "partial";
		reasons?: readonly { code: string; message: string }[];
		additionalReasons?: number;
	};
	page?: {
		total: number;
		returned: number;
		nextCursor?: string;
	};
};

export class InspectInputError extends Error {}

export async function inspectForAgent(
	session: ShopifyQuerySession,
	params: Record<string, unknown> | undefined,
): Promise<InspectionAnswer> {
	const unknownKey = Object.keys(params ?? {})
		.filter((key) => !INSPECT_ARGUMENT_KEYS.has(key))
		.sort()[0];
	if (unknownKey) {
		throw new InspectInputError(`Unknown tool argument: ${unknownKey}`);
	}
	const subject = parseSubject(params?.subject);
	const question = parseQuestion(params?.question, subject.type);
	const evidence = optionalEnum(params, "evidence", EVIDENCE_MODES, "location");
	const graph = await inspectionPublicGraph(session);
	switch (subject.type) {
		case "project":
			return inspectProject(graph, subject, question, params);
		case "file":
			return inspectFile(session, graph, subject, question, evidence, params);
		case "behavior":
			return inspectBehavior(
				session,
				graph,
				subject,
				question,
				evidence,
				params,
			);
		case "metafield":
			return inspectMetafield(
				session,
				graph,
				subject,
				question,
				evidence,
				params,
			);
		case "symbol":
			return inspectSymbol(session, graph, subject, question, evidence, params);
		case "diagnostic":
			return inspectDiagnostics(graph, subject, evidence, params);
	}
}

function inspectProject(
	graph: InspectionPublicGraph,
	subject: Extract<InspectSubject, { type: "project" }>,
	question: Question,
	params: Record<string, unknown> | undefined,
): InspectionAnswer {
	if (question === "diagnostics") {
		return diagnosticResponse(undefined, graph, subject, "none", params);
	}
	if (question !== "summary") {
		throw new InspectInputError(
			`Question ${question} is not supported for project subjects`,
		);
	}
	const project = graph.entities.find((entity) => entity.kind === "project");
	return response(graph, "found", subject, {
		summary: project?.attributes ?? {},
	});
}

async function inspectFile(
	session: ShopifyQuerySession,
	graph: InspectionPublicGraph,
	subject: Extract<InspectSubject, { type: "file" }>,
	question: Question,
	evidence: EvidenceMode,
	params: Record<string, unknown> | undefined,
): Promise<InspectionAnswer> {
	const entity = graph.entities.find(
		(candidate) => candidate.kind === "file" && candidate.path === subject.path,
	);
	if (!entity) return response(graph, "notFound", subject);
	const normalized = {
		type: "file",
		path: subject.path,
		kind: entity.subtype ?? "other",
	};
	if (question === "summary") {
		return response(graph, "found", normalized, {
			summary: {
				...(entity.roles?.length ? { roles: entity.roles } : {}),
				...(Array.isArray(entity.attributes?.classes)
					? { classes: entity.attributes.classes }
					: {}),
			},
		});
	}
	if (question === "diagnostics") {
		return diagnosticResponse(
			subject.path,
			graph,
			normalized,
			evidence,
			params,
		);
	}
	if (question === "dependencies" || question === "dependents") {
		const outgoing = question === "dependencies";
		const items = fileRelations(session, graph, entity, outgoing, evidence);
		const page = paginate(items, params);
		return response(
			graph,
			"found",
			normalized,
			{ [question]: page.items },
			dependencyCompleteness(graph, question),
			page,
		);
	}
	if (question === "impact") {
		const impact = await session.fileImpact(subject.path);
		if (!impact) return response(graph, "notFound", subject);
		const dependencies = fileRelations(session, graph, entity, true, evidence);
		const dependents = fileRelations(session, graph, entity, false, evidence);
		const provenPages = new Set(impact.affectedPages);
		const affectedPages = [
			...new Set([
				...impact.affectedPages,
				...affectedPagesFromGraph(graph, entity.id),
			]),
		].sort();
		const inferredPageCount = affectedPages.filter(
			(path) => !provenPages.has(path),
		).length;
		const items = interleave([
			dependents.map((item) => ({ role: "dependent", ...item })),
			affectedPages.map((path) => ({
				role: "affectedPage",
				path,
				certainty: provenPages.has(path) ? "proven" : "inferred",
			})),
			dependencies.map((item) => ({ role: "dependency", ...item })),
		]);
		const page = paginate(items, params);
		return response(
			graph,
			"found",
			normalized,
			{
				impact: page.items,
				usage: impact.usage,
				counts: {
					dependencies: dependencies.length,
					dependents: dependents.length,
					affectedPages: affectedPages.length,
				},
			},
			completenessFromMessages([
				...impact.uncertainty.filter((message) =>
					/(?:render|reference|dependency|affected page|dynamic.*target)/i.test(
						message,
					),
				),
				...(inferredPageCount > 0
					? [
							`${inferredPageCount} pages inherited through a reachable layout are inferred.`,
						]
					: []),
			]),
			page,
		);
	}
	throw new InspectInputError(
		`Question ${question} is not supported for file subjects`,
	);
}

function inspectBehavior(
	session: ShopifyQuerySession,
	graph: InspectionPublicGraph,
	subject: Extract<InspectSubject, { type: "behavior" }>,
	question: Question,
	evidence: EvidenceMode,
	params: Record<string, unknown> | undefined,
): InspectionAnswer {
	if (question !== "summary" && question !== "usages") {
		throw new InspectInputError(
			`Question ${question} is not supported for behavior subjects`,
		);
	}
	const matches = graph.entities.filter(
		(entity) =>
			entity.kind === "behavior" &&
			entity.name === subject.name &&
			(!subject.kind || behaviorKind(entity) === subject.kind),
	);
	if (matches.length === 0) return response(graph, "notFound", subject);
	const kinds = [...new Set(matches.map(behaviorKind))];
	if (!subject.kind && kinds.length > 1) {
		return response(
			graph,
			"ambiguous",
			subject,
			undefined,
			undefined,
			undefined,
			[
				...kinds.map((kind) => ({
					type: "behavior",
					kind,
					name: subject.name,
				})),
			],
		);
	}
	const normalized = {
		type: "behavior",
		kind: subject.kind ?? kinds[0] ?? "other",
		name: subject.name,
	};
	if (question === "summary") return response(graph, "found", normalized, {});
	const ids = new Set(matches.map((entity) => entity.id));
	const items = behaviorUsages(session, graph, ids, evidence);
	const related = relatedBehaviorSummaries(graph, subject.name);
	const page = paginate(items, params);
	return response(
		graph,
		"found",
		normalized,
		{
			usages: page.items,
			...(related.length ? { relatedBehaviors: related } : {}),
		},
		behaviorCompleteness(graph, normalized.kind as BehaviorKind),
		page,
	);
}

async function inspectMetafield(
	session: ShopifyQuerySession,
	graph: InspectionPublicGraph,
	subject: Extract<InspectSubject, { type: "metafield" }>,
	question: Question,
	evidence: EvidenceMode,
	params: Record<string, unknown> | undefined,
): Promise<InspectionAnswer> {
	if (
		question !== "summary" &&
		question !== "usages" &&
		question !== "impact"
	) {
		throw new InspectInputError(
			`Question ${question} is not supported for metafield subjects`,
		);
	}
	const impact = await session.metafieldImpact(subject);
	const matchingData = graph.entities.filter(
		(entity) =>
			entity.kind === "data" &&
			entity.subtype === "metafield" &&
			entity.identity.namespace === subject.namespace &&
			entity.identity.key === subject.key,
	);
	const entities = matchingData.filter(
		(entity) => entity.identity.owner === subject.owner,
	);
	const possibleEntities = matchingData.filter(
		(entity) => entity.identity.owner !== subject.owner,
	);
	const found = entities.length > 0 || impact.definition !== undefined;
	if (!found) return response(graph, "notFound", subject);
	const normalized = { ...subject };
	if (question === "summary") {
		return response(
			graph,
			"found",
			normalized,
			{
				summary: {
					definition: impact.definition
						? { status: "present", type: impact.definition.type }
						: { status: "missing" },
					readCount: impact.reads.length + impact.apiReads.length,
					possibleReadCount: possibleEntities.length,
				},
			},
			completenessFromMessages([
				...impact.uncertainty,
				...(possibleEntities.length
					? [
							"Additional reads use Liquid variables whose Shopify owner type cannot be proven statically.",
						]
					: []),
			]),
		);
	}
	const ids = new Set(entities.map((entity) => entity.id));
	const possibleIds = new Set(possibleEntities.map((entity) => entity.id));
	const usages = metafieldUsages(session, graph, ids, possibleIds, evidence);
	if (impact.definition) {
		usages.unshift({
			role: "definition",
			operation: "defines",
			path: impact.snapshot.path,
			...(impact.definition.type ? { dataType: impact.definition.type } : {}),
		});
	}
	const items =
		question === "impact"
			? [
					...usages,
					...impact.affectedPages.map((path) => ({
						role: "affectedPage",
						path,
					})),
				]
			: usages;
	const page = paginate(items, params);
	return response(
		graph,
		"found",
		normalized,
		question === "impact"
			? {
					impact: page.items,
					definition: impact.definition
						? { status: "present", type: impact.definition.type }
						: { status: "missing" },
				}
			: {
					usages: page.items,
					definition: impact.definition
						? { status: "present", type: impact.definition.type }
						: { status: "missing" },
				},
		completenessFromMessages([
			...impact.uncertainty,
			...(possibleEntities.length
				? [
						"Additional reads use Liquid variables whose Shopify owner type cannot be proven statically.",
					]
				: []),
		]),
		page,
	);
}

function inspectSymbol(
	session: ShopifyQuerySession,
	graph: InspectionPublicGraph,
	subject: Extract<InspectSubject, { type: "symbol" }>,
	question: Question,
	evidence: EvidenceMode,
	params: Record<string, unknown> | undefined,
): InspectionAnswer {
	if (question !== "summary" && question !== "usages") {
		throw new InspectInputError(
			`Question ${question} is not supported for symbol subjects`,
		);
	}
	const matches = graph.entities.filter(
		(entity) =>
			entity.kind === "declaration" &&
			entity.name === subject.name &&
			(!subject.path || entity.path === subject.path),
	);
	if (matches.length === 0) return response(graph, "notFound", subject);
	if (!subject.path && new Set(matches.map((entity) => entity.path)).size > 1) {
		return response(
			graph,
			"ambiguous",
			subject,
			undefined,
			undefined,
			undefined,
			matches.map((entity) => ({
				type: "symbol",
				name: entity.name,
				path: entity.path,
				kind: entity.subtype,
			})),
		);
	}
	const match = matches[0];
	const normalized = {
		type: "symbol",
		name: match?.name ?? subject.name,
		path: match?.path,
		kind: match?.subtype,
	};
	if (question === "summary") return response(graph, "found", normalized, {});
	const ids = new Set(matches.map((entity) => entity.id));
	const items = behaviorUsages(session, graph, ids, evidence);
	const page = paginate(items, params);
	return response(
		graph,
		"found",
		normalized,
		{ usages: page.items },
		undefined,
		page,
	);
}

function inspectDiagnostics(
	graph: InspectionPublicGraph,
	subject: Extract<InspectSubject, { type: "diagnostic" }>,
	evidence: EvidenceMode,
	params: Record<string, unknown> | undefined,
): InspectionAnswer {
	return diagnosticResponse(
		subject.path,
		graph,
		subject,
		evidence,
		params,
		subject.code,
	);
}

function diagnosticResponse(
	path: string | undefined,
	graph: InspectionPublicGraph,
	subject: Record<string, unknown>,
	evidence: EvidenceMode,
	params: Record<string, unknown> | undefined,
	code?: string,
): InspectionAnswer {
	const diagnostics = uniqueRecords(
		graph.entities
			.filter(
				(entity) =>
					entity.kind === "diagnostic" &&
					(!path || entity.path === path) &&
					(!code || entity.name === code),
			)
			.map((entity) => {
				const span = isRecord(entity.attributes?.span)
					? entity.attributes.span
					: undefined;
				return {
					code: entity.name,
					severity: entity.subtype,
					message:
						typeof entity.attributes?.message === "string"
							? entity.attributes.message
							: "",
					...(entity.path
						? {
								location: sourceLocation(
									undefined,
									entity.path,
									span,
									evidence,
								),
							}
						: {}),
				};
			}),
	);
	const page = paginate(diagnostics, params);
	return response(
		graph,
		diagnostics.length ? "found" : "notFound",
		subject,
		{
			diagnostics: page.items,
		},
		undefined,
		page,
	);
}

function fileRelations(
	session: ShopifyQuerySession,
	graph: InspectionPublicGraph,
	file: PublicEntity,
	outgoing: boolean,
	evidence: EvidenceMode,
): Record<string, unknown>[] {
	const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
	const groups = new Map<string, RelationGroup>();
	for (const relation of graph.relations) {
		if (relation.category !== "dependency") continue;
		if (outgoing ? relation.from !== file.id : relation.to !== file.id)
			continue;
		const other = entities.get(outgoing ? relation.to : relation.from);
		if (!other?.path || other.kind !== "file") continue;
		const key = `${relation.kind}\n${other.path}`;
		const group = groups.get(key) ?? {
			path: other.path,
			relationship: relation.kind,
			certainty: relation.certainty,
			maxLocations: 10,
			locations: [],
			occurrences: 0,
		};
		group.occurrences += 1;
		if (relation.certainty === "inferred") group.certainty = "inferred";
		const path = outgoing ? (file.path ?? "") : other.path;
		const location = relationLocation(session, relation, path, evidence);
		if (location) addLocation(group.locations, location);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort((left, right) => left.path.localeCompare(right.path))
		.map(compactGroup);
}

type RelationGroup = {
	path: string;
	relationship: string;
	certainty: string;
	operation?: string;
	role?: string;
	symbol?: string;
	ownerExpression?: string;
	maxLocations?: number;
	locations: Location[];
	occurrences: number;
};

function behaviorUsages(
	session: ShopifyQuerySession,
	graph: InspectionPublicGraph,
	targetIds: ReadonlySet<string>,
	evidence: EvidenceMode,
): Record<string, unknown>[] {
	const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
	const groups = new Map<string, RelationGroup>();
	for (const relation of graph.relations) {
		if (relation.category !== "behavior" || !targetIds.has(relation.to))
			continue;
		const owner = entities.get(relation.from);
		if (!owner?.path) continue;
		const operation = stringAttribute(relation, "operation") ?? relation.kind;
		const role = behaviorRole(relation.kind);
		const symbol = owner.kind === "declaration" ? owner.name : undefined;
		const key = `${role}\n${owner.path}\n${symbol ?? ""}\n${operation}`;
		const group = groups.get(key) ?? {
			path: owner.path,
			relationship: relation.kind,
			certainty: relation.certainty,
			operation,
			role,
			...(symbol ? { symbol } : {}),
			maxLocations: 10,
			locations: [],
			occurrences: 0,
		};
		group.occurrences += 1;
		const location = relationLocation(session, relation, owner.path, evidence);
		if (location) addLocation(group.locations, location);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort((left, right) =>
			`${left.role}\n${left.path}\n${left.symbol ?? ""}`.localeCompare(
				`${right.role}\n${right.path}\n${right.symbol ?? ""}`,
			),
		)
		.map(compactGroup);
}

function relatedBehaviorSummaries(
	graph: InspectionPublicGraph,
	name: string,
): Record<string, unknown>[] {
	const entitiesById = new Map(
		graph.entities.map((candidate) => [candidate.id, candidate]),
	);
	return graph.entities
		.filter(
			(entity) =>
				entity.kind === "behavior" &&
				entity.name !== name &&
				entity.name.startsWith(`${name}-`),
		)
		.map((entity) => {
			const relations = graph.relations.filter(
				(relation) =>
					relation.category === "behavior" && relation.to === entity.id,
			);
			const producerFiles = new Set<string>();
			const consumerFiles = new Set<string>();
			for (const relation of relations) {
				const path = entitiesById.get(relation.from)?.path;
				if (!path) continue;
				(behaviorRole(relation.kind) === "producer"
					? producerFiles
					: consumerFiles
				).add(path);
			}
			return {
				kind: behaviorKind(entity),
				name: entity.name,
				occurrences: relations.length,
				producerFiles: producerFiles.size,
				consumerFiles: consumerFiles.size,
			};
		})
		.sort((left, right) => String(left.name).localeCompare(String(right.name)))
		.slice(0, 10);
}

function metafieldUsages(
	session: ShopifyQuerySession,
	graph: InspectionPublicGraph,
	targetIds: ReadonlySet<string>,
	possibleIds: ReadonlySet<string>,
	evidence: EvidenceMode,
): Record<string, unknown>[] {
	const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
	const groups = new Map<string, RelationGroup>();
	for (const relation of graph.relations) {
		if (
			relation.category !== "dataFlow" ||
			(!targetIds.has(relation.to) && !possibleIds.has(relation.to))
		) {
			continue;
		}
		const owner = entities.get(relation.from);
		const data = entities.get(relation.to);
		if (!owner?.path) continue;
		const possible = possibleIds.has(relation.to);
		const role = possible
			? "possibleReader"
			: relation.kind === "writes"
				? "writer"
				: "reader";
		const key = `${role}\n${owner.path}`;
		const group = groups.get(key) ?? {
			path: owner.path,
			relationship: relation.kind,
			certainty: possible ? "inferred" : relation.certainty,
			operation: relation.kind,
			role,
			...(possible && data?.identity.owner
				? { ownerExpression: data.identity.owner }
				: {}),
			maxLocations: 10,
			locations: [],
			occurrences: 0,
		};
		group.occurrences += 1;
		const location = relationLocation(session, relation, owner.path, evidence);
		if (location) addLocation(group.locations, location);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort((left, right) => left.path.localeCompare(right.path))
		.map(compactGroup);
}

function uniqueRecords(
	records: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
	const seen = new Set<string>();
	return records.filter((record) => {
		const key = JSON.stringify(record);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function compactGroup(group: RelationGroup): Record<string, unknown> {
	const maximumLocations = group.maxLocations ?? MAX_LOCATIONS_PER_ITEM;
	return {
		...(group.role ? { role: group.role } : {}),
		path: group.path,
		...(group.symbol ? { symbol: group.symbol } : {}),
		...(group.ownerExpression
			? { ownerExpression: group.ownerExpression }
			: {}),
		...(group.operation ? { operation: group.operation } : {}),
		relationship: group.relationship,
		certainty: group.certainty,
		occurrences: group.occurrences,
		...(group.locations.length
			? { locations: group.locations.slice(0, maximumLocations) }
			: {}),
		...(group.locations.length > maximumLocations
			? { additionalLocations: group.locations.length - maximumLocations }
			: {}),
	};
}

function relationLocation(
	session: ShopifyQuerySession,
	relation: PublicRelation,
	path: string,
	evidence: EvidenceMode,
): Location | undefined {
	if (evidence === "none") return undefined;
	return sourceLocation(session, path, relation.attributes, evidence);
}

function sourceLocation(
	session: ShopifyQuerySession | undefined,
	path: string,
	attributes: unknown,
	evidence: EvidenceMode,
): Location {
	const source = session?.fileContents(path);
	const record = isRecord(attributes) ? attributes : {};
	const range = isRecord(record.range) ? record.range : undefined;
	const span = isRecord(record.span) ? record.span : undefined;
	let start: Position | undefined;
	let end: Position | undefined;
	let excerpt: string | undefined;
	if (
		range &&
		typeof range.start === "number" &&
		typeof range.end === "number" &&
		source !== undefined
	) {
		start = offsetPosition(source, range.start);
		end = offsetPosition(source, range.end);
		if (evidence === "excerpt") {
			excerpt = compactExcerpt(source.slice(range.start, range.end));
		}
	} else if (span && isPosition(span.start) && isPosition(span.end)) {
		start = { line: span.start.line, character: span.start.column };
		end = { line: span.end.line, character: span.end.column };
		if (evidence === "excerpt" && source !== undefined) {
			excerpt = excerptFromSpan(source, start, end);
		}
	}
	return {
		path,
		...(start ? { start } : {}),
		...(end ? { end } : {}),
		...(excerpt ? { excerpt } : {}),
	};
}

function excerptFromSpan(
	source: string,
	start: Position,
	end: Position,
): string {
	const lines = source.split(/\r?\n/);
	if (start.line === end.line) {
		return compactExcerpt(
			(lines[start.line - 1] ?? "").slice(
				Math.max(0, start.character - 1),
				Math.max(0, end.character - 1),
			),
		);
	}
	return compactExcerpt(
		[
			(lines[start.line - 1] ?? "").slice(Math.max(0, start.character - 1)),
			...lines.slice(start.line, Math.max(start.line, end.line - 1)),
			(lines[end.line - 1] ?? "").slice(0, Math.max(0, end.character - 1)),
		].join("\n"),
	);
}

function addLocation(locations: Location[], location: Location): void {
	const key = JSON.stringify(location);
	if (!locations.some((candidate) => JSON.stringify(candidate) === key)) {
		locations.push(location);
	}
}

function offsetPosition(source: string, offset: number): Position {
	const before = source.slice(0, Math.max(0, offset));
	const lines = before.split("\n");
	return {
		line: lines.length,
		character: (lines.at(-1)?.length ?? 0) + 1,
	};
}

function compactExcerpt(value: string): string {
	const compact = value.trim().replace(/\s+/g, " ");
	return compact.length <= MAX_EXCERPT_LENGTH
		? compact
		: `${compact.slice(0, MAX_EXCERPT_LENGTH - 1)}…`;
}

function behaviorKind(entity: PublicEntity): BehaviorKind {
	const subjectKind = entity.identity.subjectKind;
	const hookKind = entity.identity.hookKind;
	if (subjectKind === "customElement") return "customElement";
	if (subjectKind === "customEvent") return "customEvent";
	if (subjectKind === "customProperty") return "customProperty";
	if (subjectKind === "domHook" && hookKind === "class") return "domClass";
	if (subjectKind === "domHook" && hookKind === "id") return "domId";
	if (subjectKind === "domHook" && hookKind === "attribute") {
		return "domAttribute";
	}
	return "other";
}

function behaviorRole(relationKind: string): "producer" | "consumer" {
	return relationKind === "produces" ||
		relationKind === "defines" ||
		relationKind === "writes"
		? "producer"
		: "consumer";
}

function affectedPagesFromGraph(
	graph: InspectionPublicGraph,
	startId: string,
): string[] {
	const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
	const incoming = new Map<string, string[]>();
	for (const relation of graph.relations) {
		if (relation.category !== "dependency") continue;
		const callers = incoming.get(relation.to) ?? [];
		callers.push(relation.from);
		incoming.set(relation.to, callers);
	}
	const reached = new Set([startId]);
	const queue = [startId];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) continue;
		for (const caller of incoming.get(current) ?? []) {
			if (reached.has(caller)) continue;
			reached.add(caller);
			queue.push(caller);
		}
	}
	const reachesLayout = [...reached].some(
		(id) => entities.get(id)?.subtype === "layout",
	);
	return graph.entities
		.filter(
			(entity) =>
				entity.kind === "file" &&
				entity.path &&
				entity.roles?.includes("page") === true &&
				(reachesLayout || reached.has(entity.id)),
		)
		.map((entity) => entity.path as string)
		.sort();
}

function interleave<Item>(groups: readonly (readonly Item[])[]): Item[] {
	const result: Item[] = [];
	const maximum = Math.max(0, ...groups.map((group) => group.length));
	for (let index = 0; index < maximum; index += 1) {
		for (const group of groups) {
			const item = group[index];
			if (item !== undefined) result.push(item);
		}
	}
	return result;
}

function dependencyCompleteness(
	graph: InspectionPublicGraph,
	question: "dependencies" | "dependents",
): InspectionAnswer["completeness"] {
	const messages = (graph.completeness.uncertainty ?? [])
		.map((finding) => finding.message)
		.filter((message) => /dynamic.*(?:render|reference|import)/i.test(message));
	if (question === "dependents" && messages.length > 0) {
		return completenessFromMessages([
			"Dynamic references may add dependents that cannot be resolved statically.",
		]);
	}
	return completenessFromMessages(messages);
}

function behaviorCompleteness(
	graph: InspectionPublicGraph,
	kind: BehaviorKind,
): InspectionAnswer["completeness"] {
	const patterns: RegExp[] =
		kind === "domClass"
			? [/class/i, /selector/i]
			: kind === "domId"
				? [/\bid\b/i, /selector/i, /getElementById/i]
				: kind === "domAttribute"
					? [/attribute/i, /selector/i]
					: kind === "customEvent"
						? [/event/i]
						: [/behavior/i];
	return completenessFromMessages(
		(graph.completeness.uncertainty ?? [])
			.map((finding) => finding.message)
			.filter((message) => patterns.some((pattern) => pattern.test(message))),
	);
}

function completenessFromMessages(
	messages: readonly string[],
): InspectionAnswer["completeness"] {
	const unique = [...new Set(messages)];
	const reasons = unique.slice(0, 3).map((message) => ({
		code: "ANALYSIS_UNCERTAINTY",
		message,
	}));
	return unique.length === 0
		? { status: "complete" }
		: {
				status: "partial",
				reasons,
				...(unique.length > reasons.length
					? { additionalReasons: unique.length - reasons.length }
					: {}),
			};
}

function response(
	graph: InspectionPublicGraph,
	status: InspectionAnswer["status"],
	subject: Record<string, unknown>,
	answer?: Record<string, unknown>,
	completeness: InspectionAnswer["completeness"] = { status: "complete" },
	page?: { items: readonly unknown[]; total: number; nextCursor?: string },
	candidates?: readonly Record<string, unknown>[],
): InspectionAnswer {
	return {
		contractVersion: INSPECTION_AGENT_CONTRACT_VERSION,
		revision: graph.revision,
		status,
		subject,
		...(answer ? { answer } : {}),
		...(candidates ? { candidates } : {}),
		completeness,
		...(page
			? {
					page: {
						total: page.total,
						returned: page.items.length,
						...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
					},
				}
			: {}),
	};
}

function paginate<Item>(
	items: readonly Item[],
	params: Record<string, unknown> | undefined,
): { items: readonly Item[]; total: number; nextCursor?: string } {
	const limit = optionalInteger(params, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
	const cursor = params?.cursor;
	let offset = 0;
	if (cursor !== undefined) {
		if (typeof cursor !== "string" || !/^(0|[1-9]\d*)$/.test(cursor)) {
			throw new InspectInputError(
				"cursor must be a non-negative integer string",
			);
		}
		offset = Number(cursor);
		if (!Number.isSafeInteger(offset) || offset > items.length) {
			throw new InspectInputError("Invalid cursor");
		}
	}
	const page = items.slice(offset, offset + limit);
	const nextOffset = offset + page.length;
	return {
		items: page,
		total: items.length,
		...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
	};
}

function parseSubject(value: unknown): InspectSubject {
	if (!isRecord(value))
		throw new InspectInputError("subject must be an object");
	const type = requiredString(value, "type");
	switch (type) {
		case "project":
			return { type };
		case "file":
			return { type, path: requiredString(value, "path") };
		case "behavior":
			return {
				type,
				name: requiredString(value, "name"),
				...(value.kind === undefined
					? {}
					: { kind: enumValue(value.kind, "subject.kind", BEHAVIOR_KINDS) }),
			};
		case "metafield":
			return {
				type,
				owner: requiredString(value, "owner"),
				namespace: requiredString(value, "namespace"),
				key: requiredString(value, "key"),
			};
		case "symbol":
			return {
				type,
				name: requiredString(value, "name"),
				...(value.path === undefined
					? {}
					: { path: requiredString(value, "path") }),
			};
		case "diagnostic":
			return {
				type,
				...(value.code === undefined
					? {}
					: { code: requiredString(value, "code") }),
				...(value.path === undefined
					? {}
					: { path: requiredString(value, "path") }),
			};
		default:
			throw new InspectInputError(`Unknown subject type: ${type}`);
	}
}

function parseQuestion(
	value: unknown,
	subjectType: InspectSubject["type"],
): Question {
	if (value !== undefined) return enumValue(value, "question", QUESTIONS);
	if (subjectType === "behavior" || subjectType === "metafield")
		return "usages";
	if (subjectType === "diagnostic") return "diagnostics";
	return "summary";
}

function optionalEnum<const Values extends readonly string[]>(
	params: Record<string, unknown> | undefined,
	key: string,
	values: Values,
	fallback: Values[number],
): Values[number] {
	return params?.[key] === undefined
		? fallback
		: enumValue(params[key], key, values);
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	key: string,
	values: Values,
): Values[number] {
	if (typeof value !== "string" || !values.includes(value)) {
		throw new InspectInputError(`Invalid ${key}: ${String(value)}`);
	}
	return value as Values[number];
}

function optionalInteger(
	params: Record<string, unknown> | undefined,
	key: string,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const value = params?.[key];
	if (value === undefined) return fallback;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new InspectInputError(
			`${key} must be an integer from ${minimum} to ${maximum}`,
		);
	}
	return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new InspectInputError(`${key} must be a non-empty string`);
	}
	return value;
}

function stringAttribute(
	relation: PublicRelation,
	key: string,
): string | undefined {
	const value = relation.attributes?.[key];
	return typeof value === "string" ? value : undefined;
}

function isPosition(value: unknown): value is { line: number; column: number } {
	return (
		isRecord(value) &&
		typeof value.line === "number" &&
		typeof value.column === "number"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const INSPECT_TOOL = Object.freeze({
	name: "inspect",
	description:
		"Answer a semantic repository question directly. Accepts files, behaviors, metafields, symbols, diagnostics, or the project; returns compact domain facts with source path and 1-based line/character locations. Use location evidence for citations; request excerpts only when source text is necessary. No graph IDs are exposed.",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		required: ["subject"],
		properties: {
			subject: {
				oneOf: [
					{
						type: "object",
						additionalProperties: false,
						required: ["type"],
						properties: { type: { const: "project" } },
					},
					{
						type: "object",
						additionalProperties: false,
						required: ["type", "path"],
						properties: {
							type: { const: "file" },
							path: { type: "string", minLength: 1 },
						},
					},
					{
						type: "object",
						additionalProperties: false,
						required: ["type", "name"],
						properties: {
							type: { const: "behavior" },
							name: { type: "string", minLength: 1 },
							kind: { type: "string", enum: BEHAVIOR_KINDS },
						},
					},
					{
						type: "object",
						additionalProperties: false,
						required: ["type", "owner", "namespace", "key"],
						properties: {
							type: { const: "metafield" },
							owner: { type: "string", minLength: 1 },
							namespace: { type: "string", minLength: 1 },
							key: { type: "string", minLength: 1 },
						},
					},
					{
						type: "object",
						additionalProperties: false,
						required: ["type", "name"],
						properties: {
							type: { const: "symbol" },
							name: { type: "string", minLength: 1 },
							path: { type: "string", minLength: 1 },
						},
					},
					{
						type: "object",
						additionalProperties: false,
						required: ["type"],
						properties: {
							type: { const: "diagnostic" },
							code: { type: "string", minLength: 1 },
							path: { type: "string", minLength: 1 },
						},
					},
				],
			},
			question: { type: "string", enum: QUESTIONS },
			evidence: {
				type: "string",
				enum: EVIDENCE_MODES,
				default: "location",
				description:
					"Source proof detail. Use location for path/line citations and lower token cost; use excerpt only when exact source text is required.",
			},
			limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
			cursor: { type: "string", pattern: "^(0|[1-9]\\d*)$" },
		},
	},
});
