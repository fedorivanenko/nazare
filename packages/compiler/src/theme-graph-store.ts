import { isDeepStrictEqual } from "node:util";
import { compareCanonicalStrings } from "./canonical-order.js";
import type {
	InspectNazareThemeResult,
	ThemeSemanticModel,
} from "./theme-facts.js";

type ThemeGraphNode = InspectNazareThemeResult["nodes"][number];
type ThemeGraphEdge = InspectNazareThemeResult["edges"][number];

export const THEME_GRAPH_METAFIELD_SCHEMA_OWNER = "projection:metafield-schema";

const NON_OWNING_SEMANTIC_MODEL_KEYS = new Set<keyof ThemeSemanticModel>([
	"version",
	"root",
	"metafieldSchema",
	"themeCheck",
	"issues",
]);

export type ThemeGraphStoreDelta = {
	addedNodeIds: string[];
	removedNodeIds: string[];
	changedNodeIds: string[];
	addedEdgeIds: string[];
	removedEdgeIds: string[];
	changedEdgeIds: string[];
};

export class ThemeGraphStore {
	private readonly nodesById = new Map<string, ThemeGraphNode>();
	private readonly edgesById = new Map<string, ThemeGraphEdge>();
	private readonly nodeIdsBySemanticId = new Map<string, Set<string>>();
	private readonly semanticIdsByNodeId = new Map<string, Set<string>>();
	private readonly edgeIdsBySemanticId = new Map<string, Set<string>>();
	private readonly semanticIdsByEdgeId = new Map<string, Set<string>>();
	private graph: InspectNazareThemeResult;
	private ownershipIsCurrent = false;

	constructor(graph: InspectNazareThemeResult) {
		validateGraphRecords(graph);
		this.graph = graph;
		for (const node of graph.nodes) this.nodesById.set(node.id, node);
		for (const edge of graph.edges) this.edgesById.set(edge.id, edge);
	}

	fork(): ThemeGraphStore {
		const fork = new ThemeGraphStore(this.graph);
		fork.nodesById.clear();
		fork.edgesById.clear();
		for (const [id, node] of this.nodesById) fork.nodesById.set(id, node);
		for (const [id, edge] of this.edgesById) fork.edgesById.set(id, edge);
		copySetMap(this.nodeIdsBySemanticId, fork.nodeIdsBySemanticId);
		copySetMap(this.semanticIdsByNodeId, fork.semanticIdsByNodeId);
		copySetMap(this.edgeIdsBySemanticId, fork.edgeIdsBySemanticId);
		copySetMap(this.semanticIdsByEdgeId, fork.semanticIdsByEdgeId);
		fork.ownershipIsCurrent = this.ownershipIsCurrent;
		return fork;
	}

	expandSemanticIds(semanticIds: Iterable<string>): Set<string> {
		this.assertCurrentOwnership();
		const expanded = new Set(semanticIds);
		const pending = [...expanded];
		for (let index = 0; index < pending.length; index += 1) {
			const semanticId = pending[index];
			if (semanticId === undefined) {
				throw new Error(`Missing semantic ownership queue item at ${index}`);
			}
			for (const nodeId of this.nodeIdsBySemanticId.get(semanticId) ?? []) {
				addNewValues(
					expanded,
					pending,
					this.semanticIdsByNodeId.get(nodeId) ?? [],
				);
			}
			for (const edgeId of this.edgeIdsBySemanticId.get(semanticId) ?? []) {
				addNewValues(
					expanded,
					pending,
					this.semanticIdsByEdgeId.get(edgeId) ?? [],
				);
			}
		}
		return expanded;
	}

	composeOwnedRecords(
		nodes: ThemeGraphNode[],
		edges: ThemeGraphEdge[],
		semanticIds: Iterable<string>,
	): { nodes: ThemeGraphNode[]; edges: ThemeGraphEdge[] } {
		this.assertCurrentOwnership();
		uniqueRecordIds(nodes, "composed graph node");
		uniqueRecordIds(edges, "composed graph edge");
		const selected = this.expandSemanticIds(semanticIds);
		const nodesById = new Map(this.nodesById);
		const edgesById = new Map(this.edgesById);
		for (const semanticId of selected) {
			for (const id of this.getOwnedNodeIds(semanticId)) {
				if (!hasUnselectedOwner(this.semanticIdsByNodeId, id, selected)) {
					nodesById.delete(id);
				}
			}
			for (const id of this.getOwnedEdgeIds(semanticId)) {
				if (!hasUnselectedOwner(this.semanticIdsByEdgeId, id, selected)) {
					edgesById.delete(id);
				}
			}
		}
		for (const node of nodes) nodesById.set(node.id, node);
		for (const edge of edges) edgesById.set(edge.id, edge);
		return {
			nodes: [...nodesById.values()],
			edges: [...edgesById.values()],
		};
	}

	applyGraph(graph: InspectNazareThemeResult): ThemeGraphStoreDelta {
		validateGraphRecords(graph);
		const nextNodes = new Map(graph.nodes.map((node) => [node.id, node]));
		const nextEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
		const nodeDelta = recordDelta(this.nodesById, nextNodes);
		const edgeDelta = recordDelta(this.edgesById, nextEdges);
		for (const id of nodeDelta.removed) this.nodesById.delete(id);
		for (const id of [...nodeDelta.added, ...nodeDelta.changed]) {
			const node = nextNodes.get(id);
			if (!node)
				throw new Error(`Graph node delta references missing node ${id}`);
			this.nodesById.set(id, node);
		}
		for (const id of edgeDelta.removed) this.edgesById.delete(id);
		for (const id of [...edgeDelta.added, ...edgeDelta.changed]) {
			const edge = nextEdges.get(id);
			if (!edge)
				throw new Error(`Graph edge delta references missing edge ${id}`);
			this.edgesById.set(id, edge);
		}
		this.graph = {
			...graph,
			nodes: [...this.nodesById.values()].sort((a, b) =>
				compareCanonicalStrings(a.id, b.id),
			),
			edges: [...this.edgesById.values()].sort((a, b) =>
				compareCanonicalStrings(a.id, b.id),
			),
			issues: sameRecord(this.graph.issues, graph.issues)
				? this.graph.issues
				: graph.issues,
			metafields: sameRecord(this.graph.metafields, graph.metafields)
				? this.graph.metafields
				: graph.metafields,
			themeCheck: sameRecord(this.graph.themeCheck, graph.themeCheck)
				? this.graph.themeCheck
				: graph.themeCheck,
		};
		if (
			nodeDelta.added.length > 0 ||
			nodeDelta.removed.length > 0 ||
			nodeDelta.changed.length > 0 ||
			edgeDelta.added.length > 0 ||
			edgeDelta.removed.length > 0 ||
			edgeDelta.changed.length > 0
		) {
			this.ownershipIsCurrent = false;
		}
		return {
			addedNodeIds: nodeDelta.added,
			removedNodeIds: nodeDelta.removed,
			changedNodeIds: nodeDelta.changed,
			addedEdgeIds: edgeDelta.added,
			removedEdgeIds: edgeDelta.removed,
			changedEdgeIds: edgeDelta.changed,
		};
	}

	replaceOwnership(model: ThemeSemanticModel): void {
		const semanticIds = semanticRecordIds(model);
		this.nodeIdsBySemanticId.clear();
		this.semanticIdsByNodeId.clear();
		this.edgeIdsBySemanticId.clear();
		this.semanticIdsByEdgeId.clear();
		for (const node of this.nodesById.values()) {
			if (node.kind === "storeSchema") {
				addOwnership(
					this.nodeIdsBySemanticId,
					this.semanticIdsByNodeId,
					THEME_GRAPH_METAFIELD_SCHEMA_OWNER,
					node.id,
				);
			}
			if (semanticIds.has(node.id)) {
				addOwnership(
					this.nodeIdsBySemanticId,
					this.semanticIdsByNodeId,
					node.id,
					node.id,
				);
			}
		}
		for (const edge of this.edgesById.values()) {
			const owners = new Set<string>();
			if (semanticIds.has(edge.from)) owners.add(edge.from);
			if (semanticIds.has(edge.to)) owners.add(edge.to);
			if ("evidenceIds" in edge && edge.evidenceIds !== undefined) {
				for (const evidenceId of edge.evidenceIds) {
					if (semanticIds.has(evidenceId)) owners.add(evidenceId);
				}
			}
			for (const owner of owners) {
				addOwnership(
					this.edgeIdsBySemanticId,
					this.semanticIdsByEdgeId,
					owner,
					edge.id,
				);
				this.addDerivedEndpointOwnership(owner, edge);
			}
		}
		for (const edge of this.edgesById.values()) {
			const owners = new Set([
				...(this.semanticIdsByNodeId.get(edge.from) ?? []),
				...(this.semanticIdsByNodeId.get(edge.to) ?? []),
			]);
			for (const owner of owners) {
				addOwnership(
					this.edgeIdsBySemanticId,
					this.semanticIdsByEdgeId,
					owner,
					edge.id,
				);
				this.addDerivedEndpointOwnership(owner, edge);
			}
		}
		this.ownershipIsCurrent = true;
	}

	getOwnedNodeIds(semanticId: string): string[] {
		this.assertCurrentOwnership();
		return [...(this.nodeIdsBySemanticId.get(semanticId) ?? [])].sort();
	}

	getOwnedEdgeIds(semanticId: string): string[] {
		this.assertCurrentOwnership();
		return [...(this.edgeIdsBySemanticId.get(semanticId) ?? [])].sort();
	}

	private addDerivedEndpointOwnership(
		semanticId: string,
		edge: ThemeGraphEdge,
	): void {
		for (const nodeId of [edge.from, edge.to]) {
			const node = this.nodesById.get(nodeId);
			if (!node) {
				throw new Error(
					`Graph edge ${edge.id} references missing node ${nodeId}`,
				);
			}
			if (isOwnerDerivedNode(node)) {
				addOwnership(
					this.nodeIdsBySemanticId,
					this.semanticIdsByNodeId,
					semanticId,
					nodeId,
				);
			}
		}
	}

	private assertCurrentOwnership(): void {
		if (!this.ownershipIsCurrent) {
			throw new Error(
				"Theme graph ownership is unavailable; call replaceOwnership() after changing graph records",
			);
		}
	}

	getGraph(): InspectNazareThemeResult {
		return this.graph;
	}

	getNode(id: string): ThemeGraphNode | undefined {
		return this.nodesById.get(id);
	}

	getEdge(id: string): ThemeGraphEdge | undefined {
		return this.edgesById.get(id);
	}
}

function uniqueRecordIds(
	records: Array<{ id: string }>,
	recordKind: string,
): Set<string> {
	const ids = new Set<string>();
	for (const record of records) {
		if (typeof record.id !== "string" || record.id.length === 0) {
			throw new Error(`${recordKind} has an invalid id`);
		}
		if (ids.has(record.id)) {
			throw new Error(`Duplicate ${recordKind} id ${record.id}`);
		}
		ids.add(record.id);
	}
	return ids;
}

function validateGraphRecords(graph: InspectNazareThemeResult): void {
	const nodeIds = uniqueRecordIds(graph.nodes, "graph node");
	uniqueRecordIds(graph.edges, "graph edge");
	for (const edge of graph.edges) {
		if (!nodeIds.has(edge.from)) {
			throw new Error(
				`Graph edge ${edge.id} has missing from node ${edge.from}`,
			);
		}
		if (!nodeIds.has(edge.to)) {
			throw new Error(`Graph edge ${edge.id} has missing to node ${edge.to}`);
		}
		validateEvidenceIds(edge, `Graph edge ${edge.id}`);
	}
	for (const node of graph.nodes) {
		validateEvidenceIds(node, `Graph node ${node.id}`);
	}
}

function validateEvidenceIds(record: object, owner: string): void {
	if (!("evidenceIds" in record) || record.evidenceIds === undefined) return;
	if (!Array.isArray(record.evidenceIds)) {
		throw new Error(`${owner} evidenceIds must be an array`);
	}
	for (const evidenceId of record.evidenceIds) {
		if (typeof evidenceId !== "string") {
			throw new Error(`${owner} has a non-string evidence id`);
		}
	}
}

function semanticRecordIds(model: ThemeSemanticModel): Set<string> {
	const ids = new Set<string>();
	for (const [key, value] of Object.entries(model)) {
		if (NON_OWNING_SEMANTIC_MODEL_KEYS.has(key as keyof ThemeSemanticModel))
			continue;
		if (!Array.isArray(value)) {
			throw new Error(`Semantic model field ${key} must be a record array`);
		}
		for (const record of value) {
			if (
				record === null ||
				typeof record !== "object" ||
				!("id" in record) ||
				typeof record.id !== "string" ||
				record.id.length === 0
			) {
				throw new Error(
					`Semantic model field ${key} contains a record without an id`,
				);
			}
			ids.add(record.id);
		}
	}
	return ids;
}

function isOwnerDerivedNode(node: ThemeGraphNode): boolean {
	return (
		node.kind === "unresolved" ||
		node.kind === "shopifyObject" ||
		node.kind === "shopifyProperty" ||
		node.kind === "domHook" ||
		node.kind === "customProperty" ||
		node.kind === "customEvent" ||
		node.kind === "customElement" ||
		node.kind === "sourceAnalysis"
	);
}

function hasUnselectedOwner(
	semanticIdsByGraphId: Map<string, Set<string>>,
	graphId: string,
	selected: Set<string>,
): boolean {
	for (const semanticId of semanticIdsByGraphId.get(graphId) ?? []) {
		if (!selected.has(semanticId)) return true;
	}
	return false;
}

function addOwnership(
	graphIdsBySemanticId: Map<string, Set<string>>,
	semanticIdsByGraphId: Map<string, Set<string>>,
	semanticId: string,
	graphId: string,
): void {
	addToSetMap(graphIdsBySemanticId, semanticId, graphId);
	addToSetMap(semanticIdsByGraphId, graphId, semanticId);
}

function addToSetMap(
	map: Map<string, Set<string>>,
	key: string,
	value: string,
): void {
	const values = map.get(key);
	if (values) values.add(value);
	else map.set(key, new Set([value]));
}

function addNewValues(
	collected: Set<string>,
	pending: string[],
	values: Iterable<string>,
): void {
	for (const value of values) {
		if (collected.has(value)) continue;
		collected.add(value);
		pending.push(value);
	}
}

function copySetMap(
	source: Map<string, Set<string>>,
	target: Map<string, Set<string>>,
): void {
	for (const [key, values] of source) target.set(key, new Set(values));
}

function recordDelta<T>(
	previous: Map<string, T>,
	next: Map<string, T>,
): { added: string[]; removed: string[]; changed: string[] } {
	return {
		added: [...next.keys()].filter((id) => !previous.has(id)).sort(),
		removed: [...previous.keys()].filter((id) => !next.has(id)).sort(),
		changed: [...next.keys()]
			.filter(
				(id) => previous.has(id) && !sameRecord(previous.get(id), next.get(id)),
			)
			.sort(),
	};
}

function sameRecord(a: unknown, b: unknown): boolean {
	return a === b || isDeepStrictEqual(a, b);
}
