import {
	createThemeCapabilityPass,
	type ThemeCapabilityPassContext,
} from "./theme-capability-pass.js";
import {
	createThemeCapabilitySignalPass,
	type ThemeCapabilitySignalPassContext,
} from "./theme-capability-signal-pass.js";
import {
	createThemeClassificationPass,
	type ThemeClassificationPassContext,
} from "./theme-classification-pass.js";
import { ThemeRenderDependencyIndex } from "./theme-data-flow-index.js";
import {
	createThemeDataFlowFixedPointPass,
	createThemeDataFlowInputPass,
	deriveRenderArgumentDataAccesses,
	deriveThemeRenderSites,
	type ThemeDataFlowDerivedRecord,
	type ThemeDataFlowFixedPointContext,
	type ThemeDataFlowInputPassContext,
	type ThemeDataFlowInputPassResult,
	type ThemeDataFlowInputRecord,
} from "./theme-data-flow-pass.js";
import {
	createThemeDeclarationPass,
	type ThemeDeclarationPassContext,
	type ThemeDeclarationPassRecord,
	type ThemeDeclarationPassResult,
} from "./theme-declaration-pass.js";
import { ThemeDiagnosticStore } from "./theme-diagnostic-store.js";
import { deriveThemeEvidence } from "./theme-evidence-pass.js";
import { deriveThemeExpectedInputs } from "./theme-expected-input-pass.js";
import { ThemeFactIndex } from "./theme-fact-index.js";
import { ThemeFactStore, themeFactSourcePath } from "./theme-fact-store.js";
import type {
	InspectNazareThemeOptions,
	InspectNazareThemeResult,
	ThemeAnalysisCache,
	ThemeAnalysisMemo,
	ThemeCapabilityRecord,
	ThemeCapabilitySignalRecord,
	ThemeClassificationRecord,
	ThemeDataAccessRecord,
	ThemeDeclaration,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeFileRecord,
	ThemeInputFile,
	ThemeReference,
	ThemeRenderSiteRecord,
	ThemeSemanticModel,
} from "./theme-facts.js";
import {
	themeGraphFromModel,
	themeGraphFromRecords,
	themeGraphRecordsFromModel,
} from "./theme-graph-output.js";
import {
	THEME_GRAPH_METAFIELD_SCHEMA_OWNER,
	ThemeGraphStore,
} from "./theme-graph-store.js";
import { ThemeImpactIndex } from "./theme-impact-index.js";
import {
	createThemeInstancePass,
	type ThemeInstancePassContext,
	type ThemeInstancePassResult,
	type ThemeInstanceRecord,
} from "./theme-instance-pass.js";
import {
	createThemeLocalePass,
	type ThemeLocalePassContext,
	type ThemeLocalePassResult,
	type ThemeLocaleRecord,
} from "./theme-locale-pass.js";
import { ThemeMetafieldIndex } from "./theme-metafield-index.js";
import {
	createThemeMetafieldPass,
	type ThemeMetafieldPassContext,
	type ThemeMetafieldRecord,
} from "./theme-metafield-pass.js";
import {
	collectMetafieldDefinitions,
	metafieldJoinKey,
	type ThemeMetafieldAnalysis,
} from "./theme-metafields.js";
import {
	blockId,
	blockInstanceId,
	blockSettingId,
	dataAccessId,
	declarationId,
	fileId,
	localeKeyId,
	localeReferenceId,
	localeTranslationId,
	referenceId,
	renderArgumentId,
	renderSiteId,
	schemaId,
	sectionInstanceId,
	settingId,
	settingReadId,
	variableReadId,
} from "./theme-model.js";
import {
	fixedPointThemePass,
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
import {
	createThemeSchemaSettingPass,
	type ThemeSchemaSettingPassContext,
	type ThemeSchemaSettingPassResult,
	type ThemeSchemaSettingRecord,
} from "./theme-schema-setting-pass.js";
import { ThemeSemanticStore } from "./theme-semantic-store.js";
import { analyzeNazareTheme } from "./theme-workspace.js";

export type ThemeUpdateTelemetry = {
	filesParsed: number;
	passKeysProcessed: number;
	semanticRecordsReplaced: number;
	graphRecordsReplaced: number;
	outputsEmitted: number;
	elapsedMs: number;
	peakMemoryBytes: number;
};

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
	telemetry: ThemeUpdateTelemetry;
};

export class ThemeProgram {
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
	private localeResultsBySource = new Map<string, ThemeLocalePassResult>();
	private dataFlowInputResultsBySource = new Map<
		string,
		ThemeDataFlowInputPassResult
	>();
	private derivedDataFlowBySource = new Map<
		string,
		ThemeDerivedDataFlowResult
	>();
	private metafieldResult = { current: emptyMetafieldAnalysis() };
	private capabilitySignalsBySource = new Map<
		string,
		ThemeCapabilitySignalRecord[]
	>();
	private capabilitiesBySource = new Map<string, ThemeCapabilityRecord[]>();
	private classificationsBySource = new Map<
		string,
		ThemeClassificationRecord[]
	>();
	private diagnosticStore = new ThemeDiagnosticStore();
	private semanticStore: ThemeSemanticStore;
	private metafieldIndex: ThemeMetafieldIndex;
	private impactIndex: ThemeImpactIndex;
	private graph: InspectNazareThemeResult;
	private graphStore: ThemeGraphStore;
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
			this.options.metafields,
		);
		this.applyCollectionState(collection);
		const collectedModel = modelWithCollectedRecords(
			analysis.ir,
			collection.declarations,
			collection.resolvedReferencesById,
			collection.schemaSettings,
			collection.instances,
			collection.locales,
			collection.dataFlowInputs,
			collection.derivedDataFlow,
			collection.metafields.current,
			collection.capabilitySignals,
			collection.capabilities,
			collection.classifications,
		);
		const model = collectedModel;
		this.semanticStore = new ThemeSemanticStore(model);
		this.metafieldIndex = new ThemeMetafieldIndex(model);
		const indexedGraph = graphWithIndexedImpact(this.semanticStore.getModel());
		this.graph = indexedGraph.graph;
		this.graphStore = new ThemeGraphStore(this.graph);
		this.graphStore.replaceOwnership(this.semanticStore.getModel());
		this.impactIndex = indexedGraph.index;
		this.externalFingerprint = fingerprintExternalArtifacts(this.options);
	}

	getGraph(): InspectNazareThemeResult {
		return this.graph;
	}

	getModel(): ThemeSemanticModel {
		return this.semanticStore.getModel();
	}

	getFacts(): ThemeFact[] {
		return this.factStore.all();
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
		options: Pick<
			InspectNazareThemeOptions,
			"exclude" | "metafields" | "themeCheck"
		>,
	): ThemeGraphUpdate {
		const nextOptions = { ...this.options, ...options };
		const nextFingerprint = fingerprintExternalArtifacts(nextOptions);
		if (nextFingerprint === this.externalFingerprint) {
			return this.emptyUpdate([]);
		}
		const changedPaths = externalChangedPaths(this.options, nextOptions);
		const previousOptions = {
			exclude: this.options.exclude,
			metafields: this.options.metafields,
			themeCheck: this.options.themeCheck,
		};
		const exclusionChanged =
			JSON.stringify(previousOptions.exclude) !==
			JSON.stringify(nextOptions.exclude);
		Object.assign(this.options, options);
		try {
			const update = this.rebuild(
				changedPaths,
				exclusionChanged ? this.files().map((file) => file.path) : [],
			);
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
		const startedAt = telemetryNow();
		const memoryAtStart = telemetryMemory();
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
			this.options.metafields,
			metafieldSnapshotChanges(
				changedPaths,
				this.metafieldResult.current,
				this.options.metafields,
			),
		);
		const collectedBaseModel = modelWithCollectedRecords(
			analysis.ir,
			collection.declarations,
			collection.resolvedReferencesById,
			collection.schemaSettings,
			collection.instances,
			collection.locales,
			collection.dataFlowInputs,
			collection.derivedDataFlow,
			collection.metafields.current,
			collection.capabilitySignals,
			collection.capabilities,
			collection.classifications,
		);
		const collectedModel = {
			...collectedBaseModel,
			evidence: deriveThemeEvidence(collectedBaseModel, nextFactStore.all()),
		};
		const transaction = this.semanticStore.beginUpdate(collectedModel);
		const semanticUpdate = transaction.update;
		const nextMetafieldIndex = new ThemeMetafieldIndex(semanticUpdate.model);
		const changedSemanticIds = [
			...semanticUpdate.addedRecordIds,
			...semanticUpdate.changedRecordIds,
			...semanticUpdate.removedRecordIds,
		];
		if (changedPaths.includes(".shopify/metafields.json")) {
			changedSemanticIds.push(THEME_GRAPH_METAFIELD_SCHEMA_OWNER);
		}
		const nextGraphStore = this.graphStore.fork();
		const selectedSemanticIds =
			nextGraphStore.expandSemanticIds(changedSemanticIds);
		const projectedRecords = themeGraphRecordsFromModel(
			semanticUpdate.model,
			selectedSemanticIds,
		);
		const composedRecords = nextGraphStore.composeOwnedRecords(
			projectedRecords.nodes,
			projectedRecords.edges,
			selectedSemanticIds,
		);
		const nextGraph = themeGraphFromRecords(
			semanticUpdate.model,
			composedRecords.nodes,
			composedRecords.edges,
			{
				impact: {
					dependencies: {},
					dependents: {},
					affectedPages: {},
					unusedFiles: [],
				},
			},
		);
		nextGraphStore.applyGraph(nextGraph);
		nextGraphStore.replaceOwnership(semanticUpdate.model);
		const nextImpactIndex = this.impactIndex.fork();
		nextImpactIndex.applyGraph(nextGraph);
		nextGraph.impact = nextImpactIndex.toSummary();
		nextGraphStore.applyGraph(nextGraph);
		nextGraphStore.replaceOwnership(semanticUpdate.model);
		const metafieldDefinitionIds = new Set([
			...this.semanticStore
				.getModel()
				.metafieldDefinitions.map((definition) => definition.id),
			...semanticUpdate.model.metafieldDefinitions.map(
				(definition) => definition.id,
			),
		]);
		const changedMetafieldDefinitionIds = changedSemanticIds.filter((id) =>
			metafieldDefinitionIds.has(id),
		);
		const metafieldAffectedPages = changedMetafieldDefinitionIds.flatMap(
			(id) => [
				...this.impactIndex.getAffectedPages(id),
				...nextImpactIndex.getAffectedPages(id),
			],
		);
		const changedRecordIds = new Set(changedSemanticIds);
		const resolverDependents = semanticUpdate.model.references
			.filter(
				(reference) =>
					reference.resolvedDeclarationId &&
					changedRecordIds.has(reference.resolvedDeclarationId),
			)
			.map((reference) => reference.fromPath)
			.sort();
		validateStagedProgram({
			model: semanticUpdate.model,
			graph: nextGraph,
			factStore: nextFactStore,
			factIndex: nextFactIndex,
			diagnostics: collection.diagnostics,
			analysisFacts: analysis.facts,
			factChangedPaths,
		});
		if (shouldRunCanonicalValidation(this.options, this.revision + 1)) {
			validateCanonicalProgram(
				this.files(),
				this.options,
				semanticUpdate.model,
				nextGraph,
			);
		}
		transaction.commit();
		this.factStore = nextFactStore;
		this.factIndex = nextFactIndex;
		this.applyCollectionState(collection);
		this.metafieldIndex = nextMetafieldIndex;
		this.graph = nextGraph;
		this.graphStore = nextGraphStore;
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
			[
				...changedPaths.flatMap((path) =>
					this.impactIndex.getAffectedPages(path),
				),
				...metafieldAffectedPages,
			],
			{
				filesParsed: factChangedPaths.length,
				passKeysProcessed: collection.processedPassKeys,
				semanticRecordsReplaced: changedSemanticIds.length,
				outputsEmitted: 0,
				elapsedMs: telemetryNow() - startedAt,
				peakMemoryBytes: Math.max(memoryAtStart, telemetryMemory()),
			},
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
			locales: this.localeResultsBySource,
			dataFlowInputs: this.dataFlowInputResultsBySource,
			derivedDataFlow: this.derivedDataFlowBySource,
			metafields: this.metafieldResult,
			capabilitySignals: this.capabilitySignalsBySource,
			capabilities: this.capabilitiesBySource,
			classifications: this.classificationsBySource,
			diagnostics: this.diagnosticStore,
			processedPassKeys: 0,
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
		this.localeResultsBySource = state.locales;
		this.dataFlowInputResultsBySource = state.dataFlowInputs;
		this.derivedDataFlowBySource = state.derivedDataFlow;
		this.metafieldResult = state.metafields;
		this.capabilitySignalsBySource = state.capabilitySignals;
		this.capabilitiesBySource = state.capabilities;
		this.classificationsBySource = state.classifications;
		this.diagnosticStore = state.diagnostics;
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

/** @deprecated Use ThemeProgram. */
export class ThemeWorkspaceSession extends ThemeProgram {}

type ThemeCollectionContext = ThemeDeclarationPassContext &
	ThemeReferencePassContext &
	ThemeIncrementalResolutionContext &
	ThemeSchemaSettingPassContext &
	ThemeInstancePassContext &
	ThemeLocalePassContext &
	ThemeCapabilitySignalPassContext &
	ThemeCapabilityPassContext &
	ThemeClassificationPassContext &
	ThemeMetafieldPassContext &
	ThemeDataFlowInputPassContext &
	ThemeDataFlowFixedPointContext;

type ThemeDerivedDataFlowResult = {
	expectedInputs: ThemeExpectedInputRecord[];
	renderSites: ThemeRenderSiteRecord[];
	dataAccesses: ThemeDataAccessRecord[];
};

type ThemeCollectionState = {
	declarations: Map<string, ThemeDeclarationPassResult>;
	references: Map<string, ThemeReference[]>;
	declarationsByKey: Map<string, Map<string, ThemeDeclaration>>;
	referencesById: Map<string, ThemeReference>;
	referencesByTargetKey: Map<string, Map<string, ThemeReference>>;
	resolvedReferencesById: Map<string, ThemeReference>;
	schemaSettings: Map<string, ThemeSchemaSettingPassResult>;
	instances: Map<string, ThemeInstancePassResult>;
	locales: Map<string, ThemeLocalePassResult>;
	dataFlowInputs: Map<string, ThemeDataFlowInputPassResult>;
	derivedDataFlow: Map<string, ThemeDerivedDataFlowResult>;
	metafields: { current: ThemeMetafieldAnalysis };
	capabilitySignals: Map<string, ThemeCapabilitySignalRecord[]>;
	capabilities: Map<string, ThemeCapabilityRecord[]>;
	classifications: Map<string, ThemeClassificationRecord[]>;
	diagnostics: ThemeDiagnosticStore;
	processedPassKeys: number;
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
		incrementalThemePass<ThemeCollectionContext, string, ThemeLocaleRecord>(
			createThemeLocalePass(),
		),
		incrementalThemePass<
			ThemeCollectionContext,
			string,
			ThemeDataFlowInputRecord
		>(createThemeDataFlowInputPass()),
		fixedPointThemePass<
			ThemeCollectionContext,
			string,
			ThemeDataFlowDerivedRecord
		>(createThemeDataFlowFixedPointPass()),
		incrementalThemePass<
			ThemeCollectionContext,
			string,
			ThemeCapabilitySignalRecord
		>(createThemeCapabilitySignalPass()),
		incrementalThemePass<ThemeCollectionContext, string, ThemeMetafieldRecord>(
			createThemeMetafieldPass(),
		),
		incrementalThemePass<ThemeCollectionContext, string, ThemeCapabilityRecord>(
			createThemeCapabilityPass(),
		),
		incrementalThemePass<
			ThemeCollectionContext,
			string,
			ThemeClassificationRecord
		>(createThemeClassificationPass()),
	]);
}

function runCollectionPasses(
	scheduler: ThemePassScheduler<ThemeCollectionContext>,
	facts: ThemeFactStore,
	previous: ThemeCollectionState,
	changedPaths: string[],
	metafieldSnapshot: InspectNazareThemeOptions["metafields"],
	additionalChanges: PassChange[] = [],
): ThemeCollectionState {
	const state = cloneCollectionState(previous);
	let derivedSnapshot: Map<string, ThemeDerivedDataFlowResult> | undefined;
	const context: ThemeCollectionContext = {
		facts,
		resultsBySource: state.declarations,
		referencesBySource: state.references,
		declarationsByKey: state.declarationsByKey,
		referencesById: state.referencesById,
		referencesByTargetKey: state.referencesByTargetKey,
		resolvedReferencesById: state.resolvedReferencesById,
		diagnosticStore: state.diagnostics,
		schemaSettingResultsBySource: state.schemaSettings,
		instanceResultsBySource: state.instances,
		instanceIds: {
			section: sectionInstanceId,
			block: blockInstanceId,
		},
		localeResultsBySource: state.locales,
		localeIds: {
			key: localeKeyId,
			translation: localeTranslationId,
			reference: localeReferenceId,
		},
		dataFlowInputResultsBySource: state.dataFlowInputs,
		metafieldSnapshot,
		get dataAccessesBySource() {
			return dataAccessesBySource(state);
		},
		capabilitySignalsBySource: state.capabilitySignals,
		capabilitiesBySource: state.capabilities,
		classificationsBySource: state.classifications,
		metafieldResult: state.metafields,
		dataFlowIds: {
			dataAccess: dataAccessId,
			variableRead: variableReadId,
			renderArgument: renderArgumentId,
		},
		get renderDependencies() {
			const inputs = allDataFlowInputs(state.dataFlowInputs);
			return new ThemeRenderDependencyIndex(
				allDeclarations(state.declarations),
				inputs.renderSiteFacts,
			);
		},
		recomputeDataFlowGroup(paths) {
			derivedSnapshot ??= deriveDataFlowSnapshot(state);
			const records: ThemeDataFlowDerivedRecord[] = [];
			const changed = new Set<string>();
			for (const path of paths) {
				const previousResult = state.derivedDataFlow.get(path);
				const nextResult = derivedSnapshot.get(path);
				if (JSON.stringify(previousResult) === JSON.stringify(nextResult))
					continue;
				changed.add(path);
				if (nextResult) {
					state.derivedDataFlow.set(path, nextResult);
					records.push(
						...nextResult.expectedInputs,
						...nextResult.renderSites,
						...nextResult.dataAccesses,
					);
				} else {
					state.derivedDataFlow.delete(path);
				}
			}
			return {
				records,
				changes: [...changed].sort().map(
					(owner): PassChange => ({
						kind: "diagnosticsChanged",
						pass: "render-data-flow",
						owner,
					}),
				),
				propagatePaths: [...changed],
			};
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
	const execution = scheduler.execute(
		[...new Set(changedPaths)]
			.sort((a, b) => a.localeCompare(b))
			.map((path): PassChange => ({ kind: "factsChanged", path }))
			.concat(additionalChanges),
		context,
	);
	state.processedPassKeys = execution.trace.length;
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
		locales: cloneLocaleResults(state.locales),
		dataFlowInputs: cloneDataFlowInputResults(state.dataFlowInputs),
		derivedDataFlow: cloneDerivedDataFlowResults(state.derivedDataFlow),
		metafields: { current: cloneMetafieldAnalysis(state.metafields.current) },
		capabilitySignals: cloneRecordsBySource(state.capabilitySignals),
		capabilities: cloneRecordsBySource(state.capabilities),
		classifications: cloneRecordsBySource(state.classifications),
		diagnostics: state.diagnostics.fork(),
		processedPassKeys: 0,
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

function cloneLocaleResults(
	results: Map<string, ThemeLocalePassResult>,
): Map<string, ThemeLocalePassResult> {
	return new Map(
		[...results].map(([path, result]) => [
			path,
			{
				localeKeys: [...result.localeKeys],
				localeTranslations: [...result.localeTranslations],
				localeReferences: [...result.localeReferences],
			},
		]),
	);
}

function cloneDataFlowInputResults(
	results: Map<string, ThemeDataFlowInputPassResult>,
): Map<string, ThemeDataFlowInputPassResult> {
	return new Map(
		[...results].map(([path, result]) => [
			path,
			{
				dataAccesses: [...result.dataAccesses],
				variableReads: [...result.variableReads],
				guardedObjects: [...result.guardedObjects],
				defaultedObjects: [...result.defaultedObjects],
				docParams: [...result.docParams],
				renderSiteFacts: [...result.renderSiteFacts],
				renderArguments: [...result.renderArguments],
			},
		]),
	);
}

function emptyMetafieldAnalysis(): ThemeMetafieldAnalysis {
	return {
		definitions: [],
		reads: [],
		issues: [],
		state: "unknown",
		path: ".shopify/metafields.json",
	};
}

function cloneMetafieldAnalysis(
	analysis: ThemeMetafieldAnalysis,
): ThemeMetafieldAnalysis {
	return {
		...analysis,
		definitions: [...analysis.definitions],
		reads: [...analysis.reads],
		issues: [...analysis.issues],
	};
}

function dataAccessesBySource(
	state: ThemeCollectionState,
): Map<string, ThemeDataAccessRecord[]> {
	const accesses = new Map<string, ThemeDataAccessRecord[]>();
	for (const [path, result] of state.dataFlowInputs) {
		accesses.set(path, [...result.dataAccesses]);
	}
	for (const [path, result] of state.derivedDataFlow) {
		accesses.set(path, [...(accesses.get(path) ?? []), ...result.dataAccesses]);
	}
	return accesses;
}

function metafieldSnapshotChanges(
	changedPaths: string[],
	previous: ThemeMetafieldAnalysis,
	snapshot: InspectNazareThemeOptions["metafields"],
): PassChange[] {
	if (!changedPaths.includes(".shopify/metafields.json")) return [];
	const next = collectMetafieldDefinitions(snapshot);
	const previousByKey = new Map(
		previous.definitions.map((definition) => [
			metafieldJoinKey(definition.owner, definition.namespace, definition.key),
			definition,
		]),
	);
	const nextByKey = new Map(
		next.definitions.map((definition) => [
			metafieldJoinKey(definition.owner, definition.namespace, definition.key),
			definition,
		]),
	);
	const changedKeys = [
		...new Set([...previousByKey.keys(), ...nextByKey.keys()]),
	]
		.filter(
			(key) =>
				JSON.stringify(previousByKey.get(key)) !==
				JSON.stringify(nextByKey.get(key)),
		)
		.sort();
	return [
		{
			kind: "metafieldSnapshotChanged",
			changedKeys,
			state: next.state,
		},
	];
}

function cloneRecordsBySource<T>(records: Map<string, T[]>): Map<string, T[]> {
	return new Map(records);
}

function cloneDerivedDataFlowResults(
	results: Map<string, ThemeDerivedDataFlowResult>,
): Map<string, ThemeDerivedDataFlowResult> {
	return new Map(
		[...results].map(([path, result]) => [
			path,
			{
				expectedInputs: [...result.expectedInputs],
				renderSites: [...result.renderSites],
				dataAccesses: [...result.dataAccesses],
			},
		]),
	);
}

function allDeclarations(
	results: Map<string, ThemeDeclarationPassResult>,
): ThemeDeclaration[] {
	return [...results.values()].flatMap((result) => result.declarations);
}

function allDataFlowInputs(
	results: Map<string, ThemeDataFlowInputPassResult>,
): ThemeDataFlowInputPassResult {
	const values = [...results.values()];
	return {
		dataAccesses: values.flatMap((result) => result.dataAccesses),
		variableReads: values.flatMap((result) => result.variableReads),
		guardedObjects: values.flatMap((result) => result.guardedObjects),
		defaultedObjects: values.flatMap((result) => result.defaultedObjects),
		docParams: values.flatMap((result) => result.docParams),
		renderSiteFacts: values.flatMap((result) => result.renderSiteFacts),
		renderArguments: values.flatMap((result) => result.renderArguments),
	};
}

function deriveDataFlowSnapshot(
	state: ThemeCollectionState,
): Map<string, ThemeDerivedDataFlowResult> {
	const declarations = allDeclarations(state.declarations);
	const inputs = allDataFlowInputs(state.dataFlowInputs);
	const declarationByKey = new Map<string, ThemeDeclaration>();
	for (const [key, candidates] of state.declarationsByKey) {
		if (candidates.size === 1) {
			const declaration = candidates.values().next().value;
			if (declaration) declarationByKey.set(key, declaration);
		}
	}
	const expectedInputs = deriveThemeExpectedInputs(
		declarations,
		inputs.dataAccesses,
		inputs.variableReads,
		new Set(inputs.guardedObjects),
		new Set(inputs.defaultedObjects),
		inputs.docParams,
		inputs.renderArguments,
	);
	const renderSites = deriveThemeRenderSites(
		inputs.renderSiteFacts,
		declarationByKey,
		inputs.renderArguments,
		renderSiteId,
	);
	const dataAccesses = deriveRenderArgumentDataAccesses(
		renderSites,
		inputs.renderArguments,
		expectedInputs,
		declarations,
		inputs.variableReads,
	);
	const paths = new Set([
		...expectedInputs.map((record) => record.path),
		...renderSites.map((record) => record.fromPath),
		...dataAccesses.map((record) => record.fromPath),
	]);
	return new Map(
		[...paths].sort().map((path) => [
			path,
			{
				expectedInputs: expectedInputs.filter((record) => record.path === path),
				renderSites: renderSites.filter((record) => record.fromPath === path),
				dataAccesses: dataAccesses.filter((record) => record.fromPath === path),
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
	localesBySource: Map<string, ThemeLocalePassResult>,
	dataFlowInputsBySource: Map<string, ThemeDataFlowInputPassResult>,
	derivedDataFlowBySource: Map<string, ThemeDerivedDataFlowResult>,
	metafields: ThemeMetafieldAnalysis,
	capabilitySignalsBySource: Map<string, ThemeCapabilitySignalRecord[]>,
	capabilitiesBySource: Map<string, ThemeCapabilityRecord[]>,
	classificationsBySource: Map<string, ThemeClassificationRecord[]>,
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
	const locales = [...localesBySource.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((path) => localesBySource.get(path))
		.filter((result): result is ThemeLocalePassResult => Boolean(result));
	const analyzedLocaleReferences = new Map(
		model.localeReferences.map((reference) => [reference.id, reference]),
	);
	const dataFlowInputs = [...dataFlowInputsBySource.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((path) => dataFlowInputsBySource.get(path))
		.filter((result): result is ThemeDataFlowInputPassResult =>
			Boolean(result),
		);
	const derivedDataFlow = [...derivedDataFlowBySource.values()];
	const derivedDataAccesses = derivedDataFlow.flatMap(
		(result) => result.dataAccesses,
	);
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
		localeKeys: uniqueById(locales.flatMap((result) => result.localeKeys)),
		localeTranslations: uniqueById(
			locales.flatMap((result) => result.localeTranslations),
		),
		localeReferences: uniqueById(
			locales.flatMap((result) =>
				result.localeReferences.map(
					(reference) =>
						analyzedLocaleReferences.get(reference.id) ?? reference,
				),
			),
		),
		dataAccesses: uniqueById([
			...dataFlowInputs.flatMap((result) => result.dataAccesses),
			...derivedDataAccesses,
		]),
		variableReads: uniqueById(
			dataFlowInputs.flatMap((result) => result.variableReads),
		),
		renderArguments: uniqueById(
			dataFlowInputs.flatMap((result) => result.renderArguments),
		),
		expectedInputs: uniqueById(
			derivedDataFlow.flatMap((result) => result.expectedInputs),
		),
		renderSites: uniqueById(
			derivedDataFlow.flatMap((result) => result.renderSites),
		),
		metafieldDefinitions: metafields.definitions,
		metafieldReads: metafields.reads,
		metafieldSchema: {
			state: metafields.state,
			path: metafields.path,
			pulledAt: metafields.pulledAt ?? null,
		},
		capabilitySignals: uniqueById(
			[...capabilitySignalsBySource.values()].flat(),
		),
		capabilities: uniqueById([...capabilitiesBySource.values()].flat()),
		classifications: uniqueById([...classificationsBySource.values()].flat()),
	};
}

function uniqueById<RecordValue extends { id: string }>(
	records: RecordValue[],
): RecordValue[] {
	return [
		...new Map(records.map((record) => [record.id, record])).values(),
	].sort((a, b) => a.id.localeCompare(b.id));
}

function diffGraphs(
	revision: number,
	previous: InspectNazareThemeResult,
	current: InspectNazareThemeResult,
	changedPaths: string[],
	indexedInvalidation: string[],
	changedSemanticRecordIds: string[],
	indexedAffectedPages: string[],
	telemetry: Omit<ThemeUpdateTelemetry, "graphRecordsReplaced"> = {
		filesParsed: 0,
		passKeysProcessed: 0,
		semanticRecordsReplaced: 0,
		outputsEmitted: 0,
		elapsedMs: 0,
		peakMemoryBytes: telemetryMemory(),
	},
): ThemeGraphUpdate {
	const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
	const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
	const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
	const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]));
	const update: ThemeGraphUpdate = {
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
		telemetry: { ...telemetry, graphRecordsReplaced: 0 },
	};
	update.telemetry.graphRecordsReplaced =
		update.addedNodeIds.length +
		update.removedNodeIds.length +
		update.changedNodeIds.length +
		update.addedEdgeIds.length +
		update.removedEdgeIds.length +
		update.changedEdgeIds.length;
	return update;
}

function telemetryNow(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function telemetryMemory(): number {
	const processLike = globalThis as typeof globalThis & {
		process?: { memoryUsage?: () => { heapUsed: number } };
	};
	return processLike.process?.memoryUsage?.().heapUsed ?? 0;
}

function graphWithoutImpact(
	model: ThemeSemanticModel,
): InspectNazareThemeResult {
	return themeGraphFromModel(model, {
		impact: {
			dependencies: {},
			dependents: {},
			affectedPages: {},
			unusedFiles: [],
		},
	});
}

function graphWithIndexedImpact(model: ThemeSemanticModel): {
	graph: InspectNazareThemeResult;
	index: ThemeImpactIndex;
} {
	const graph = graphWithoutImpact(model);
	const index = new ThemeImpactIndex(graph);
	graph.impact = index.toSummary();
	return { graph, index };
}

function fingerprintExternalArtifacts(
	options: Pick<
		InspectNazareThemeOptions,
		"exclude" | "metafields" | "themeCheck"
	>,
): string {
	return JSON.stringify({
		exclude: options.exclude,
		metafields: options.metafields,
		themeCheck: options.themeCheck,
	});
}

function externalChangedPaths(
	previous: Pick<
		InspectNazareThemeOptions,
		"exclude" | "metafields" | "themeCheck"
	>,
	next: Pick<
		InspectNazareThemeOptions,
		"exclude" | "metafields" | "themeCheck"
	>,
): string[] {
	const paths: string[] = [];
	if (JSON.stringify(previous.exclude) !== JSON.stringify(next.exclude)) {
		paths.push(".nazare/exclusions");
	}
	if (JSON.stringify(previous.metafields) !== JSON.stringify(next.metafields)) {
		paths.push(".shopify/metafields.json");
	}
	if (JSON.stringify(previous.themeCheck) !== JSON.stringify(next.themeCheck)) {
		paths.push(".theme-check.yml");
	}
	return paths;
}

function validateStagedProgram(input: {
	model: ThemeSemanticModel;
	graph: InspectNazareThemeResult;
	factStore: ThemeFactStore;
	factIndex: ThemeFactIndex;
	diagnostics: ThemeDiagnosticStore;
	analysisFacts: ThemeFact[];
	factChangedPaths: string[];
}): void {
	const declarationIds = new Set(
		input.model.declarations.map((declaration) => declaration.id),
	);
	for (const record of [
		...input.model.references,
		...input.model.sectionInstances,
		...input.model.renderSites,
	]) {
		if (
			record.resolvedDeclarationId &&
			!declarationIds.has(record.resolvedDeclarationId)
		) {
			throw new Error(
				`Staged resolved target ${record.resolvedDeclarationId} is missing for ${record.id}`,
			);
		}
	}
	input.diagnostics.validateOwnership();
	for (const path of input.factChangedPaths) {
		const expected = input.analysisFacts.filter(
			(fact) => themeFactSourcePath(fact) === path,
		);
		if (
			JSON.stringify(input.factStore.getFile(path)) !== JSON.stringify(expected)
		) {
			throw new Error(`Staged fact ownership mismatch for ${path}`);
		}
	}
	const canonicalFactIndex = new ThemeFactIndex(
		input.factStore.all(),
	).snapshot();
	if (
		JSON.stringify(canonicalFactIndex) !==
		JSON.stringify(input.factIndex.snapshot())
	) {
		throw new Error("Staged fact index differs from canonical fact store");
	}
	const canonicalImpact = new ThemeImpactIndex(input.graph).toSummary();
	if (JSON.stringify(canonicalImpact) !== JSON.stringify(input.graph.impact)) {
		throw new Error("Staged impact index differs from canonical graph impact");
	}
}

function shouldRunCanonicalValidation(
	options: InspectNazareThemeOptions,
	revision: number,
): boolean {
	const interval = options.incrementalValidationInterval;
	return interval !== undefined && interval > 0 && revision % interval === 0;
}

function validateCanonicalProgram(
	files: ThemeInputFile[],
	options: InspectNazareThemeOptions,
	model: ThemeSemanticModel,
	graph: InspectNazareThemeResult,
): void {
	const coldOptions = { ...options, cache: undefined, memo: undefined };
	const coldAnalysis = analyzeNazareTheme(files, coldOptions);
	if (JSON.stringify(coldAnalysis.ir) !== JSON.stringify(model)) {
		throw new Error("Incremental semantic model differs from cold rebuild");
	}
	const coldGraph = graphWithIndexedImpact(coldAnalysis.ir).graph;
	if (JSON.stringify(coldGraph) !== JSON.stringify(graph)) {
		throw new Error("Incremental graph differs from cold rebuild");
	}
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
