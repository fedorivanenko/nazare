import type {
	InspectNazareThemeOptions,
	InspectNazareThemeResult,
	ThemeAnalysisCache,
	ThemeInputFile,
} from "./theme-facts.js";
import { inspectNazareTheme } from "./theme-workspace.js";

export type ThemeGraphUpdate = {
	revision: number;
	graph: InspectNazareThemeResult;
	changedPaths: string[];
	invalidatedNodeIds: string[];
	affectedPages: string[];
	addedNodeIds: string[];
	removedNodeIds: string[];
	changedNodeIds: string[];
	addedEdgeIds: string[];
	removedEdgeIds: string[];
	changedEdgeIds: string[];
};

export class ThemeWorkspaceSession {
	private readonly filesByPath = new Map<string, ThemeInputFile>();
	private readonly options: InspectNazareThemeOptions;
	private readonly cache: ThemeAnalysisCache = { version: 1, entries: {} };
	private graph: InspectNazareThemeResult;
	private revision = 0;

	constructor(
		files: ThemeInputFile[],
		options: InspectNazareThemeOptions = {},
	) {
		this.options = { ...options, cache: this.cache };
		for (const file of files) this.filesByPath.set(file.path, file);
		this.graph = inspectNazareTheme(this.files(), this.options);
	}

	getGraph(): InspectNazareThemeResult {
		return this.graph;
	}

	updateFile(file: ThemeInputFile): ThemeGraphUpdate {
		this.filesByPath.set(file.path, file);
		return this.rebuild([file.path]);
	}

	removeFile(path: string): ThemeGraphUpdate {
		if (!this.filesByPath.delete(path)) {
			return this.emptyUpdate([]);
		}
		return this.rebuild([path]);
	}

	updateExternalArtifacts(
		options: Pick<InspectNazareThemeOptions, "metafields" | "themeCheck">,
	): ThemeGraphUpdate {
		Object.assign(this.options, options);
		return this.rebuild(
			[options.metafields?.path, options.themeCheck?.path].filter(
				(path): path is string => path !== undefined,
			),
		);
	}

	private rebuild(changedPaths: string[]): ThemeGraphUpdate {
		const previous = this.graph;
		this.graph = inspectNazareTheme(this.files(), this.options);
		this.revision += 1;
		return diffGraphs(this.revision, previous, this.graph, changedPaths);
	}

	private emptyUpdate(changedPaths: string[]): ThemeGraphUpdate {
		return diffGraphs(this.revision, this.graph, this.graph, changedPaths);
	}

	private files(): ThemeInputFile[] {
		return [...this.filesByPath.values()].sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}
}

function diffGraphs(
	revision: number,
	previous: InspectNazareThemeResult,
	current: InspectNazareThemeResult,
	changedPaths: string[],
): ThemeGraphUpdate {
	const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
	const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
	const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
	const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]));
	return {
		revision,
		graph: current,
		changedPaths: [...new Set(changedPaths)].sort(),
		invalidatedNodeIds: invalidationClosure(current, changedPaths),
		affectedPages: affectedPages(current, changedPaths),
		addedNodeIds: addedIds(previousNodes, currentNodes),
		removedNodeIds: addedIds(currentNodes, previousNodes),
		changedNodeIds: changedIds(previousNodes, currentNodes),
		addedEdgeIds: addedIds(previousEdges, currentEdges),
		removedEdgeIds: addedIds(currentEdges, previousEdges),
		changedEdgeIds: changedIds(previousEdges, currentEdges),
	};
}

function invalidationClosure(
	graph: InspectNazareThemeResult,
	changedPaths: string[],
): string[] {
	const visited = new Set<string>();
	const pending = [...changedPaths];
	while (pending.length > 0) {
		const id = pending.pop();
		if (id === undefined || visited.has(id)) continue;
		visited.add(id);
		for (const dependent of graph.impact.dependents[id] ?? []) {
			if (!visited.has(dependent)) pending.push(dependent);
		}
	}
	return [...visited].sort((a, b) => a.localeCompare(b));
}

function affectedPages(
	graph: InspectNazareThemeResult,
	changedPaths: string[],
): string[] {
	const pages = new Set<string>();
	for (const id of invalidationClosure(graph, changedPaths)) {
		for (const page of graph.impact.affectedPages[id] ?? []) pages.add(page);
	}
	return [...pages].sort((a, b) => a.localeCompare(b));
}

function addedIds<T>(
	previous: Map<string, T>,
	current: Map<string, T>,
): string[] {
	return [...current.keys()]
		.filter((id) => !previous.has(id))
		.sort((a, b) => a.localeCompare(b));
}

function changedIds<T>(
	previous: Map<string, T>,
	current: Map<string, T>,
): string[] {
	return [...current.entries()]
		.filter(([id, value]) => {
			const previousValue = previous.get(id);
			return (
				previousValue !== undefined &&
				JSON.stringify(previousValue) !== JSON.stringify(value)
			);
		})
		.map(([id]) => id)
		.sort((a, b) => a.localeCompare(b));
}
