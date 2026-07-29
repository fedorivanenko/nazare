import { isDeepStrictEqual } from "node:util";
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
	private readonly pageDependentsByNode = new Map<string, Set<string>>();
	private readonly pagePathsByNode = new Map<string, string[]>();
	private readonly nodeIdsByPath = new Map<string, Set<string>>();
	private readonly pathByNodeId = new Map<string, string>();
	private readonly nodesById = new Map<string, ImpactNode>();
	private readonly edgesById = new Map<string, ImpactEdge>();
	private readonly edgeCountsByEndpoints = new Map<string, number>();
	private readonly pageEdgeCountsByEndpoints = new Map<string, number>();
	private summary: ThemeImpactSummary = emptyImpactSummary();
	private publishedSummary: ThemeImpactSummary | undefined;

	constructor(graph?: InspectNazareThemeResult) {
		if (graph) this.replaceGraph(graph);
	}

	replaceGraph(graph: InspectNazareThemeResult): void {
		validateImpactGraph(graph);
		this.dependentsByNode.clear();
		this.dependenciesByNode.clear();
		this.pageDependentsByNode.clear();
		this.pagePathsByNode.clear();
		this.nodeIdsByPath.clear();
		this.pathByNodeId.clear();
		this.nodesById.clear();
		this.edgesById.clear();
		this.edgeCountsByEndpoints.clear();
		this.pageEdgeCountsByEndpoints.clear();
		for (const node of graph.nodes) this.addNode(node);
		for (const edge of graph.edges) this.addEdge(edge);
		this.refreshSummary();
	}

	fork(): ThemeImpactIndex {
		const fork = new ThemeImpactIndex();
		copySetMap(this.dependentsByNode, fork.dependentsByNode);
		copySetMap(this.dependenciesByNode, fork.dependenciesByNode);
		copySetMap(this.pageDependentsByNode, fork.pageDependentsByNode);
		copySetMap(this.nodeIdsByPath, fork.nodeIdsByPath);
		for (const [key, value] of this.pagePathsByNode) {
			fork.pagePathsByNode.set(key, [...value]);
		}
		for (const [key, value] of this.pathByNodeId) {
			fork.pathByNodeId.set(key, value);
		}
		for (const [key, value] of this.nodesById) fork.nodesById.set(key, value);
		for (const [key, value] of this.edgesById) fork.edgesById.set(key, value);
		for (const [key, value] of this.edgeCountsByEndpoints) {
			fork.edgeCountsByEndpoints.set(key, value);
		}
		for (const [key, value] of this.pageEdgeCountsByEndpoints) {
			fork.pageEdgeCountsByEndpoints.set(key, value);
		}
		fork.summary = this.summary;
		fork.publishedSummary = this.publishedSummary;
		return fork;
	}

	applyGraph(graph: InspectNazareThemeResult): ThemeImpactIndexDelta {
		validateImpactGraph(graph);
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
		const endpointKey = edgeEndpointKey(edge.from, edge.to);
		if (incrementCount(this.edgeCountsByEndpoints, endpointKey) === 1) {
			addValue(this.dependenciesByNode, edge.from, edge.to);
			addValue(this.dependentsByNode, edge.to, edge.from);
		}
		if (
			propagatesPageImpact(edge) &&
			incrementCount(this.pageEdgeCountsByEndpoints, endpointKey) === 1
		) {
			addValue(this.pageDependentsByNode, edge.to, edge.from);
		}
	}

	private removeEdge(edge: ImpactEdge): void {
		this.edgesById.delete(edge.id);
		const endpointKey = edgeEndpointKey(edge.from, edge.to);
		if (decrementCount(this.edgeCountsByEndpoints, endpointKey) === 0) {
			removeValue(this.dependenciesByNode, edge.from, edge.to);
			removeValue(this.dependentsByNode, edge.to, edge.from);
		}
		if (
			propagatesPageImpact(edge) &&
			decrementCount(this.pageEdgeCountsByEndpoints, endpointKey) === 0
		) {
			removeValue(this.pageDependentsByNode, edge.to, edge.from);
		}
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
		this.publishedSummary = undefined;
	}

	getUnusedFileCount(): number {
		return this.summary.unusedFiles.length;
	}

	toSummary(): ThemeImpactSummary {
		this.publishedSummary ??= freezeImpactSummary({
			dependencies: cloneRecord(this.summary.dependencies),
			dependents: cloneRecord(this.summary.dependents),
			affectedPages: cloneRecord(this.summary.affectedPages),
			unusedFiles: [...this.summary.unusedFiles],
		});
		return this.publishedSummary;
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
			for (const dependent of this.pageDependentsByNode.get(current) ?? [])
				pending.push(dependent);
		}
		return [...pages].sort();
	}
}

function validateImpactGraph(graph: ImpactGraph): void {
	const nodeIds = new Set<string>();
	for (const node of graph.nodes) {
		if (!node.id) throw new Error("Impact graph node id is required");
		if (nodeIds.has(node.id)) {
			throw new Error(`Duplicate impact graph node id ${node.id}`);
		}
		nodeIds.add(node.id);
	}
	const edgeIds = new Set<string>();
	for (const edge of graph.edges) {
		if (!edge.id) throw new Error("Impact graph edge id is required");
		if (edgeIds.has(edge.id)) {
			throw new Error(`Duplicate impact graph edge id ${edge.id}`);
		}
		if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
			throw new Error(`Impact graph edge ${edge.id} references a missing node`);
		}
		edgeIds.add(edge.id);
	}
}

function impactSummaryFromGraph(
	graph: ImpactGraph,
	pathByNodeId: Map<string, string>,
): ThemeImpactSummary {
	const dependencies = new Map<string, Set<string>>();
	const pageDependencies = new Map<string, Set<string>>();
	const dependents = new Map<string, Set<string>>();
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	const add = (
		from: string | undefined,
		to: string | undefined,
		propagatesToPages = true,
	): void => {
		if (!from || !to || from === to) return;
		addValue(dependencies, from, to);
		addValue(dependents, to, from);
		if (propagatesToPages) addValue(pageDependencies, from, to);
	};
	const referenceKinds = new Set([
		"renders",
		"templateContainsSection",
		"containsSectionGroup",
		"usesLayout",
		"referencesAsset",
		"dependsOnBehaviorContract",
		"dependsOnDomHook",
	]);
	for (const edge of graph.edges) {
		if (referenceKinds.has(edge.kind)) {
			add(
				pathByNodeId.get(edge.from),
				pathByNodeId.get(edge.to),
				propagatesPageImpact(edge),
			);
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
			for (const dependency of pageDependencies.get(path) ?? []) {
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
	const structurallyReferencedFiles = new Set([
		...entryFiles,
		...[...pageDependencies.values()].flatMap((paths) => [...paths]),
	]);
	return {
		dependencies: sortedRecord(dependencies),
		dependents: sortedRecord(dependents),
		affectedPages: sortedRecord(affectedPages),
		unusedFiles: [...declaredFiles]
			.filter(
				(path) =>
					unusedCandidates.has(path) && !structurallyReferencedFiles.has(path),
			)
			.sort((a, b) => a.localeCompare(b)),
	};
}

function propagatesPageImpact(edge: ImpactEdge): boolean {
	return (
		edge.kind !== "dependsOnDomHook" &&
		edge.kind !== "dependsOnBehaviorContract"
	);
}

function edgeEndpointKey(from: string, to: string): string {
	return JSON.stringify([from, to]);
}

function incrementCount(map: Map<string, number>, key: string): number {
	const next = (map.get(key) ?? 0) + 1;
	map.set(key, next);
	return next;
}

function decrementCount(map: Map<string, number>, key: string): number {
	const current = map.get(key);
	if (current === undefined || current < 1) {
		throw new Error(`Cannot decrement missing impact edge count ${key}`);
	}
	const next = current - 1;
	if (next === 0) map.delete(key);
	else map.set(key, next);
	return next;
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
	return a === b || isDeepStrictEqual(a, b);
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

function freezeImpactSummary(summary: ThemeImpactSummary): ThemeImpactSummary {
	for (const record of [
		summary.dependencies,
		summary.dependents,
		summary.affectedPages,
	]) {
		for (const values of Object.values(record)) Object.freeze(values);
		Object.freeze(record);
	}
	Object.freeze(summary.unusedFiles);
	return Object.freeze(summary);
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
