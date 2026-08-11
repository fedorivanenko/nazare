import { createHash } from "node:crypto";
import type { SemanticCompilerSource } from "../compiler/semantic-compiler.js";
import type { CoverageStatus } from "../ontology/core.js";
import type { SemanticGraphSnapshot } from "../outputs/semantic-graph-snapshot.js";
import {
	type JsonDocument,
	JsonParserProvider,
} from "../parsers/json/parser.js";
import type { SourceRange } from "../semantic/evidence.js";
import type {
	FactOntologyFact,
	FactOntologySnapshot,
} from "./fact-ontology.js";

export const ARTIFACT_TOPOLOGY_VERSION = 1 as const;

export type ArtifactTopologyRef = string;

export type ArtifactTopologyArtifact = {
	ref: ArtifactTopologyRef;
	path: string;
	language?: string;
	role?: string;
};

export type ArtifactTopologySource = {
	ref: ArtifactTopologyRef;
	artifact: ArtifactTopologyRef;
	range: SourceRange;
};

export type ArtifactTopologyRelation = {
	ref: ArtifactTopologyRef;
	kind: "ATTACHED_TO" | "INCLUDES" | "REACHABLE_FROM";
	from: ArtifactTopologyRef;
	to: ArtifactTopologyRef;
	assertion: {
		certainty: "proven" | "inferred";
		basis: "syntax" | "convention" | "bounded-analysis";
		evidence: readonly ArtifactTopologyRef[];
	};
	attributes?: Readonly<Record<string, string | number | boolean>>;
	via?: readonly ArtifactTopologyRef[];
};

export type ArtifactTopologyReference = {
	ref: ArtifactTopologyRef;
	kind: "asset" | "layout" | "section" | "snippet";
	owner: ArtifactTopologyRef;
	targetPath?: string;
	expression?: string;
	resolution:
		| "resolved"
		| "not-found"
		| "unknown"
		| "runtime-dependent"
		| "external-data-required";
	source?: ArtifactTopologyRef;
	relation?: ArtifactTopologyRef;
};

export type ArtifactTopologyCoverage = {
	family: "shopify.artifact-links" | "shopify.artifact-reachability";
	status: CoverageStatus;
	scope: { artifacts: readonly ArtifactTopologyRef[] };
	reasons?: readonly { code: string; message: string }[];
};

export type ArtifactTopologySnapshot = {
	contractVersion: typeof ARTIFACT_TOPOLOGY_VERSION;
	revision: { id: string; repositoryFingerprint: string };
	artifacts: readonly ArtifactTopologyArtifact[];
	sources: readonly ArtifactTopologySource[];
	references: readonly ArtifactTopologyReference[];
	relations: readonly ArtifactTopologyRelation[];
	coverage: readonly ArtifactTopologyCoverage[];
};

export type ArtifactTopologyLimits = {
	maxWork: number;
	maxRelations: number;
	maxDepth: number;
	maxEvidencePerReachability: number;
};

const defaultLimits: ArtifactTopologyLimits = {
	maxWork: 100_000,
	maxRelations: 100_000,
	maxDepth: 32,
	maxEvidencePerReachability: 16,
};

/** Experimental repository topology. Kept separate from seven semantic predicates. */
export function projectArtifactTopology(input: {
	snapshot: SemanticGraphSnapshot;
	sources: readonly SemanticCompilerSource[];
	repositoryScope: { status: "complete" | "partial" };
	limits?: Partial<ArtifactTopologyLimits>;
}): ArtifactTopologySnapshot {
	const limits = { ...defaultLimits, ...input.limits };
	const sourceInputs = [...input.sources].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const sourceFingerprint = fingerprintSources(sourceInputs);
	if (sourceFingerprint !== input.snapshot.revision.repositoryFingerprint) {
		throw new Error(
			"Artifact topology sources do not match semantic snapshot repository fingerprint",
		);
	}
	const sourceByPath = new Map(
		sourceInputs.map((source) => [source.path, source]),
	);
	const entitiesById = new Map(
		input.snapshot.entities.map((entity) => [entity.id, entity]),
	);
	const occurrencesById = new Map(
		input.snapshot.occurrences.map((occurrence) => [occurrence.id, occurrence]),
	);
	const artifactByPath = new Map<string, ArtifactTopologyArtifact>();
	for (const source of sourceInputs) {
		const sourceEntity = input.snapshot.entities.find(
			(entity) =>
				entity.kind === "shopify.source-file" && entity.path === source.path,
		);
		artifactByPath.set(source.path, {
			ref: artifactRef(source.path),
			path: source.path,
			...(typeof sourceEntity?.attributes.language === "string"
				? { language: sourceEntity.attributes.language }
				: {}),
			...(typeof sourceEntity?.attributes.role === "string"
				? { role: sourceEntity.attributes.role }
				: {}),
		});
	}

	const sources = new Map<string, ArtifactTopologySource>();
	const references = new Map<string, ArtifactTopologyReference>();
	const directRelations = new Map<string, ArtifactTopologyRelation>();
	const coverageReasons = new Map<
		string,
		{ code: string; message: string }[]
	>();
	let work = 0;
	let relationBudgetExhausted = false;

	const addReason = (path: string, code: string, message: string) => {
		const entries = coverageReasons.get(path) ?? [];
		if (
			!entries.some((entry) => entry.code === code && entry.message === message)
		) {
			entries.push({ code, message });
			coverageReasons.set(path, entries);
		}
	};
	const sourceRef = (path: string, range: SourceRange): string => {
		const ref = `topology-source:${escapeRef(path)}:${range.start}:${range.end}`;
		if (!sources.has(ref)) {
			sources.set(ref, { ref, artifact: artifactRef(path), range });
		}
		return ref;
	};
	const addDirectRelation = (
		kind: "ATTACHED_TO" | "INCLUDES",
		fromPath: string,
		toPath: string,
		assertion: ArtifactTopologyRelation["assertion"],
	): string | undefined => {
		if (directRelations.size >= limits.maxRelations) {
			relationBudgetExhausted = true;
			addReason(
				fromPath,
				"budget",
				"Artifact topology relation budget exhausted",
			);
			return undefined;
		}
		const ref = relationRef(input.snapshot.revision.id, kind, fromPath, toPath);
		const relation: ArtifactTopologyRelation = {
			ref,
			kind,
			from: artifactRef(fromPath),
			to: artifactRef(toPath),
			assertion,
		};
		const existing = directRelations.get(ref);
		if (
			!existing ||
			assertion.evidence.length > existing.assertion.evidence.length
		) {
			directRelations.set(ref, relation);
		}
		return ref;
	};
	const addReference = (parameters: {
		kind: ArtifactTopologyReference["kind"];
		ownerPath: string;
		targetPath?: string;
		expression?: string;
		range?: SourceRange;
		relationKind?: "ATTACHED_TO" | "INCLUDES";
		fromPath?: string;
		toPath?: string;
		certainty?: "proven" | "inferred";
		basis?: "syntax" | "convention";
		resolution?: ArtifactTopologyReference["resolution"];
	}) => {
		work += 1;
		if (work > limits.maxWork) {
			addReason(
				parameters.ownerPath,
				"budget",
				"Artifact topology work budget exhausted",
			);
			return;
		}
		const source = parameters.range
			? sourceRef(parameters.ownerPath, parameters.range)
			: undefined;
		const dynamic = parameters.targetPath === undefined;
		const targetExists = parameters.targetPath
			? artifactByPath.has(parameters.targetPath)
			: false;
		const resolution: ArtifactTopologyReference["resolution"] =
			parameters.resolution ??
			(dynamic
				? "runtime-dependent"
				: targetExists
					? "resolved"
					: input.repositoryScope.status === "complete"
						? "not-found"
						: "unknown");
		let relation: string | undefined;
		if (
			resolution === "resolved" &&
			parameters.relationKind &&
			parameters.fromPath &&
			parameters.toPath
		) {
			relation = addDirectRelation(
				parameters.relationKind,
				parameters.fromPath,
				parameters.toPath,
				{
					certainty: parameters.certainty ?? "proven",
					basis: parameters.basis ?? "syntax",
					evidence: source ? [source] : [],
				},
			);
		}
		const identity = `${parameters.kind}\0${parameters.ownerPath}\0${parameters.targetPath ?? parameters.expression ?? "dynamic"}\0${parameters.range?.start ?? 0}`;
		const ref = `topology-reference:${revisionHash(input.snapshot.revision.id)}:${shortHash(identity)}`;
		references.set(ref, {
			ref,
			kind: parameters.kind,
			owner: artifactRef(parameters.ownerPath),
			...(parameters.targetPath ? { targetPath: parameters.targetPath } : {}),
			...(parameters.expression ? { expression: parameters.expression } : {}),
			resolution,
			...(source ? { source } : {}),
			...(relation ? { relation } : {}),
		});
		if (resolution === "runtime-dependent") {
			addReason(
				parameters.ownerPath,
				"runtime-dependent",
				`Dynamic ${parameters.kind} reference requires runtime evaluation`,
			);
		}
		if (resolution === "external-data-required") {
			addReason(
				parameters.ownerPath,
				"external-data-required",
				`${parameters.kind} target belongs to an external runtime asset namespace`,
			);
		}
		if (resolution === "unknown") {
			addReason(
				parameters.ownerPath,
				"partial-scope",
				`${parameters.kind} target availability is unknown in partial repository scope`,
			);
		}
	};

	projectJsonSections();
	projectLiquidIncludes();
	projectLiquidAssets();
	projectDefaultLayouts();

	const reachability = projectReachability(
		input.snapshot.revision.id,
		artifactByPath,
		directRelations,
		sources,
		coverageReasons,
		limits,
	);
	const relations = [
		...directRelations.values(),
		...reachability.relations,
	].sort((left, right) => left.ref.localeCompare(right.ref));
	const linkCoverage: ArtifactTopologyCoverage[] = sourceInputs.map(
		(source) => {
			const reasons = coverageReasons.get(source.path) ?? [];
			return {
				family: "shopify.artifact-links",
				status: reasons.some(({ code }) =>
					["budget", "unsupported", "partial-scope"].includes(code),
				)
					? "partial"
					: reasons.some(({ code }) => code === "external-data-required")
						? "external-data-required"
						: reasons.some(({ code }) => code === "runtime-dependent")
							? "runtime-dependent"
							: "complete",
				scope: { artifacts: [artifactRef(source.path)] },
				...(reasons.length > 0 ? { reasons } : {}),
			};
		},
	);
	if (relationBudgetExhausted && linkCoverage.length === 0) {
		linkCoverage.push({
			family: "shopify.artifact-links",
			status: "partial",
			scope: { artifacts: [] },
			reasons: [
				{
					code: "budget",
					message: "Artifact topology relation budget exhausted",
				},
			],
		});
	}
	const result: ArtifactTopologySnapshot = {
		contractVersion: ARTIFACT_TOPOLOGY_VERSION,
		revision: {
			id: input.snapshot.revision.id,
			repositoryFingerprint: input.snapshot.revision.repositoryFingerprint,
		},
		artifacts: [...artifactByPath.values()].sort((left, right) =>
			left.path.localeCompare(right.path),
		),
		sources: [...sources.values()].sort((left, right) =>
			left.ref.localeCompare(right.ref),
		),
		references: [...references.values()].sort((left, right) =>
			left.ref.localeCompare(right.ref),
		),
		relations,
		coverage: [...linkCoverage, ...reachability.coverage].sort((left, right) =>
			JSON.stringify(left).localeCompare(JSON.stringify(right)),
		),
	};
	validateArtifactTopology(result);
	return result;

	function projectJsonSections(): void {
		const parser = new JsonParserProvider();
		for (const source of sourceInputs) {
			if (!isJsonEntrypoint(source.path)) continue;
			const parsed = parser.parse(source);
			if (!parsed.ok) {
				addReason(
					source.path,
					"unsupported",
					"JSON entrypoint could not be parsed",
				);
				continue;
			}
			if (parsed.document.diagnostics.length > 0) {
				addReason(
					source.path,
					"unsupported",
					"JSON entrypoint contains parser diagnostics",
				);
			}
			for (const section of sectionTypeNodes(parsed.document)) {
				const targetPath = `sections/${section.value}.liquid`;
				addReference({
					kind: "section",
					ownerPath: source.path,
					targetPath,
					range: section.range,
					relationKind: "INCLUDES",
					fromPath: source.path,
					toPath: targetPath,
				});
			}
		}
	}

	function projectLiquidIncludes(): void {
		for (const relation of input.snapshot.relations) {
			if (relation.kind !== "shopify.invokes") continue;
			const operation = occurrencesById.get(relation.from);
			const owner = operation?.ownerId
				? entitiesById.get(operation.ownerId)
				: undefined;
			const snippet = entitiesById.get(relation.to);
			const ownerPath = owner?.path;
			const targetPath =
				typeof snippet?.attributes.path === "string"
					? snippet.attributes.path
					: snippet?.path;
			if (!ownerPath || !targetPath) continue;
			const evidence = operation?.assertion.evidence[0];
			addReference({
				kind: "snippet",
				ownerPath,
				targetPath,
				range: evidence?.range,
				relationKind: "INCLUDES",
				fromPath: ownerPath,
				toPath: targetPath,
				certainty: "inferred",
				basis: "convention",
			});
		}
		for (const occurrence of input.snapshot.occurrences) {
			if (
				occurrence.kind !== "shopify.render-site" ||
				occurrence.attributes.targetKind !== "dynamic"
			) {
				continue;
			}
			const owner = occurrence.ownerId
				? entitiesById.get(occurrence.ownerId)
				: undefined;
			if (!owner?.path) continue;
			addReference({
				kind: "snippet",
				ownerPath: owner.path,
				expression: String(occurrence.attributes.target ?? "dynamic"),
				range: occurrence.assertion.evidence[0]?.range,
			});
		}
	}

	function projectLiquidAssets(): void {
		const assetOccurrences = input.snapshot.occurrences.filter(
			(occurrence) => occurrence.kind === "shopify.asset-reference-site",
		);
		const attached = new Set<string>();
		for (const occurrence of assetOccurrences) {
			const syntax = String(occurrence.attributes.syntax ?? "");
			if (
				syntax !== "stylesheet-tag-filter" &&
				syntax !== "script-tag-filter" &&
				syntax !== "inline-asset-content-filter"
			) {
				continue;
			}
			projectAssetOccurrence(occurrence, true);
			if (occurrence.attributes.referenceKind === "literal") {
				attached.add(
					`${occurrence.ownerId ?? "unknown"}\0${String(occurrence.attributes.reference)}`,
				);
			}
		}
		for (const occurrence of assetOccurrences) {
			if (occurrence.attributes.syntax !== "asset-url-filter") continue;
			const reference = String(occurrence.attributes.reference ?? "dynamic");
			if (attached.has(`${occurrence.ownerId ?? "unknown"}\0${reference}`)) {
				continue;
			}
			const scriptSource = input.snapshot.occurrences.some((candidate) => {
				if (
					candidate.kind !== "shopify.markup-attribute-site" ||
					candidate.ownerId !== occurrence.ownerId ||
					candidate.attributes.element !== "script" ||
					candidate.attributes.name !== "src"
				) {
					return false;
				}
				const attributeRange = candidate.assertion.evidence[0]?.range;
				const assetRange = occurrence.assertion.evidence[0]?.range;
				return (
					attributeRange !== undefined &&
					assetRange !== undefined &&
					attributeRange.start <= assetRange.start &&
					attributeRange.end >= assetRange.end
				);
			});
			if (scriptSource) {
				projectAssetOccurrence(occurrence, true);
				continue;
			}
			if (/\.(?:css|js)$/i.test(reference)) {
				projectAssetOccurrence(occurrence, false);
				const owner = occurrence.ownerId
					? entitiesById.get(occurrence.ownerId)
					: undefined;
				if (owner?.path) {
					addReason(
						owner.path,
						"unsupported",
						"Executable asset_url reference has unsupported attachment context",
					);
				}
			}
		}

		function projectAssetOccurrence(
			occurrence: (typeof assetOccurrences)[number],
			attach: boolean,
		): void {
			const owner = occurrence.ownerId
				? entitiesById.get(occurrence.ownerId)
				: undefined;
			if (!owner?.path) return;
			const range = occurrence.assertion.evidence[0]?.range;
			const authoredSource = sourceByPath.get(owner.path)?.source;
			const authoredReference =
				authoredSource && range
					? authoredSource.slice(range.start, range.end)
					: "";
			if (authoredReference.includes("shopify_asset_url")) {
				addReference({
					kind: "asset",
					ownerPath: owner.path,
					expression: String(occurrence.attributes.reference ?? "external"),
					range,
					resolution: "external-data-required",
				});
				return;
			}
			if (occurrence.attributes.referenceKind !== "literal") {
				addReference({
					kind: "asset",
					ownerPath: owner.path,
					expression: String(occurrence.attributes.reference ?? "dynamic"),
					range,
				});
				return;
			}
			const reference = String(occurrence.attributes.reference);
			const targetPath = reference.startsWith("assets/")
				? reference
				: `assets/${reference}`;
			addReference({
				kind: "asset",
				ownerPath: owner.path,
				targetPath,
				range,
				...(attach
					? {
							relationKind: "ATTACHED_TO" as const,
							fromPath: targetPath,
							toPath: owner.path,
						}
					: {}),
			});
		}
	}

	function projectDefaultLayouts(): void {
		const layoutPath = "layout/theme.liquid";
		if (!artifactByPath.has(layoutPath)) return;
		for (const source of sourceInputs) {
			if (!isJsonEntrypoint(source.path)) continue;
			addReference({
				kind: "layout",
				ownerPath: source.path,
				targetPath: layoutPath,
				range: { start: 0, end: 0 },
				relationKind: "ATTACHED_TO",
				fromPath: source.path,
				toPath: layoutPath,
				certainty: "inferred",
				basis: "convention",
			});
		}
	}
}

function projectReachability(
	revisionId: string,
	artifactByPath: ReadonlyMap<string, ArtifactTopologyArtifact>,
	directRelations: ReadonlyMap<string, ArtifactTopologyRelation>,
	sources: ReadonlyMap<string, ArtifactTopologySource>,
	coverageReasons: Map<string, { code: string; message: string }[]>,
	limits: ArtifactTopologyLimits,
): {
	relations: ArtifactTopologyRelation[];
	coverage: ArtifactTopologyCoverage[];
} {
	const relations: ArtifactTopologyRelation[] = [];
	const coverage: ArtifactTopologyCoverage[] = [];
	const includes = [...directRelations.values()].filter(
		(relation) => relation.kind === "INCLUDES",
	);
	const attachments = [...directRelations.values()].filter(
		(relation) => relation.kind === "ATTACHED_TO",
	);
	const artifactByRef = new Map(
		[...artifactByPath.values()].map((artifact) => [artifact.ref, artifact]),
	);
	const entrypoints = [...artifactByPath.values()].filter((artifact) =>
		isJsonEntrypoint(artifact.path),
	);
	for (const entrypoint of entrypoints) {
		const queue: Array<{
			artifact: ArtifactTopologyArtifact;
			depth: number;
			via: string[];
		}> = [{ artifact: entrypoint, depth: 0, via: [] }];
		const seen = new Set([entrypoint.ref]);
		let partial = false;
		let work = 0;
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) break;
			if (current.depth >= limits.maxDepth) {
				partial = true;
				continue;
			}
			const neighbors: Array<{
				ref: string;
				relation: ArtifactTopologyRelation;
			}> = [];
			for (const relation of includes) {
				if (relation.from === current.artifact.ref) {
					neighbors.push({ ref: relation.to, relation });
				}
			}
			for (const relation of attachments) {
				if (relation.from === current.artifact.ref) {
					neighbors.push({ ref: relation.to, relation });
				} else if (relation.to === current.artifact.ref) {
					neighbors.push({ ref: relation.from, relation });
				}
			}
			neighbors.sort((left, right) => left.ref.localeCompare(right.ref));
			for (const neighbor of neighbors) {
				work += 1;
				if (work > limits.maxWork || relations.length >= limits.maxRelations) {
					partial = true;
					break;
				}
				if (seen.has(neighbor.ref)) continue;
				const artifact = artifactByRef.get(neighbor.ref);
				if (!artifact) continue;
				seen.add(neighbor.ref);
				const via = [...current.via, neighbor.relation.ref];
				const evidence = unique(
					via.flatMap(
						(ref) => directRelations.get(ref)?.assertion.evidence ?? [],
					),
				).slice(0, limits.maxEvidencePerReachability);
				relations.push({
					ref: relationRef(
						revisionId,
						"REACHABLE_FROM",
						artifact.path,
						entrypoint.path,
					),
					kind: "REACHABLE_FROM",
					from: artifact.ref,
					to: entrypoint.ref,
					assertion: {
						certainty: "inferred",
						basis: "bounded-analysis",
						evidence: evidence.filter((ref) => sources.has(ref)),
					},
					attributes: { depth: current.depth + 1 },
					via,
				});
				queue.push({ artifact, depth: current.depth + 1, via });
			}
			if (partial) break;
		}
		const reasons = uniqueReasons(
			[...seen].flatMap((ref) => {
				const path = artifactByRef.get(ref)?.path;
				return path ? (coverageReasons.get(path) ?? []) : [];
			}),
		);
		if (partial) {
			reasons.push({
				code: "budget",
				message: "Artifact reachability budget or depth exhausted",
			});
			coverageReasons.set(entrypoint.path, reasons);
		}
		const status: CoverageStatus =
			partial ||
			reasons.some(({ code }) =>
				["budget", "unsupported", "partial-scope"].includes(code),
			)
				? "partial"
				: reasons.some(({ code }) => code === "external-data-required")
					? "external-data-required"
					: reasons.some(({ code }) => code === "runtime-dependent")
						? "runtime-dependent"
						: "complete";
		coverage.push({
			family: "shopify.artifact-reachability",
			status,
			scope: { artifacts: [entrypoint.ref] },
			...(reasons.length > 0 ? { reasons } : {}),
		});
	}
	return { relations, coverage };
}

export function validateArtifactTopology(
	snapshot: ArtifactTopologySnapshot,
): void {
	if (snapshot.contractVersion !== ARTIFACT_TOPOLOGY_VERSION) {
		throw new Error(
			`Expected artifact topology version ${ARTIFACT_TOPOLOGY_VERSION}, got ${String(snapshot.contractVersion)}`,
		);
	}
	const refs = new Set(snapshot.artifacts.map(({ ref }) => ref));
	const sourceRefs = new Set(snapshot.sources.map(({ ref }) => ref));
	const relationRefs = new Set(snapshot.relations.map(({ ref }) => ref));
	if (refs.size !== snapshot.artifacts.length)
		throw new Error("Duplicate topology artifact ref");
	if (relationRefs.size !== snapshot.relations.length)
		throw new Error("Duplicate topology relation ref");
	for (const source of snapshot.sources) {
		if (!refs.has(source.artifact))
			throw new Error(`${source.ref} references missing artifact`);
	}
	for (const relation of snapshot.relations) {
		if (!refs.has(relation.from) || !refs.has(relation.to)) {
			throw new Error(`${relation.ref} references missing artifact`);
		}
		for (const evidence of relation.assertion.evidence) {
			if (!sourceRefs.has(evidence))
				throw new Error(`${relation.ref} references missing source`);
		}
		for (const via of relation.via ?? []) {
			if (!relationRefs.has(via))
				throw new Error(`${relation.ref} references missing relation`);
		}
	}
	for (const reference of snapshot.references) {
		if (!refs.has(reference.owner))
			throw new Error(`${reference.ref} references missing owner`);
		if (reference.source && !sourceRefs.has(reference.source)) {
			throw new Error(`${reference.ref} references missing source`);
		}
		if (reference.relation && !relationRefs.has(reference.relation)) {
			throw new Error(`${reference.ref} references missing relation`);
		}
	}
}

export type CompactClassLifecycle = {
	entrypoint: { path: string; ref: string };
	symbol: { kind: "css.class"; name: string };
	candidate: boolean;
	reachableArtifacts: number;
	uses: {
		total: number;
		returned: number;
		truncated: boolean;
		artifacts: number;
		items: readonly {
			ref: string;
			path: string;
			offset: number;
			role: string;
			evaluation: FactOntologyFact["evaluation"];
		}[];
	};
	page: { nextCursor?: string };
	roles: readonly { role: string; uses: number }[];
	excludedSameNameArtifacts: readonly string[];
	coverage: {
		topology: CoverageStatus;
		semantic: CoverageStatus;
		reasons?: readonly { code: string; message: string }[];
	};
};

export class ArtifactTopologyQuery {
	readonly #artifactByPath: ReadonlyMap<string, ArtifactTopologyArtifact>;

	constructor(readonly snapshot: ArtifactTopologySnapshot) {
		this.#artifactByPath = new Map(
			snapshot.artifacts.map((artifact) => [artifact.path, artifact]),
		);
	}

	referencesFrom(path: string): readonly ArtifactTopologyReference[] {
		const artifact = this.#artifactByPath.get(path);
		if (!artifact) throw new Error(`Artifact not found: ${path}`);
		return this.snapshot.references.filter(
			(reference) => reference.owner === artifact.ref,
		);
	}

	classLifecycle(
		facts: FactOntologySnapshot,
		entrypointPath: string,
		className: string,
		options: { limit?: number; cursor?: string } = {},
	): CompactClassLifecycle {
		if (
			facts.revision.id !== this.snapshot.revision.id ||
			facts.revision.repositoryFingerprint !==
				this.snapshot.revision.repositoryFingerprint
		) {
			throw new Error("Fact snapshot and artifact topology revisions differ");
		}
		const limit = options.limit ?? 50;
		if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
			throw new Error("Class lifecycle limit must be an integer from 1 to 200");
		}
		const offset = options.cursor
			? decodeLifecycleCursor(
					options.cursor,
					facts.revision.id,
					entrypointPath,
					className,
				)
			: 0;
		const entrypoint = this.#artifactByPath.get(entrypointPath);
		if (!entrypoint) throw new Error(`Artifact not found: ${entrypointPath}`);
		const reachable = new Set<string>([entrypoint.ref]);
		for (const relation of this.snapshot.relations) {
			if (
				relation.kind === "REACHABLE_FROM" &&
				relation.to === entrypoint.ref
			) {
				reachable.add(relation.from);
			}
		}
		const factArtifactByRef = new Map(
			facts.artifacts.map((artifact) => [artifact.ref, artifact]),
		);
		const operations = new Map(
			facts.operations.map((operation) => [operation.ref, operation]),
		);
		const symbols = facts.symbols.filter(
			(symbol) => symbol.kind === "css.class" && symbol.name === className,
		);
		const reachableSymbols = new Set(
			symbols
				.filter(
					(symbol) => symbol.scope && reachable.has(symbol.scope.artifact),
				)
				.map(({ ref }) => ref),
		);
		const items = facts.facts
			.filter(
				(fact) =>
					fact.claim.predicate === "USES" &&
					reachableSymbols.has(fact.claim.object),
			)
			.flatMap((fact) => {
				const operation = operations.get(fact.claim.subject);
				const artifact = operation
					? factArtifactByRef.get(operation.scope.artifact)
					: undefined;
				if (!operation || !artifact) return [];
				return [
					{
						ref: fact.ref,
						path: artifact.path,
						offset: operation.scope.start ?? 0,
						role: String(fact.claim.attributes?.role ?? "uses"),
						evaluation: fact.evaluation,
					},
				];
			})
			.sort(
				(left, right) =>
					left.path.localeCompare(right.path) || left.offset - right.offset,
			);
		const roleCounts = new Map<string, number>();
		for (const item of items) {
			roleCounts.set(item.role, (roleCounts.get(item.role) ?? 0) + 1);
		}
		const excludedSameNameArtifacts = unique(
			symbols.flatMap((symbol) => {
				const artifact = symbol.scope
					? factArtifactByRef.get(symbol.scope.artifact)
					: undefined;
				return artifact && !reachable.has(artifact.ref) ? [artifact.path] : [];
			}),
		).sort();
		const topologyCoverage = this.snapshot.coverage.filter(
			(coverage) =>
				coverage.family === "shopify.artifact-reachability" &&
				coverage.scope.artifacts.includes(entrypoint.ref),
		);
		const familyLanguages: Readonly<Record<string, readonly string[]>> = {
			"shopify.markup-classes": ["liquid"],
			"shopify.class-selectors": ["css", "scss"],
			"shopify.class-list-operations": ["javascript"],
		};
		const semanticCoverage = facts.coverage.filter((coverage) => {
			const languages = familyLanguages[coverage.family];
			if (!languages) return false;
			return (coverage.scope.artifacts ?? []).some((artifactRef) => {
				const artifact = factArtifactByRef.get(artifactRef);
				return (
					artifact !== undefined &&
					reachable.has(artifactRef) &&
					artifact.language !== undefined &&
					languages.includes(artifact.language)
				);
			});
		});
		const reasons = uniqueReasons([
			...topologyCoverage.flatMap((coverage) => coverage.reasons ?? []),
			...semanticCoverage.flatMap((coverage) => coverage.reasons ?? []),
		]);
		const itemLanguages = new Set(
			items.flatMap(({ path }) => {
				const language = facts.artifacts.find(
					(artifact) => artifact.path === path,
				)?.language;
				return language ? [language] : [];
			}),
		);
		if (offset > items.length) {
			throw new Error("Class lifecycle cursor is out of range");
		}
		const returnedItems = items.slice(offset, offset + limit);
		const nextOffset = offset + returnedItems.length;
		return {
			entrypoint: { path: entrypoint.path, ref: entrypoint.ref },
			symbol: { kind: "css.class", name: className },
			candidate: itemLanguages.size > 1,
			reachableArtifacts: reachable.size,
			uses: {
				total: items.length,
				returned: returnedItems.length,
				truncated: nextOffset < items.length,
				artifacts: new Set(items.map(({ path }) => path)).size,
				items: returnedItems,
			},
			page: {
				...(nextOffset < items.length
					? {
							nextCursor: encodeLifecycleCursor(
								facts.revision.id,
								entrypointPath,
								className,
								nextOffset,
							),
						}
					: {}),
			},
			roles: [...roleCounts.entries()]
				.map(([role, uses]) => ({ role, uses }))
				.sort(
					(left, right) =>
						right.uses - left.uses || left.role.localeCompare(right.role),
				),
			excludedSameNameArtifacts,
			coverage: {
				topology: worstCoverage(topologyCoverage.map(({ status }) => status)),
				semantic: worstCoverage(semanticCoverage.map(({ status }) => status)),
				...(reasons.length > 0 ? { reasons } : {}),
			},
		};
	}
}

function sectionTypeNodes(
	document: JsonDocument,
): Array<{ value: string; range: SourceRange }> {
	const root = document.syntax;
	if (root.type !== "object") return [];
	const sectionsProperty = (root.children ?? []).find(
		(property) =>
			property.type === "property" &&
			property.children?.[0]?.value === "sections",
	);
	const sections = sectionsProperty?.children?.[1];
	if (sections?.type !== "object") return [];
	const result: Array<{ value: string; range: SourceRange }> = [];
	for (const property of sections.children ?? []) {
		const section = property.children?.[1];
		if (section?.type !== "object") continue;
		const typeProperty = (section.children ?? []).find(
			(candidate) =>
				candidate.type === "property" &&
				candidate.children?.[0]?.value === "type",
		);
		const value = typeProperty?.children?.[1];
		if (value?.type === "string" && typeof value.value === "string") {
			result.push({
				value: value.value,
				range: { start: value.offset, end: value.offset + value.length },
			});
		}
	}
	return result;
}

function isJsonEntrypoint(path: string): boolean {
	return /^templates\/[^/]+\.json$/.test(path);
}

function fingerprintSources(
	sources: readonly SemanticCompilerSource[],
): string {
	const hash = createHash("sha256");
	for (const source of sources) {
		hash.update(
			JSON.stringify([source.path, source.language ?? null, source.source]),
		);
	}
	return `sha256:${hash.digest("hex")}`;
}

function artifactRef(path: string): string {
	return `artifact:${escapeRef(path)}`;
}

function relationRef(
	revisionId: string,
	kind: ArtifactTopologyRelation["kind"],
	fromPath: string,
	toPath: string,
): string {
	return `topology:${revisionHash(revisionId)}:${kind.toLowerCase()}:${shortHash(`${fromPath}\0${toPath}`)}`;
}

function revisionHash(revisionId: string): string {
	return shortHash(revisionId).slice(0, 12);
}

function escapeRef(value: string): string {
	return encodeURIComponent(value).replaceAll("%", "~");
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function encodeLifecycleCursor(
	revisionId: string,
	entrypointPath: string,
	className: string,
	offset: number,
): string {
	return Buffer.from(
		JSON.stringify({
			version: 1,
			revisionId,
			entrypointPath,
			className,
			offset,
		}),
	).toString("base64url");
}

function decodeLifecycleCursor(
	cursor: string,
	revisionId: string,
	entrypointPath: string,
	className: string,
): number {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw new Error("Invalid class lifecycle cursor");
	}
	if (
		typeof value !== "object" ||
		value === null ||
		!("version" in value) ||
		value.version !== 1 ||
		!("revisionId" in value) ||
		value.revisionId !== revisionId ||
		!("entrypointPath" in value) ||
		value.entrypointPath !== entrypointPath ||
		!("className" in value) ||
		value.className !== className ||
		!("offset" in value) ||
		typeof value.offset !== "number" ||
		!Number.isInteger(value.offset) ||
		value.offset < 0
	) {
		throw new Error("Invalid or stale class lifecycle cursor");
	}
	return value.offset;
}

function unique<Value>(values: readonly Value[]): Value[] {
	return [...new Set(values)];
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
