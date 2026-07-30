import { isDeepStrictEqual } from "node:util";
import { compareCanonicalStrings } from "./canonical-order.js";
import type {
	InspectNazareThemeResult,
	ThemeImpactSummary,
} from "./theme-facts.js";

type ImpactGraph = Pick<InspectNazareThemeResult, "nodes" | "edges">;
type ImpactNode = InspectNazareThemeResult["nodes"][number];
type ImpactEdge = InspectNazareThemeResult["edges"][number];
type SummaryContribution = {
	readonly fromPath: string;
	readonly toPath: string;
	readonly propagatesToPages: boolean;
};

const SUMMARY_REFERENCE_EDGE_KINDS = new Set<ImpactEdge["kind"]>([
	"templateContainsSection",
	"containsSectionGroup",
	"usesLayout",
	"referencesAsset",
	"dependsOnBehaviorContract",
	"dependsOnDomHook",
]);

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
	private readonly summaryDependenciesByPath = new Map<string, Set<string>>();
	private readonly summaryDependentsByPath = new Map<string, Set<string>>();
	private readonly pageDependenciesByPath = new Map<string, Set<string>>();
	private readonly pageClosureByPagePath = new Map<string, Set<string>>();
	private readonly affectedPagesByPath = new Map<string, Set<string>>();
	private readonly touchedSummaryPaths = new Set<string>();
	private readonly touchedPagePaths = new Set<string>();
	private readonly pagePathCounts = new Map<string, number>();
	private readonly summaryContributionByEdgeId = new Map<
		string,
		SummaryContribution
	>();
	private readonly summaryEdgeCounts = new Map<string, number>();
	private readonly summaryPageEdgeCounts = new Map<string, number>();
	private readonly pagePathsByNode = new Map<string, string[]>();
	private readonly nodeIdsByPath = new Map<string, Set<string>>();
	private readonly pathByNodeId = new Map<string, string>();
	private readonly nodesById = new Map<string, ImpactNode>();
	private readonly edgesById = new Map<string, ImpactEdge>();
	private readonly edgeCountsByEndpoints = new Map<string, number>();
	private readonly pageEdgeCountsByEndpoints = new Map<string, number>();
	private summary: ThemeImpactSummary = emptyImpactSummary();
	private publishedSummary: ThemeImpactSummary | undefined;
	private dynamicSnippetReferenceCount = 0;

	constructor(graph?: InspectNazareThemeResult) {
		if (graph) this.replaceGraph(graph);
	}

	replaceGraph(graph: InspectNazareThemeResult): void {
		validateImpactGraph(graph);
		this.dependentsByNode.clear();
		this.dependenciesByNode.clear();
		this.pageDependentsByNode.clear();
		this.summaryDependenciesByPath.clear();
		this.summaryDependentsByPath.clear();
		this.pageDependenciesByPath.clear();
		this.pageClosureByPagePath.clear();
		this.affectedPagesByPath.clear();
		this.touchedSummaryPaths.clear();
		this.touchedPagePaths.clear();
		this.pagePathCounts.clear();
		this.summaryContributionByEdgeId.clear();
		this.summaryEdgeCounts.clear();
		this.summaryPageEdgeCounts.clear();
		this.pagePathsByNode.clear();
		this.nodeIdsByPath.clear();
		this.pathByNodeId.clear();
		this.nodesById.clear();
		this.edgesById.clear();
		this.edgeCountsByEndpoints.clear();
		this.pageEdgeCountsByEndpoints.clear();
		this.dynamicSnippetReferenceCount = 0;
		for (const node of graph.nodes) this.addNode(node);
		for (const edge of graph.edges) this.addEdge(edge);
		this.refreshSummary();
	}

	fork(): ThemeImpactIndex {
		const fork = new ThemeImpactIndex();
		copySetMap(this.dependentsByNode, fork.dependentsByNode);
		copySetMap(this.dependenciesByNode, fork.dependenciesByNode);
		copySetMap(this.pageDependentsByNode, fork.pageDependentsByNode);
		copySetMap(this.summaryDependenciesByPath, fork.summaryDependenciesByPath);
		copySetMap(this.summaryDependentsByPath, fork.summaryDependentsByPath);
		copySetMap(this.pageDependenciesByPath, fork.pageDependenciesByPath);
		copySetMap(this.pageClosureByPagePath, fork.pageClosureByPagePath);
		copySetMap(this.affectedPagesByPath, fork.affectedPagesByPath);
		copySet(this.touchedSummaryPaths, fork.touchedSummaryPaths);
		copySet(this.touchedPagePaths, fork.touchedPagePaths);
		copyMap(this.pagePathCounts, fork.pagePathCounts);
		copyMap(this.summaryContributionByEdgeId, fork.summaryContributionByEdgeId);
		copyMap(this.summaryEdgeCounts, fork.summaryEdgeCounts);
		copyMap(this.summaryPageEdgeCounts, fork.summaryPageEdgeCounts);
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
		fork.dynamicSnippetReferenceCount = this.dynamicSnippetReferenceCount;
		return fork;
	}

	applyGraph(graph: InspectNazareThemeResult): ThemeImpactIndexDelta {
		validateImpactGraph(graph);
		const previousSummary = this.summary;
		const nextNodes = new Map(graph.nodes.map((node) => [node.id, node]));
		const nextEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
		const nodeDelta = recordDelta(this.nodesById, nextNodes);
		const edgeDelta = recordDelta(this.edgesById, nextEdges);
		const changedOrRemovedNodeIds = new Set([
			...nodeDelta.changed,
			...nodeDelta.removed,
		]);
		const summaryEdgesToRefresh = [...this.edgesById.values()].filter(
			(edge) => {
				const next = nextEdges.get(edge.id);
				return (
					next !== undefined &&
					sameRecord(edge, next) &&
					(changedOrRemovedNodeIds.has(edge.from) ||
						changedOrRemovedNodeIds.has(edge.to))
				);
			},
		);
		for (const edge of summaryEdgesToRefresh) {
			this.removeSummaryContribution(edge.id);
		}
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
		for (const edge of summaryEdgesToRefresh) {
			if (nextNodes.has(edge.from) && nextNodes.has(edge.to)) {
				this.addSummaryContribution(edge);
			}
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
		if (node.kind === "page") {
			this.pagePathsByNode.set(node.id, [node.path]);
			this.touchedPagePaths.add(node.path);
			incrementCount(this.pagePathCounts, node.path);
		}
	}

	private removeNode(node: ImpactNode): void {
		this.nodesById.delete(node.id);
		this.pagePathsByNode.delete(node.id);
		if (node.kind === "page") {
			this.touchedPagePaths.add(node.path);
			decrementCount(this.pagePathCounts, node.path);
		}
		if (!("path" in node)) return;
		this.pathByNodeId.delete(node.id);
		const ids = this.nodeIdsByPath.get(node.path);
		ids?.delete(node.id);
		if (ids?.size === 0) this.nodeIdsByPath.delete(node.path);
	}

	private addEdge(edge: ImpactEdge): void {
		this.edgesById.set(edge.id, edge);
		if (isDynamicSnippetReference(edge, this.nodesById)) {
			this.dynamicSnippetReferenceCount += 1;
		}
		this.addSummaryContribution(edge);
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
		this.removeSummaryContribution(edge.id);
		this.edgesById.delete(edge.id);
		if (isDynamicSnippetReference(edge, this.nodesById)) {
			if (this.dynamicSnippetReferenceCount < 1) {
				throw new Error("Dynamic snippet reference count underflow");
			}
			this.dynamicSnippetReferenceCount -= 1;
		}
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

	private addSummaryContribution(edge: ImpactEdge): void {
		if (this.summaryContributionByEdgeId.has(edge.id)) {
			throw new Error(`Impact summary already contains edge ${edge.id}`);
		}
		const contribution = summaryContribution(
			edge,
			this.nodesById,
			this.pathByNodeId,
		);
		if (!contribution) return;
		this.summaryContributionByEdgeId.set(edge.id, contribution);
		const key = edgeEndpointKey(contribution.fromPath, contribution.toPath);
		if (incrementCount(this.summaryEdgeCounts, key) === 1) {
			addValue(
				this.summaryDependenciesByPath,
				contribution.fromPath,
				contribution.toPath,
			);
			addValue(
				this.summaryDependentsByPath,
				contribution.toPath,
				contribution.fromPath,
			);
		}
		if (
			contribution.propagatesToPages &&
			incrementCount(this.summaryPageEdgeCounts, key) === 1
		) {
			this.touchedSummaryPaths.add(contribution.fromPath);
			this.touchedSummaryPaths.add(contribution.toPath);
			addValue(
				this.pageDependenciesByPath,
				contribution.fromPath,
				contribution.toPath,
			);
		}
	}

	private removeSummaryContribution(edgeId: string): void {
		const contribution = this.summaryContributionByEdgeId.get(edgeId);
		if (!contribution) return;
		this.summaryContributionByEdgeId.delete(edgeId);
		const key = edgeEndpointKey(contribution.fromPath, contribution.toPath);
		if (decrementCount(this.summaryEdgeCounts, key) === 0) {
			removeValue(
				this.summaryDependenciesByPath,
				contribution.fromPath,
				contribution.toPath,
			);
			removeValue(
				this.summaryDependentsByPath,
				contribution.toPath,
				contribution.fromPath,
			);
		}
		if (
			contribution.propagatesToPages &&
			decrementCount(this.summaryPageEdgeCounts, key) === 0
		) {
			this.touchedSummaryPaths.add(contribution.fromPath);
			this.touchedSummaryPaths.add(contribution.toPath);
			removeValue(
				this.pageDependenciesByPath,
				contribution.fromPath,
				contribution.toPath,
			);
		}
	}

	private refreshSummary(): void {
		this.refreshAffectedPages();
		const next = impactSummaryFromIndexes(
			this.nodesById.values(),
			this.summaryDependenciesByPath,
			this.summaryDependentsByPath,
			this.pageDependenciesByPath,
			this.affectedPagesByPath,
			this.dynamicSnippetReferenceCount > 0,
		);
		this.summary = shareImpactSummary(this.summary, next);
		this.publishedSummary = undefined;
	}

	private refreshAffectedPages(): void {
		const affectedPagePaths = new Set(this.touchedPagePaths);
		for (const path of this.touchedSummaryPaths) {
			for (const pagePath of this.affectedPagesByPath.get(path) ?? []) {
				affectedPagePaths.add(pagePath);
			}
		}
		const pending = [...this.touchedSummaryPaths];
		const visited = new Set<string>();
		while (pending.length > 0) {
			const path = pending.pop();
			if (path === undefined || visited.has(path)) continue;
			visited.add(path);
			if (this.pagePathCounts.has(path)) affectedPagePaths.add(path);
			for (const dependent of this.summaryDependentsByPath.get(path) ?? []) {
				pending.push(dependent);
			}
		}
		for (const pagePath of affectedPagePaths) {
			for (const dependency of this.pageClosureByPagePath.get(pagePath) ?? []) {
				removeValue(this.affectedPagesByPath, dependency, pagePath);
			}
			this.pageClosureByPagePath.delete(pagePath);
			if (!this.pagePathCounts.has(pagePath)) continue;
			const closure = dependencyClosure(pagePath, this.pageDependenciesByPath);
			this.pageClosureByPagePath.set(pagePath, closure);
			for (const dependency of closure) {
				addValue(this.affectedPagesByPath, dependency, pagePath);
			}
		}
		this.touchedSummaryPaths.clear();
		this.touchedPagePaths.clear();
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
		const semantic = this.summaryDependenciesByPath.get(nodeId);
		if (semantic) return [...semantic].sort();
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
		const semantic = this.summaryDependentsByPath.get(nodeId);
		if (semantic) return [...semantic].sort();
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
		const semantic = this.affectedPagesByPath.get(nodeId);
		if (semantic) return [...semantic].sort();
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

function impactSummaryFromIndexes(
	nodes: Iterable<ImpactNode>,
	dependencies: Map<string, Set<string>>,
	dependents: Map<string, Set<string>>,
	pageDependencies: Map<string, Set<string>>,
	affectedPages: Map<string, Set<string>>,
	hasDynamicSnippetReference: boolean,
): ThemeImpactSummary {
	const nodeList = [...nodes];
	const declaredFiles = new Set(
		nodeList.filter((node) => node.kind === "file").map((node) => node.path),
	);
	const entryFiles = new Set(
		nodeList.flatMap((node) => {
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
	const unusedCandidates = new Set(
		nodeList.flatMap((node) => {
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
			.sort((a, b) => compareCanonicalStrings(a, b)),
	};
}

function summaryContribution(
	edge: ImpactEdge,
	nodesById: Map<string, ImpactNode>,
	pathByNodeId: Map<string, string>,
): SummaryContribution | undefined {
	let fromPath: string | undefined;
	let toPath: string | undefined;
	if (edge.kind === "resolvesRenderTarget") {
		const site = nodesById.get(edge.from);
		fromPath = site?.kind === "renderSite" ? site.fromPath : undefined;
		toPath = pathByNodeId.get(edge.to);
	} else if (SUMMARY_REFERENCE_EDGE_KINDS.has(edge.kind)) {
		fromPath = pathByNodeId.get(edge.from);
		toPath = pathByNodeId.get(edge.to);
	} else if (edge.kind === "instanceOf" || edge.kind === "instanceOfBlock") {
		const instance = nodesById.get(edge.from);
		fromPath =
			instance && "templatePath" in instance
				? instance.templatePath
				: instance && "ownerPath" in instance
					? instance.ownerPath
					: undefined;
		toPath = pathByNodeId.get(edge.to);
	} else if (edge.kind === "resolvesMetafieldDefinition") {
		const read = nodesById.get(edge.from);
		fromPath = read && "fromPath" in read ? read.fromPath : undefined;
		toPath = edge.to;
	}
	if (!fromPath || !toPath || fromPath === toPath) return undefined;
	return {
		fromPath,
		toPath,
		propagatesToPages: propagatesPageImpact(edge),
	};
}

function isDynamicSnippetReference(
	edge: ImpactEdge,
	nodesById: Map<string, ImpactNode>,
): boolean {
	if (edge.kind !== "resolvesRenderTarget") return false;
	const site = nodesById.get(edge.from);
	return site?.kind === "renderSite" && site.targetName === undefined;
}

function dependencyClosure(
	rootPath: string,
	dependenciesByPath: Map<string, Set<string>>,
): Set<string> {
	const visited = new Set<string>();
	const pending = [rootPath];
	while (pending.length > 0) {
		const path = pending.pop();
		if (path === undefined || visited.has(path)) continue;
		visited.add(path);
		for (const dependency of dependenciesByPath.get(path) ?? []) {
			pending.push(dependency);
		}
	}
	return visited;
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

function copySet<Value>(source: Set<Value>, target: Set<Value>): void {
	for (const value of source) target.add(value);
}

function copyMap<Key, Value>(
	source: Map<Key, Value>,
	target: Map<Key, Value>,
): void {
	for (const [key, value] of source) target.set(key, value);
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
			.sort(([a], [b]) => compareCanonicalStrings(a, b))
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
