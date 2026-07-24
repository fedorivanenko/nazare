import type {
	InspectNazareThemeResult,
	ThemeImpactSummary,
} from "./theme-facts.js";

export class ThemeImpactIndex {
	private readonly dependentsByNode = new Map<string, Set<string>>();
	private readonly dependenciesByNode = new Map<string, Set<string>>();
	private readonly pagePathsByNode = new Map<string, string[]>();
	private readonly nodeIdsByPath = new Map<string, Set<string>>();
	private readonly pathByNodeId = new Map<string, string>();
	private summary: ThemeImpactSummary = emptyImpactSummary();

	constructor(graph: InspectNazareThemeResult) {
		this.replaceGraph(graph);
	}

	replaceGraph(graph: InspectNazareThemeResult): void {
		this.dependentsByNode.clear();
		this.dependenciesByNode.clear();
		this.pagePathsByNode.clear();
		this.nodeIdsByPath.clear();
		this.pathByNodeId.clear();
		for (const edge of graph.edges) {
			const dependencies =
				this.dependenciesByNode.get(edge.from) ?? new Set<string>();
			dependencies.add(edge.to);
			this.dependenciesByNode.set(edge.from, dependencies);
			const dependents =
				this.dependentsByNode.get(edge.to) ?? new Set<string>();
			dependents.add(edge.from);
			this.dependentsByNode.set(edge.to, dependents);
		}
		for (const node of graph.nodes) {
			if ("path" in node) {
				this.pathByNodeId.set(node.id, node.path);
				const ids = this.nodeIdsByPath.get(node.path) ?? new Set<string>();
				ids.add(node.id);
				this.nodeIdsByPath.set(node.path, ids);
			}
			if (node.kind !== "page") continue;
			const path = node.path;
			this.pagePathsByNode.set(node.id, [path]);
		}
		this.summary = impactSummaryFromGraph(graph, this.pathByNodeId);
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
	graph: InspectNazareThemeResult,
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
