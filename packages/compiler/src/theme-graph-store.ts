import type { InspectNazareThemeResult } from "./theme-facts.js";

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
	private graph: InspectNazareThemeResult;

	constructor(graph: InspectNazareThemeResult) {
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
		return fork;
	}

	applyGraph(graph: InspectNazareThemeResult): ThemeGraphStoreDelta {
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
