import type {
	InspectNazareThemeResult,
	ThemeSemanticModel,
} from "./theme-facts.js";

type ThemeGraphNode = InspectNazareThemeResult["nodes"][number];
type ThemeGraphEdge = InspectNazareThemeResult["edges"][number];

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
	private readonly edgeIdsBySemanticId = new Map<string, Set<string>>();
	private graph: InspectNazareThemeResult;

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
		copySetMap(this.edgeIdsBySemanticId, fork.edgeIdsBySemanticId);
		return fork;
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
			if (node) this.nodesById.set(id, node);
		}
		for (const id of edgeDelta.removed) this.edgesById.delete(id);
		for (const id of [...edgeDelta.added, ...edgeDelta.changed]) {
			const edge = nextEdges.get(id);
			if (edge) this.edgesById.set(id, edge);
		}
		this.graph = {
			...graph,
			nodes: [...this.nodesById.values()].sort((a, b) =>
				a.id.localeCompare(b.id),
			),
			edges: [...this.edgesById.values()].sort((a, b) =>
				a.id.localeCompare(b.id),
			),
		};
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
		this.nodeIdsBySemanticId.clear();
		this.edgeIdsBySemanticId.clear();
		const semanticIds = semanticRecordIds(model);
		for (const node of this.nodesById.values()) {
			if (semanticIds.has(node.id)) {
				addOwnership(this.nodeIdsBySemanticId, node.id, node.id);
			}
		}
		for (const edge of this.edgesById.values()) {
			const owners = new Set<string>();
			if (semanticIds.has(edge.from)) owners.add(edge.from);
			if (semanticIds.has(edge.to)) owners.add(edge.to);
			if ("evidenceIds" in edge) {
				for (const evidenceId of edge.evidenceIds ?? []) {
					if (semanticIds.has(evidenceId)) owners.add(evidenceId);
				}
			}
			for (const owner of owners) {
				addOwnership(this.edgeIdsBySemanticId, owner, edge.id);
				for (const nodeId of [edge.from, edge.to]) {
					const node = this.nodesById.get(nodeId);
					if (node && isOwnerDerivedNode(node)) {
						addOwnership(this.nodeIdsBySemanticId, owner, nodeId);
					}
				}
			}
		}
	}

	getOwnedNodeIds(semanticId: string): string[] {
		return [...(this.nodeIdsBySemanticId.get(semanticId) ?? [])].sort();
	}

	getOwnedEdgeIds(semanticId: string): string[] {
		return [...(this.edgeIdsBySemanticId.get(semanticId) ?? [])].sort();
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

function validateGraphRecords(graph: InspectNazareThemeResult): void {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const evidenceIds = new Set(graph.evidence.map((evidence) => evidence.id));
	for (const edge of graph.edges) {
		if (!nodeIds.has(edge.from)) {
			throw new Error(
				`Graph edge ${edge.id} has missing from node ${edge.from}`,
			);
		}
		if (!nodeIds.has(edge.to)) {
			throw new Error(`Graph edge ${edge.id} has missing to node ${edge.to}`);
		}
		validateEvidenceIds(edge, evidenceIds, `Graph edge ${edge.id}`);
	}
	for (const node of graph.nodes) {
		validateEvidenceIds(node, evidenceIds, `Graph node ${node.id}`);
	}
}

function validateEvidenceIds(
	record: object,
	evidenceIds: Set<string>,
	owner: string,
): void {
	if (!("evidenceIds" in record) || !Array.isArray(record.evidenceIds)) return;
	for (const evidenceId of record.evidenceIds) {
		if (typeof evidenceId === "string" && !evidenceIds.has(evidenceId)) {
			throw new Error(`${owner} has missing evidence ${evidenceId}`);
		}
	}
}

function semanticRecordIds(model: ThemeSemanticModel): Set<string> {
	return new Set(
		Object.values(model)
			.flatMap((value) => (Array.isArray(value) ? value : []))
			.flatMap((record) =>
				record &&
				typeof record === "object" &&
				"id" in record &&
				typeof record.id === "string"
					? [record.id]
					: [],
			),
	);
}

function isOwnerDerivedNode(node: ThemeGraphNode): boolean {
	return (
		node.kind === "unresolved" ||
		node.kind === "shopifyObject" ||
		node.kind === "shopifyProperty"
	);
}

function addOwnership(
	map: Map<string, Set<string>>,
	semanticId: string,
	graphId: string,
): void {
	const ids = map.get(semanticId) ?? new Set<string>();
	ids.add(graphId);
	map.set(semanticId, ids);
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
	return JSON.stringify(a) === JSON.stringify(b);
}
