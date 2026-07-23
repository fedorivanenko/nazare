import {
	createThemeDeclarationPass,
	type ThemeDeclarationPassContext,
	type ThemeDeclarationPassRecord,
	type ThemeDeclarationPassResult,
} from "./theme-declaration-pass.js";
import { ThemeFactIndex } from "./theme-fact-index.js";
import { ThemeFactStore, themeFactSourcePath } from "./theme-fact-store.js";
import type {
	InspectNazareThemeOptions,
	InspectNazareThemeResult,
	ThemeAnalysisCache,
	ThemeAnalysisMemo,
	ThemeDeclaration,
	ThemeFileRecord,
	ThemeInputFile,
	ThemeReference,
	ThemeSemanticModel,
} from "./theme-facts.js";
import {
	shareThemeGraphRecords,
	themeGraphFromModel,
} from "./theme-graph-output.js";
import { impactSummary } from "./theme-impact.js";
import { ThemeImpactIndex } from "./theme-impact-index.js";
import {
	createThemeInstancePass,
	type ThemeInstancePassContext,
	type ThemeInstancePassResult,
	type ThemeInstanceRecord,
} from "./theme-instance-pass.js";
import { ThemeMetafieldIndex } from "./theme-metafield-index.js";
import {
	blockId,
	blockInstanceId,
	blockSettingId,
	declarationId,
	fileId,
	referenceId,
	schemaId,
	sectionInstanceId,
	settingId,
	settingReadId,
} from "./theme-model.js";
import {
	incrementalThemePass,
	type PassChange,
	ThemePassScheduler,
} from "./theme-pass-scheduler.js";
import {
	createThemeReferencePass,
	type ThemeReferencePassContext,
} from "./theme-reference-pass.js";
import {
	createThemeResolutionPass,
	type ThemeIncrementalResolutionContext,
} from "./theme-resolution-pass.js";
import { ThemeResolverIndex } from "./theme-resolver-index.js";
import {
	createThemeSchemaSettingPass,
	type ThemeSchemaSettingPassContext,
	type ThemeSchemaSettingPassResult,
	type ThemeSchemaSettingRecord,
} from "./theme-schema-setting-pass.js";
import { ThemeSemanticStore } from "./theme-semantic-store.js";
import { analyzeNazareTheme } from "./theme-workspace.js";

export type ThemeGraphUpdate = {
	revision: number;
	graph: InspectNazareThemeResult;
	changedPaths: string[];
	changedSemanticRecordIds: string[];
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
	private factStore: ThemeFactStore;
	private factIndex: ThemeFactIndex;
	private readonly collectionScheduler = createCollectionScheduler();
	private declarationResultsBySource = new Map<
		string,
		ThemeDeclarationPassResult
	>();
	private referencesBySource = new Map<string, ThemeReference[]>();
	private declarationsByKey = new Map<string, Map<string, ThemeDeclaration>>();
	private referencesById = new Map<string, ThemeReference>();
	private referencesByTargetKey = new Map<
		string,
		Map<string, ThemeReference>
	>();
	private resolvedReferencesById = new Map<string, ThemeReference>();
	private schemaSettingResultsBySource = new Map<
		string,
		ThemeSchemaSettingPassResult
	>();
	private instanceResultsBySource = new Map<string, ThemeInstancePassResult>();
	private semanticStore: ThemeSemanticStore;
	private resolverIndex: ThemeResolverIndex;
	private metafieldIndex: ThemeMetafieldIndex;
	private impactIndex: ThemeImpactIndex;
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
		const collection = runCollectionPasses(
			this.collectionScheduler,
			this.factStore,
			this.collectionState(),
			this.factStore.files(),
		);
		this.applyCollectionState(collection);
		const collectedModel = modelWithCollectedRecords(
			analysis.ir,
			collection.declarations,
			collection.resolvedReferencesById,
			collection.schemaSettings,
			collection.instances,
		);
		const model = new ThemeResolverIndex(collectedModel).resolveModel(
			collectedModel,
		);
		this.semanticStore = new ThemeSemanticStore(model);
		this.resolverIndex = new ThemeResolverIndex(model);
		this.metafieldIndex = new ThemeMetafieldIndex(model);
		this.graph = themeGraphFromModel(this.semanticStore.getModel(), {
			impact: impactSummary(this.semanticStore.getModel()),
		});
		this.impactIndex = new ThemeImpactIndex(this.graph);
		this.externalFingerprint = fingerprintExternalArtifacts(this.options);
	}

	getGraph(): InspectNazareThemeResult {
		return this.graph;
	}

	getDependencies(nodeId: string): string[] {
		return this.impactIndex.getDependencies(nodeId);
	}

	getDependents(nodeId: string): string[] {
		return this.impactIndex.getDependents(nodeId);
	}

	getAffectedPages(nodeId: string): string[] {
		return this.impactIndex.getAffectedPages(nodeId);
	}

	getMetafieldAffectedSources(definitionId: string): string[] {
		return this.metafieldIndex.getAffectedSources(definitionId);
	}

	updateFile(file: ThemeInputFile): ThemeGraphUpdate {
		const previous = this.filesByPath.get(file.path);
		if (previous?.contents === file.contents) {
			return this.emptyUpdate([]);
		}
		this.filesByPath.set(file.path, file);
		try {
			return this.rebuild([file.path], [file.path]);
		} catch (error) {
			if (previous) this.filesByPath.set(file.path, previous);
			else this.filesByPath.delete(file.path);
			throw error;
		}
	}

	removeFile(path: string): ThemeGraphUpdate {
		const previous = this.filesByPath.get(path);
		if (!previous || !this.filesByPath.delete(path)) {
			return this.emptyUpdate([]);
		}
		try {
			return this.rebuild([path], [path]);
		} catch (error) {
			this.filesByPath.set(path, previous);
			throw error;
		}
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
		const previousOptions = {
			metafields: this.options.metafields,
			themeCheck: this.options.themeCheck,
		};
		Object.assign(this.options, options);
		try {
			const update = this.rebuild(changedPaths, []);
			this.externalFingerprint = nextFingerprint;
			return update;
		} catch (error) {
			Object.assign(this.options, previousOptions);
			throw error;
		}
	}

	private rebuild(
		changedPaths: string[],
		factChangedPaths: string[],
	): ThemeGraphUpdate {
		const previous = this.graph;
		const analysis = analyzeNazareTheme(this.files(), this.options);
		const nextFactStore = new ThemeFactStore(this.factStore.all());
		for (const path of factChangedPaths) {
			const facts = analysis.facts.filter(
				(fact) => themeFactSourcePath(fact) === path,
			);
			nextFactStore.replaceFile(path, facts);
		}
		const nextFactIndex = new ThemeFactIndex(nextFactStore.all());
		const collection = runCollectionPasses(
			this.collectionScheduler,
			nextFactStore,
			this.collectionState(),
			factChangedPaths,
		);
		const collectedModel = modelWithCollectedRecords(
			analysis.ir,
			collection.declarations,
			collection.resolvedReferencesById,
			collection.schemaSettings,
			collection.instances,
		);
		const resolvedModel = this.resolverIndex.resolveModel(collectedModel);
		const transaction = this.semanticStore.beginUpdate(resolvedModel);
		const semanticUpdate = transaction.update;
		const nextResolverIndex = new ThemeResolverIndex(semanticUpdate.model);
		const nextMetafieldIndex = new ThemeMetafieldIndex(semanticUpdate.model);
		const nextGraph = shareThemeGraphRecords(
			this.graph,
			themeGraphFromModel(semanticUpdate.model, {
				impact: impactSummary(semanticUpdate.model),
			}),
		);
		const nextImpactIndex = new ThemeImpactIndex(nextGraph);
		const resolverDependents = semanticUpdate.changedRecordIds.flatMap((id) =>
			nextResolverIndex.getDependents(id),
		);
		transaction.commit();
		this.factStore = nextFactStore;
		this.factIndex = nextFactIndex;
		this.applyCollectionState(collection);
		this.resolverIndex = nextResolverIndex;
		this.metafieldIndex = nextMetafieldIndex;
		this.graph = nextGraph;
		this.impactIndex = nextImpactIndex;
		this.revision += 1;
		return diffGraphs(
			this.revision,
			previous,
			this.graph,
			changedPaths,
			[
				...this.factIndex.dependentsOfFiles(changedPaths),
				...resolverDependents,
			],
			semanticUpdate.changedRecordIds,
			changedPaths.flatMap((path) => this.impactIndex.getAffectedPages(path)),
		);
	}

	private collectionState(): ThemeCollectionState {
		return {
			declarations: this.declarationResultsBySource,
			references: this.referencesBySource,
			declarationsByKey: this.declarationsByKey,
			referencesById: this.referencesById,
			referencesByTargetKey: this.referencesByTargetKey,
			resolvedReferencesById: this.resolvedReferencesById,
			schemaSettings: this.schemaSettingResultsBySource,
			instances: this.instanceResultsBySource,
		};
	}

	private applyCollectionState(state: ThemeCollectionState): void {
		this.declarationResultsBySource = state.declarations;
		this.referencesBySource = state.references;
		this.declarationsByKey = state.declarationsByKey;
		this.referencesById = state.referencesById;
		this.referencesByTargetKey = state.referencesByTargetKey;
		this.resolvedReferencesById = state.resolvedReferencesById;
		this.schemaSettingResultsBySource = state.schemaSettings;
		this.instanceResultsBySource = state.instances;
	}

	private emptyUpdate(changedPaths: string[]): ThemeGraphUpdate {
		return diffGraphs(
			this.revision,
			this.graph,
			this.graph,
			changedPaths,
			[],
			[],
			[],
		);
	}

	private files(): ThemeInputFile[] {
		return [...this.filesByPath.values()].sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}
}

type ThemeCollectionContext = ThemeDeclarationPassContext &
	ThemeReferencePassContext &
	ThemeIncrementalResolutionContext &
	ThemeSchemaSettingPassContext &
	ThemeInstancePassContext;

type ThemeCollectionState = {
	declarations: Map<string, ThemeDeclarationPassResult>;
	references: Map<string, ThemeReference[]>;
	declarationsByKey: Map<string, Map<string, ThemeDeclaration>>;
	referencesById: Map<string, ThemeReference>;
	referencesByTargetKey: Map<string, Map<string, ThemeReference>>;
	resolvedReferencesById: Map<string, ThemeReference>;
	schemaSettings: Map<string, ThemeSchemaSettingPassResult>;
	instances: Map<string, ThemeInstancePassResult>;
};

function createCollectionScheduler(): ThemePassScheduler<ThemeCollectionContext> {
	return new ThemePassScheduler<ThemeCollectionContext>([
		incrementalThemePass<
			ThemeCollectionContext,
			string,
			ThemeDeclarationPassRecord
		>(createThemeDeclarationPass()),
		incrementalThemePass<ThemeCollectionContext, string, ThemeReference>(
			createThemeReferencePass(),
		),
		incrementalThemePass<ThemeCollectionContext, string, ThemeReference>(
			createThemeResolutionPass(),
		),
		incrementalThemePass<
			ThemeCollectionContext,
			string,
			ThemeSchemaSettingRecord
		>(createThemeSchemaSettingPass()),
		incrementalThemePass<ThemeCollectionContext, string, ThemeInstanceRecord>(
			createThemeInstancePass(),
		),
	]);
}

function runCollectionPasses(
	scheduler: ThemePassScheduler<ThemeCollectionContext>,
	facts: ThemeFactStore,
	previous: ThemeCollectionState,
	changedPaths: string[],
): ThemeCollectionState {
	const state = cloneCollectionState(previous);
	const context: ThemeCollectionContext = {
		facts,
		resultsBySource: state.declarations,
		referencesBySource: state.references,
		declarationsByKey: state.declarationsByKey,
		referencesById: state.referencesById,
		referencesByTargetKey: state.referencesByTargetKey,
		resolvedReferencesById: state.resolvedReferencesById,
		schemaSettingResultsBySource: state.schemaSettings,
		instanceResultsBySource: state.instances,
		instanceIds: {
			section: sectionInstanceId,
			block: blockInstanceId,
		},
		ids: {
			file: fileId,
			declaration: declarationId,
			schema: schemaId,
			setting: settingId,
			block: blockId,
			blockSetting: blockSettingId,
			settingRead: settingReadId,
		},
		id: referenceId,
	};
	scheduler.execute(
		[...new Set(changedPaths)]
			.sort((a, b) => a.localeCompare(b))
			.map((path): PassChange => ({ kind: "factsChanged", path })),
		context,
	);
	return state;
}

function cloneCollectionState(
	state: ThemeCollectionState,
): ThemeCollectionState {
	return {
		declarations: cloneDeclarationResults(state.declarations),
		references: new Map(
			[...state.references].map(([path, records]) => [path, [...records]]),
		),
		declarationsByKey: cloneRecordIndex(state.declarationsByKey),
		referencesById: new Map(state.referencesById),
		referencesByTargetKey: cloneRecordIndex(state.referencesByTargetKey),
		resolvedReferencesById: new Map(state.resolvedReferencesById),
		schemaSettings: cloneSchemaSettingResults(state.schemaSettings),
		instances: cloneInstanceResults(state.instances),
	};
}

function cloneRecordIndex<RecordValue>(
	index: Map<string, Map<string, RecordValue>>,
): Map<string, Map<string, RecordValue>> {
	return new Map([...index].map(([key, records]) => [key, new Map(records)]));
}

function cloneDeclarationResults(
	results: Map<string, ThemeDeclarationPassResult>,
): Map<string, ThemeDeclarationPassResult> {
	return new Map(
		[...results].map(([path, result]) => [
			path,
			{ files: new Map(result.files), declarations: [...result.declarations] },
		]),
	);
}

function cloneSchemaSettingResults(
	results: Map<string, ThemeSchemaSettingPassResult>,
): Map<string, ThemeSchemaSettingPassResult> {
	return new Map(
		[...results].map(([path, result]) => [
			path,
			{
				schemas: [...result.schemas],
				settings: [...result.settings],
				blocks: [...result.blocks],
				blockSettings: [...result.blockSettings],
				settingReads: [...result.settingReads],
			},
		]),
	);
}

function cloneInstanceResults(
	results: Map<string, ThemeInstancePassResult>,
): Map<string, ThemeInstancePassResult> {
	return new Map(
		[...results].map(([path, result]) => [
			path,
			{
				sectionInstances: [...result.sectionInstances],
				blockInstances: [...result.blockInstances],
			},
		]),
	);
}

function modelWithCollectedRecords(
	model: ThemeSemanticModel,
	declarationsBySource: Map<string, ThemeDeclarationPassResult>,
	resolvedReferencesById: Map<string, ThemeReference>,
	schemaSettingsBySource: Map<string, ThemeSchemaSettingPassResult>,
	instancesBySource: Map<string, ThemeInstancePassResult>,
): ThemeSemanticModel {
	const files: ThemeFileRecord[] = [];
	const declarations: ThemeDeclaration[] = [];
	for (const path of [...declarationsBySource.keys()].sort((a, b) =>
		a.localeCompare(b),
	)) {
		const result = declarationsBySource.get(path);
		if (!result) continue;
		files.push(...result.files.values());
		declarations.push(...result.declarations);
	}
	const references = [...resolvedReferencesById.values()].sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	const schemaSettings = [...schemaSettingsBySource.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((path) => schemaSettingsBySource.get(path))
		.filter((result): result is ThemeSchemaSettingPassResult =>
			Boolean(result),
		);
	const analyzedSettingReads = new Map(
		model.settingReads.map((read) => [read.id, read]),
	);
	const analyzedSectionInstances = new Map(
		model.sectionInstances.map((instance) => [instance.id, instance]),
	);
	const analyzedBlockInstances = new Map(
		model.blockInstances.map((instance) => [instance.id, instance]),
	);
	const instances = [...instancesBySource.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((path) => instancesBySource.get(path))
		.filter((result): result is ThemeInstancePassResult => Boolean(result));
	return {
		...model,
		files,
		declarations,
		references,
		schemas: schemaSettings.flatMap((result) => result.schemas),
		settings: schemaSettings.flatMap((result) => result.settings),
		blocks: schemaSettings.flatMap((result) => result.blocks),
		blockSettings: schemaSettings.flatMap((result) => result.blockSettings),
		settingReads: schemaSettings.flatMap((result) =>
			result.settingReads.map(
				(read) => analyzedSettingReads.get(read.id) ?? read,
			),
		),
		sectionInstances: instances.flatMap((result) =>
			result.sectionInstances.map(
				(instance) => analyzedSectionInstances.get(instance.id) ?? instance,
			),
		),
		blockInstances: instances.flatMap((result) =>
			result.blockInstances.map(
				(instance) => analyzedBlockInstances.get(instance.id) ?? instance,
			),
		),
	};
}

function diffGraphs(
	revision: number,
	previous: InspectNazareThemeResult,
	current: InspectNazareThemeResult,
	changedPaths: string[],
	indexedInvalidation: string[],
	changedSemanticRecordIds: string[],
	indexedAffectedPages: string[],
): ThemeGraphUpdate {
	const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
	const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
	const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
	const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]));
	return {
		revision,
		graph: current,
		changedPaths: [...new Set(changedPaths)].sort(),
		changedSemanticRecordIds,
		invalidatedNodeIds: [
			...new Set([
				...invalidationClosure(current, changedPaths),
				...indexedInvalidation,
			]),
		].sort(),
		affectedPages: [
			...new Set([
				...affectedPages(current, changedPaths),
				...indexedAffectedPages,
			]),
		].sort(),
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
