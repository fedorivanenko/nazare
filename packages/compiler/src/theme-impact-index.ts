import type {
	InspectNazareThemeResult,
	ThemeImpactSummary,
} from "./theme-facts.js";

type ImpactGraph = Pick<InspectNazareThemeResult, "nodes" | "edges">;
type ImpactNode = InspectNazareThemeResult["nodes"][number];
type ImpactEdge = InspectNazareThemeResult["edges"][number];

export type ThemeImpactIndexDelta = {
	addedNodeIds: string[];
	removedNodeIds: string[];
	changedNodeIds: string[];
	addedEdgeIds: string[];
	removedEdgeIds: string[];
	changedEdgeIds: string[];
	changedAffectedPageKeys: string[];
	unusedFilesChanged: boolean;
	unusedFileCount: number;
};

export class ThemeImpactIndex {
	private readonly dependentsByNode = new Map<string, Set<string>>();
	private readonly dependenciesByNode = new Map<string, Set<string>>();
	private readonly pagePathsByNode = new Map<string, string[]>();
	private readonly nodeIdsByPath = new Map<string, Set<string>>();
	private readonly pathByNodeId = new Map<string, string>();
	private readonly nodesById = new Map<string, ImpactNode>();
	private readonly edgesById = new Map<string, ImpactEdge>();
	private summary: ThemeImpactSummary = emptyImpactSummary();

	constructor(graph?: InspectNazareThemeResult) {
		if (graph) this.replaceGraph(graph);
	}

	replaceGraph(graph: InspectNazareThemeResult): void {
		this.dependentsByNode.clear();
		this.dependenciesByNode.clear();
		this.pagePathsByNode.clear();
		this.nodeIdsByPath.clear();
		this.pathByNodeId.clear();
		this.nodesById.clear();
		this.edgesById.clear();
		for (const node of graph.nodes) this.addNode(node);
		for (const edge of graph.edges) this.addEdge(edge);
		this.refreshSummary();
	}

	fork(): ThemeImpactIndex {
		const fork = new ThemeImpactIndex();
		copySetMap(this.dependentsByNode, fork.dependentsByNode);
		copySetMap(this.dependenciesByNode, fork.dependenciesByNode);
		copySetMap(this.nodeIdsByPath, fork.nodeIdsByPath);
		for (const [key, value] of this.pagePathsByNode) {
			fork.pagePathsByNode.set(key, [...value]);
		}
		for (const [key, value] of this.pathByNodeId) {
			fork.pathByNodeId.set(key, value);
		}
		for (const [key, value] of this.nodesById) fork.nodesById.set(key, value);
		for (const [key, value] of this.edgesById) fork.edgesById.set(key, value);
		fork.summary = this.toSummary();
		return fork;
	}

	applyGraph(graph: InspectNazareThemeResult): ThemeImpactIndexDelta {
		const previousSummary = this.summary;
		const nextNodes = new Map(graph.nodes.map((node) => [node.id, node]));
		const nextEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
		const nodeDelta = recordDelta(this.nodesById, nextNodes);
		const edgeDelta = recordDelta(this.edgesById, nextEdges);
		for (const [id, edge] of this.edgesById) {
			const next = nextEdges.get(id);
			if (!next || !sameRecord(edge, next)) this.removeEdge(edge);
		}
		for (const [id, node] of this.nodesById) {
			const next = nextNodes.get(id);
			if (!next || !sameRecord(node, next)) this.removeNode(node);
		}
		for (const [id, node] of nextNodes) {
			const previous = this.nodesById.get(id);
			if (!previous || !sameRecord(previous, node)) this.addNode(node);
		}
		for (const [id, edge] of nextEdges) {
			const previous = this.edgesById.get(id);
			if (!previous || !sameRecord(previous, edge)) this.addEdge(edge);
		}
		this.refreshSummary();
		return {
			addedNodeIds: nodeDelta.added,
			removedNodeIds: nodeDelta.removed,
			changedNodeIds: nodeDelta.changed,
			addedEdgeIds: edgeDelta.added,
			removedEdgeIds: edgeDelta.removed,
			changedEdgeIds: edgeDelta.changed,
			changedAffectedPageKeys: changedRecordKeys(
				previousSummary.affectedPages,
				this.summary.affectedPages,
			),
			unusedFilesChanged: !sameRecord(
				previousSummary.unusedFiles,
				this.summary.unusedFiles,
			),
			unusedFileCount: this.summary.unusedFiles.length,
		};
	}

	private addNode(node: ImpactNode): void {
		this.nodesById.set(node.id, node);
		if ("path" in node) {
			this.pathByNodeId.set(node.id, node.path);
			const ids = this.nodeIdsByPath.get(node.path) ?? new Set<string>();
			ids.add(node.id);
			this.nodeIdsByPath.set(node.path, ids);
		}
		if (node.kind === "page") this.pagePathsByNode.set(node.id, [node.path]);
	}

	private removeNode(node: ImpactNode): void {
		this.nodesById.delete(node.id);
		this.pagePathsByNode.delete(node.id);
		if (!("path" in node)) return;
		this.pathByNodeId.delete(node.id);
		const ids = this.nodeIdsByPath.get(node.path);
		ids?.delete(node.id);
		if (ids?.size === 0) this.nodeIdsByPath.delete(node.path);
	}

	private addEdge(edge: ImpactEdge): void {
		this.edgesById.set(edge.id, edge);
		addValue(this.dependenciesByNode, edge.from, edge.to);
		addValue(this.dependentsByNode, edge.to, edge.from);
	}

	private removeEdge(edge: ImpactEdge): void {
		this.edgesById.delete(edge.id);
		const sameEndpointsRemain = [...this.edgesById.values()].some(
			(candidate) => candidate.from === edge.from && candidate.to === edge.to,
		);
		if (sameEndpointsRemain) return;
		removeValue(this.dependenciesByNode, edge.from, edge.to);
		removeValue(this.dependentsByNode, edge.to, edge.from);
	}

	private refreshSummary(): void {
		const next = impactSummaryFromGraph(
			{
				nodes: [...this.nodesById.values()],
				edges: [...this.edgesById.values()],
			},
			this.pathByNodeId,
		);
		this.summary = shareImpactSummary(this.summary, next);
	}

	getUnusedFileCount(): number {
		return this.summary.unusedFiles.length;
	}

	toSummary(): ThemeImpactSummary {
		return {
			dependencies: cloneRecord(this.summary.dependencies),
			dependents: cloneRecord(this.summary.dependents),
			affectedPages: cloneRecord(this.summary.affectedPages),
			unusedFiles: [...this.summary.unusedFiles],
		};
	}

	getDependencies(nodeId: string): string[] {
		return [
			...new Set(
				this.lookupNodeIds(nodeId).flatMap((id) =>
					[...(this.dependenciesByNode.get(id) ?? [])].map(
						(dependency) => this.pathByNodeId.get(dependency) ?? dependency,
					),
				),
			),
		].sort();
	}

	getDependents(nodeId: string): string[] {
		return [
			...new Set(
				this.lookupNodeIds(nodeId).flatMap((id) =>
					[...(this.dependentsByNode.get(id) ?? [])].map(
						(dependent) => this.pathByNodeId.get(dependent) ?? dependent,
					),
				),
			),
		].sort();
	}

	private lookupNodeIds(nodeId: string): string[] {
		return [nodeId, ...(this.nodeIdsByPath.get(nodeId) ?? [])];
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

function impactSummaryFromGraph(
	graph: ImpactGraph,
	pathByNodeId: Map<string, string>,
): ThemeImpactSummary {
	const dependencies = new Map<string, Set<string>>();
	const dependents = new Map<string, Set<string>>();
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	const add = (from: string | undefined, to: string | undefined): void => {
		if (!from || !to || from === to) return;
		addValue(dependencies, from, to);
		addValue(dependents, to, from);
	};
	const referenceKinds = new Set([
		"renders",
		"templateContainsSection",
		"containsSectionGroup",
		"usesLayout",
		"referencesAsset",
	]);
	for (const edge of graph.edges) {
		if (referenceKinds.has(edge.kind)) {
			add(pathByNodeId.get(edge.from), pathByNodeId.get(edge.to));
			continue;
		}
		if (edge.kind === "instanceOf" || edge.kind === "instanceOfBlock") {
			const instance = nodeById.get(edge.from);
			const from =
				instance && "templatePath" in instance
					? instance.templatePath
					: instance && "ownerPath" in instance
						? instance.ownerPath
						: undefined;
			add(from, pathByNodeId.get(edge.to));
			continue;
		}
		if (edge.kind === "resolvesMetafieldDefinition") {
			const read = nodeById.get(edge.from);
			add(read && "fromPath" in read ? read.fromPath : undefined, edge.to);
		}
	}
	const affectedPages = new Map<string, Set<string>>();
	for (const page of graph.nodes.filter((node) => node.kind === "page")) {
		const visited = new Set<string>();
		const pending = [page.path];
		while (pending.length > 0) {
			const path = pending.pop();
			if (!path || visited.has(path)) continue;
			visited.add(path);
			addValue(affectedPages, path, page.path);
			for (const dependency of dependencies.get(path) ?? []) {
				pending.push(dependency);
			}
		}
	}
	const declaredFiles = new Set(
		graph.nodes.filter((node) => node.kind === "file").map((node) => node.path),
	);
	const entryFiles = new Set(
		graph.nodes.flatMap((node) => {
			if (node.kind === "page") return [node.path];
			if (
				(node.kind === "layout" || node.kind === "locale") &&
				"path" in node
			) {
				return [node.path];
			}
			if (
				node.kind === "file" &&
				(node.fileKind === "settingsSchema" || node.fileKind === "settingsData")
			) {
				return [node.path];
			}
			return [];
		}),
	);
	const hasDynamicSnippetReference = graph.edges.some(
		(edge) =>
			edge.kind === "renders" && !("targetName" in edge && edge.targetName),
	);
	const unusedCandidates = new Set(
		graph.nodes.flatMap((node) => {
			if (
				!("path" in node) ||
				!(
					node.kind === "section" ||
					node.kind === "snippet" ||
					node.kind === "themeBlock" ||
					node.kind === "component"
				)
			) {
				return [];
			}
			if (hasDynamicSnippetReference && node.kind === "snippet") return [];
			return [node.path];
		}),
	);
	const referencedFiles = new Set([...dependents.keys(), ...entryFiles]);
	return {
		dependencies: sortedRecord(dependencies),
		dependents: sortedRecord(dependents),
		affectedPages: sortedRecord(affectedPages),
		unusedFiles: [...declaredFiles]
			.filter(
				(path) => unusedCandidates.has(path) && !referencedFiles.has(path),
			)
			.sort((a, b) => a.localeCompare(b)),
	};
}

function addValue(
	map: Map<string, Set<string>>,
	key: string,
	value: string,
): void {
	const values = map.get(key) ?? new Set<string>();
	values.add(value);
	map.set(key, values);
}

function removeValue(
	map: Map<string, Set<string>>,
	key: string,
	value: string,
): void {
	const values = map.get(key);
	values?.delete(value);
	if (values?.size === 0) map.delete(key);
}

function copySetMap(
	source: Map<string, Set<string>>,
	target: Map<string, Set<string>>,
): void {
	for (const [key, values] of source) target.set(key, new Set(values));
}

function sameRecord(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
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

function changedRecordKeys(
	previous: Record<string, string[]>,
	next: Record<string, string[]>,
): string[] {
	return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
		.filter((key) => !sameRecord(previous[key], next[key]))
		.sort();
}

function shareImpactSummary(
	previous: ThemeImpactSummary,
	next: ThemeImpactSummary,
): ThemeImpactSummary {
	return {
		dependencies: shareRecord(previous.dependencies, next.dependencies),
		dependents: shareRecord(previous.dependents, next.dependents),
		affectedPages: shareRecord(previous.affectedPages, next.affectedPages),
		unusedFiles: sameRecord(previous.unusedFiles, next.unusedFiles)
			? previous.unusedFiles
			: next.unusedFiles,
	};
}

function shareRecord(
	previous: Record<string, string[]>,
	next: Record<string, string[]>,
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(next).map(([key, values]) => [
			key,
			sameRecord(previous[key], values) ? previous[key] : values,
		]),
	);
}

function sortedRecord(map: Map<string, Set<string>>): Record<string, string[]> {
	return Object.fromEntries(
		[...map]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, values]) => [key, [...values].sort()]),
	);
}

function cloneRecord(
	record: Record<string, string[]>,
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(record).map(([key, values]) => [key, [...values]]),
	);
}

function emptyImpactSummary(): ThemeImpactSummary {
	return {
		dependencies: {},
		dependents: {},
		affectedPages: {},
		unusedFiles: [],
	};
}
