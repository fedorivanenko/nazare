import { ThemeFactIndex } from "./theme-fact-index.js";
import { ThemeFactStore, themeFactSourcePath } from "./theme-fact-store.js";
import type {
	InspectNazareThemeOptions,
	InspectNazareThemeResult,
	ThemeAnalysisCache,
	ThemeAnalysisMemo,
	ThemeInputFile,
} from "./theme-facts.js";
import { themeGraphFromModel } from "./theme-graph-output.js";
import { ThemeSemanticStore } from "./theme-semantic-store.js";
import { analyzeNazareTheme } from "./theme-workspace.js";

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
	private readonly memo = {} as ThemeAnalysisMemo;
	private readonly factStore: ThemeFactStore;
	private readonly factIndex: ThemeFactIndex;
	private semanticStore: ThemeSemanticStore;
	private graph: InspectNazareThemeResult;
	private externalFingerprint: string;
	private revision = 0;

	constructor(
		files: ThemeInputFile[],
		options: InspectNazareThemeOptions = {},
	) {
		this.options = { ...options, cache: this.cache, memo: this.memo };
		for (const file of files) this.filesByPath.set(file.path, file);
		const analysis = analyzeNazareTheme(this.files(), this.options);
		this.factStore = new ThemeFactStore(analysis.facts);
		this.factIndex = new ThemeFactIndex(analysis.facts);
		this.semanticStore = new ThemeSemanticStore(analysis.ir);
		this.graph = themeGraphFromModel(this.semanticStore.getModel());
		this.externalFingerprint = fingerprintExternalArtifacts(this.options);
	}

	getGraph(): InspectNazareThemeResult {
		return this.graph;
	}

	updateFile(file: ThemeInputFile): ThemeGraphUpdate {
		const previous = this.filesByPath.get(file.path);
		if (previous?.contents === file.contents) {
			return this.emptyUpdate([]);
		}
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
		const nextOptions = { ...this.options, ...options };
		const nextFingerprint = fingerprintExternalArtifacts(nextOptions);
		if (nextFingerprint === this.externalFingerprint) {
			return this.emptyUpdate([]);
		}
		const changedPaths = externalChangedPaths(this.options, options);
		Object.assign(this.options, options);
		this.externalFingerprint = nextFingerprint;
		return this.rebuild(changedPaths);
	}

	private rebuild(changedPaths: string[]): ThemeGraphUpdate {
		const previous = this.graph;
		const analysis = analyzeNazareTheme(this.files(), this.options);
		for (const path of changedPaths) {
			const facts = analysis.facts.filter(
				(fact) => themeFactSourcePath(fact) === path,
			);
			this.factStore.replaceFile(path, facts);
			this.factIndex.replaceFileFacts(path, facts);
		}
		const transaction = this.semanticStore.beginUpdate(analysis.ir);
		this.graph = themeGraphFromModel(transaction.commit());
		this.revision += 1;
		return diffGraphs(
			this.revision,
			previous,
			this.graph,
			changedPaths,
			this.factIndex.dependentsOfFiles(changedPaths),
		);
	}

	private emptyUpdate(changedPaths: string[]): ThemeGraphUpdate {
		return diffGraphs(this.revision, this.graph, this.graph, changedPaths, []);
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
	indexedInvalidation: string[],
): ThemeGraphUpdate {
	const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
	const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
	const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
	const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]));
	return {
		revision,
		graph: current,
		changedPaths: [...new Set(changedPaths)].sort(),
		invalidatedNodeIds: [
			...new Set([
				...invalidationClosure(current, changedPaths),
				...indexedInvalidation,
			]),
		].sort(),
		affectedPages: affectedPages(current, changedPaths),
		addedNodeIds: addedIds(previousNodes, currentNodes),
		removedNodeIds: addedIds(currentNodes, previousNodes),
		changedNodeIds: changedIds(previousNodes, currentNodes),
		addedEdgeIds: addedIds(previousEdges, currentEdges),
		removedEdgeIds: addedIds(currentEdges, previousEdges),
		changedEdgeIds: changedIds(previousEdges, currentEdges),
	};
}

function fingerprintExternalArtifacts(
	options: Pick<InspectNazareThemeOptions, "metafields" | "themeCheck">,
): string {
	return JSON.stringify({
		metafields: options.metafields,
		themeCheck: options.themeCheck,
	});
}

function externalChangedPaths(
	previous: Pick<InspectNazareThemeOptions, "metafields" | "themeCheck">,
	next: Pick<InspectNazareThemeOptions, "metafields" | "themeCheck">,
): string[] {
	const paths: string[] = [];
	if (JSON.stringify(previous.metafields) !== JSON.stringify(next.metafields)) {
		paths.push(".shopify/metafields.json");
	}
	if (JSON.stringify(previous.themeCheck) !== JSON.stringify(next.themeCheck)) {
		paths.push(".theme-check.yml");
	}
	return paths;
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
