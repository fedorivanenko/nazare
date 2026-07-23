import type { InspectNazareThemeResult } from "./theme-facts.js";

export class ThemeImpactIndex {
	private readonly dependentsByNode = new Map<string, Set<string>>();
	private readonly pagePathsByNode = new Map<string, string[]>();
	private readonly nodeIdsByPath = new Map<string, Set<string>>();

	constructor(graph: InspectNazareThemeResult) {
		this.replaceGraph(graph);
	}

	replaceGraph(graph: InspectNazareThemeResult): void {
		this.dependentsByNode.clear();
		this.pagePathsByNode.clear();
		this.nodeIdsByPath.clear();
		for (const edge of graph.edges) {
			const dependents =
				this.dependentsByNode.get(edge.to) ?? new Set<string>();
			dependents.add(edge.from);
			this.dependentsByNode.set(edge.to, dependents);
		}
		for (const node of graph.nodes) {
			if ("path" in node) {
				const ids = this.nodeIdsByPath.get(node.path) ?? new Set<string>();
				ids.add(node.id);
				this.nodeIdsByPath.set(node.path, ids);
			}
			if (node.kind !== "page") continue;
			const path = node.path;
			this.pagePathsByNode.set(node.id, [path]);
		}
	}

	getAffectedPages(nodeId: string): string[] {
		const pages = new Set<string>();
		const visited = new Set<string>();
		const pending = [nodeId, ...(this.nodeIdsByPath.get(nodeId) ?? [])];
		while (pending.length > 0) {
			const current = pending.pop();
			if (current === undefined || visited.has(current)) continue;
			visited.add(current);
			for (const page of this.pagePathsByNode.get(current) ?? [])
				pages.add(page);
			for (const dependent of this.dependentsByNode.get(current) ?? [])
				pending.push(dependent);
		}
		return [...pages].sort();
	}
}
