import {
	classifyShopifyFile,
	type ShopifyBehavior,
	type ShopifyEvidence,
	type ShopifyMetafieldRead,
	type ShopifyProjectModelResult,
	type ShopifyRenderGraph,
} from "@nazare/target-shopify";
import {
	INSPECTION_PUBLIC_CONTRACT_VERSION,
	type InspectionPublicGraph,
	type PublicEntity,
	type PublicEvidence,
	type PublicFinding,
	type PublicRelation,
	type RelationKind,
} from "./inspection-public-contract.js";
import type {
	ShopifyInspection,
	ShopifyQuerySession,
} from "./shopify-query-session.js";

const PROJECT_ID = "project:theme";
const PAGE_ROLES = new Set(["templateJson", "templateLiquid"]);
const RENDER_ROLES = new Set([
	"section",
	"sectionGroup",
	"snippet",
	"themeBlock",
	"templateJson",
	"templateLiquid",
	"layout",
	"nazareComponent",
]);

export async function inspectionPublicGraph(
	session: ShopifyQuerySession,
): Promise<InspectionPublicGraph> {
	const [model, graphResult, behaviorIndex, metafieldIndex, inspection] =
		await Promise.all([
			session.projectModel(),
			session.projectGraph(),
			session.behaviorIndex({ behaviorKind: null }),
			session.metafieldIndex({ ownerType: null, namespace: null }),
			session.inspection(),
		]);
	const entities = new Map<string, PublicEntity>();
	const relations = new Map<string, PublicRelation>();
	const evidence = model.evidence.map(projectEvidence);
	const evidenceByFact = indexEvidenceByFact(model.evidence);

	addEntity(entities, {
		id: PROJECT_ID,
		kind: "project",
		name: "theme",
		identity: { name: "theme" },
		attributes: {
			fileCount: graphResult.graph.nodes.length,
			declarationCount: model.declarations.length,
			referenceCount: model.references.length,
			behaviorOccurrenceCount: behaviorIndex.records.length,
			metafieldReadCount: metafieldIndex.records.length,
			diagnosticCount: inspection.issues.length,
			uncertaintyCount: new Set([
				...model.uncertainty,
				...inspection.uncertainty,
			]).size,
		},
	});
	const classificationsByPath = new Map(
		model.classifications.map((classification) => [
			classification.file.path,
			classification,
		]),
	);
	for (const file of graphResult.graph.nodes) {
		const role = classifyShopifyFile(file.path);
		const classification = classificationsByPath.get(file.path);
		const id = fileId(file.path);
		addEntity(entities, {
			id,
			kind: "file",
			name: file.path.split("/").at(-1) ?? file.path,
			path: file.path,
			subtype: role,
			...(PAGE_ROLES.has(role) ? { roles: ["page"] } : {}),
			identity: { path: file.path },
			...(classification
				? {
						attributes: {
							classes: classification.classes,
							evidenceIds: classification.evidenceIds,
							uncertainty: classification.uncertainty,
						},
					}
				: {}),
		});
		addRelation(relations, {
			id: `public:contains:${id}`,
			kind: "contains",
			category: "ownership",
			from: PROJECT_ID,
			to: id,
			derivation: "direct",
			certainty: "proven",
		});
	}

	projectDeclarations(model, entities, relations);
	projectReferences(model, evidenceByFact, entities, relations);
	projectRenderGraph(graphResult.graph, evidenceByFact, relations);
	projectBehaviors(behaviorIndex.records, evidenceByFact, entities, relations);
	projectMetafields(
		metafieldIndex.records,
		evidenceByFact,
		entities,
		relations,
	);
	projectDiagnostics(inspection, entities, relations);

	const uncertainty = publicUncertainty(model, inspection);
	return {
		contractVersion: INSPECTION_PUBLIC_CONTRACT_VERSION,
		revision: session.session.snapshot().revision,
		entities: [...entities.values()].sort(compareById),
		relations: [...relations.values()].sort(compareById),
		evidence,
		completeness:
			uncertainty.length === 0
				? { status: "complete" }
				: { status: "partial", uncertainty },
	};
}

function projectDeclarations(
	model: ShopifyProjectModelResult,
	entities: Map<string, PublicEntity>,
	relations: Map<string, PublicRelation>,
): void {
	for (const declaration of model.declarations) {
		const id = `declaration:${declaration.id}`;
		addEntity(entities, {
			id,
			kind: "declaration",
			name: declaration.name,
			path: declaration.owner.path,
			subtype: declaration.role,
			identity: {
				path: declaration.owner.path,
				name: declaration.name,
				role: declaration.role,
			},
		});
		addRelation(relations, {
			id: `public:declares:${declaration.id}`,
			kind: "declares",
			category: "ownership",
			from: fileId(declaration.owner.path),
			to: id,
			derivation: "direct",
			certainty: "proven",
		});
	}
}

function projectReferences(
	model: ShopifyProjectModelResult,
	evidenceByFact: ReadonlyMap<string, readonly string[]>,
	entities: Map<string, PublicEntity>,
	relations: Map<string, PublicRelation>,
): void {
	for (const reference of model.references) {
		const id = `occurrence:${reference.id}`;
		addEntity(entities, {
			id,
			kind: "occurrence",
			name:
				reference.targetPath ?? reference.targetName ?? reference.referenceKind,
			path: reference.owner.path,
			subtype: reference.referenceKind,
			identity: {
				path: reference.owner.path,
				referenceId: reference.id,
			},
			attributes: {
				static: reference.static,
				siteId: reference.siteId,
				...(reference.targetRole ? { targetRole: reference.targetRole } : {}),
				...(reference.targetName ? { targetName: reference.targetName } : {}),
				...(reference.targetPath ? { targetPath: reference.targetPath } : {}),
				...(reference.targetRelative === undefined
					? {}
					: { targetRelative: reference.targetRelative }),
			},
		});
		addRelation(relations, {
			id: `public:contains:${id}`,
			kind: "contains",
			category: "ownership",
			from: fileId(reference.owner.path),
			to: id,
			derivation: "direct",
			certainty: "proven",
			...(evidenceByFact.get(reference.id)?.length
				? { evidenceIds: evidenceByFact.get(reference.id) }
				: {}),
		});
	}
}

function projectRenderGraph(
	graph: ShopifyRenderGraph,
	evidenceByFact: ReadonlyMap<string, readonly string[]>,
	relations: Map<string, PublicRelation>,
): void {
	for (const edge of graph.edges) {
		const targetRole = classifyShopifyFile(edge.to.path);
		addRelation(relations, {
			id: edge.id,
			kind: RENDER_ROLES.has(targetRole) ? "renders" : "references",
			category: "dependency",
			from: fileId(edge.from.path),
			to: fileId(edge.to.path),
			derivation: "direct",
			certainty: "proven",
			...(evidenceByFact.get(edge.referenceId)?.length
				? { evidenceIds: evidenceByFact.get(edge.referenceId) }
				: {}),
			attributes: {
				sourceKind: edge.kind,
				occurrenceId: `occurrence:${edge.referenceId}`,
			},
		});
	}
}

function projectBehaviors(
	records: readonly ShopifyBehavior[],
	evidenceByFact: ReadonlyMap<string, readonly string[]>,
	entities: Map<string, PublicEntity>,
	relations: Map<string, PublicRelation>,
): void {
	for (const record of records) {
		if (!isRecord(record.data)) continue;
		const subjectKind = stringValue(record.data.subjectKind);
		const name = stringValue(record.data.name);
		if (!subjectKind || !name) continue;
		const hookKind = stringValue(record.data.hookKind);
		const behaviorId = `behavior:${encodeId(subjectKind)}:${encodeId(hookKind ?? "-")}:${encodeId(name)}`;
		addEntity(entities, {
			id: behaviorId,
			kind: "behavior",
			name,
			subtype: subjectKind,
			identity: {
				subjectKind,
				...(hookKind ? { hookKind } : {}),
				name,
			},
		});

		let from = fileId(record.owner.path);
		const owner = record.data.javaScriptOwner;
		if (isRecord(owner) && typeof owner.id === "string") {
			const declarationId = `declaration:${owner.id}`;
			addEntity(entities, {
				id: declarationId,
				kind: "declaration",
				name: stringValue(owner.name) ?? stringValue(owner.kind) ?? "module",
				path: record.owner.path,
				subtype: stringValue(owner.kind) ?? "javascriptOwner",
				identity: {
					path: record.owner.path,
					ownerId: owner.id,
				},
				attributes: {
					exports: Array.isArray(owner.exports) ? owner.exports : [],
				},
			});
			addRelation(relations, {
				id: `public:declares:${owner.id}`,
				kind: "declares",
				category: "ownership",
				from,
				to: declarationId,
				derivation: "direct",
				certainty: "proven",
			});
			from = declarationId;
		}
		const operation = stringValue(record.data.operation) ?? "references";
		addRelation(relations, {
			id: `public:behavior:${record.id}`,
			kind: behaviorRelationKind(operation),
			category: "behavior",
			from,
			to: behaviorId,
			derivation: "direct",
			certainty: "proven",
			...(evidenceByFact.get(record.id)?.length
				? { evidenceIds: evidenceByFact.get(record.id) }
				: {}),
			attributes: { ...record.data, operation },
		});
	}
}

function projectMetafields(
	records: readonly ShopifyMetafieldRead[],
	evidenceByFact: ReadonlyMap<string, readonly string[]>,
	entities: Map<string, PublicEntity>,
	relations: Map<string, PublicRelation>,
): void {
	for (const record of records) {
		const staticIdentity = record.namespace && record.key && !record.dynamic;
		const id = staticIdentity
			? `data:metafield:${encodeId(record.ownerType)}:${encodeId(record.namespace ?? "")}:${encodeId(record.key ?? "")}`
			: `data:metafield-read:${record.id}`;
		const name = staticIdentity
			? `${record.ownerType}.${record.namespace}.${record.key}`
			: `${record.ownerType}.<dynamic>`;
		addEntity(entities, {
			id,
			kind: "data",
			name,
			subtype: staticIdentity ? "metafield" : "dynamicMetafieldRead",
			identity: staticIdentity
				? {
						owner: record.ownerType,
						namespace: record.namespace ?? "",
						key: record.key ?? "",
					}
				: { recordId: record.id },
			attributes: {
				dynamic: record.dynamic,
				...(record.transport ? { transport: record.transport } : {}),
				...(record.endpoint ? { endpoint: record.endpoint } : {}),
			},
		});
		addRelation(relations, {
			id: `public:metafield:${record.id}`,
			kind: "reads",
			category: "dataFlow",
			from: fileId(record.owner.path),
			to: id,
			derivation: "direct",
			certainty: record.dynamic ? "inferred" : "proven",
			...(evidenceByFact.get(record.id)?.length
				? { evidenceIds: evidenceByFact.get(record.id) }
				: {}),
		});
	}
}

function projectDiagnostics(
	inspection: ShopifyInspection,
	entities: Map<string, PublicEntity>,
	relations: Map<string, PublicRelation>,
): void {
	inspection.issues.forEach((issue, index) => {
		const path = issue.span?.file;
		const id = `diagnostic:${encodeId(issue.code)}:${encodeId(path ?? "project")}:${index}`;
		addEntity(entities, {
			id,
			kind: "diagnostic",
			name: issue.code,
			...(path ? { path } : {}),
			subtype: issue.severity,
			identity: { code: issue.code, ordinal: String(index) },
			attributes: {
				message: issue.message,
				severity: issue.severity,
				...(issue.phase ? { phase: issue.phase } : {}),
				...(issue.span ? { span: issue.span } : {}),
			},
		});
		const diagnosedEntityId = path ? fileId(path) : PROJECT_ID;
		addRelation(relations, {
			id: `public:diagnosed-by:${id}`,
			kind: "diagnosedBy",
			category: "diagnostic",
			from: entities.has(diagnosedEntityId) ? diagnosedEntityId : PROJECT_ID,
			to: id,
			derivation: "direct",
			certainty: "proven",
		});
	});
}

function publicUncertainty(
	model: ShopifyProjectModelResult,
	inspection: ShopifyInspection,
): PublicFinding[] {
	return [...new Set([...model.uncertainty, ...inspection.uncertainty])]
		.sort()
		.map((message) => ({ code: "ANALYSIS_UNCERTAINTY", message }));
}

function projectEvidence(record: ShopifyEvidence): PublicEvidence {
	return {
		id: record.id,
		path: record.owner.path,
		kind: record.kind,
		strength: record.strength,
		attributes: record.data,
	};
}

function indexEvidenceByFact(
	records: readonly ShopifyEvidence[],
): ReadonlyMap<string, readonly string[]> {
	const result = new Map<string, string[]>();
	for (const record of records) {
		if (!isRecord(record.data)) continue;
		for (const key of ["factId", "readId", "referenceId"]) {
			const value = record.data[key];
			if (typeof value !== "string") continue;
			const ids = result.get(value) ?? [];
			ids.push(record.id);
			result.set(value, ids);
		}
	}
	return result;
}

function behaviorRelationKind(operation: string): RelationKind {
	switch (operation) {
		case "defines":
			return "defines";
		case "reads":
			return "reads";
		case "mutates":
			return "writes";
		case "selects":
			return "selects";
		case "emits":
		case "dispatches":
			return "produces";
		case "uses":
		case "queries":
		case "listens":
			return "consumes";
		default:
			return "references";
	}
}

function fileId(path: string): string {
	return `file:${path}`;
}

function encodeId(value: string): string {
	return encodeURIComponent(value);
}

function addEntity(
	entities: Map<string, PublicEntity>,
	entity: PublicEntity,
): void {
	entities.set(entity.id, entity);
}

function addRelation(
	relations: Map<string, PublicRelation>,
	relation: PublicRelation,
): void {
	relations.set(relation.id, relation);
}

function compareById(left: { id: string }, right: { id: string }): number {
	return left.id.localeCompare(right.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
