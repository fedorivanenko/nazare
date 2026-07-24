import type { Diagnostic, SourceSpan } from "@nazare/core";
import { collectThemeCapabilitySignals } from "./theme-capability-signal-pass.js";
import {
	collectThemeDataFlowInputs,
	deriveRenderArgumentDataAccesses,
	deriveThemeRenderSites,
} from "./theme-data-flow-pass.js";
import {
	createThemeDeclarationPass,
	type ThemeDeclarationPassContext,
	type ThemeDeclarationPassRecord,
} from "./theme-declaration-pass.js";
import { deriveThemeEvidenceRecords } from "./theme-evidence-pass.js";
import {
	deriveThemeExpectedInputs,
	themeDocContractIssues,
} from "./theme-expected-input-pass.js";
import { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeDeclaration,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeFileRecord,
	ThemePageRecord,
	ThemeReference,
	ThemeRenderArgumentRecord,
	ThemeRenderSiteRecord,
	ThemeSemanticModel,
} from "./theme-facts.js";
import { inferCapabilities, inferClassifications } from "./theme-inference.js";
import { collectThemeInstances } from "./theme-instance-pass.js";
import { collectThemeLocales } from "./theme-locale-pass.js";
import { analyzeMetafields } from "./theme-metafields.js";
import {
	incrementalThemePass,
	type PassChange,
	ThemePassScheduler,
} from "./theme-pass-scheduler.js";
import {
	createThemeReferencePass,
	type ThemeReferencePassContext,
} from "./theme-reference-pass.js";
import { resolveThemeDeclarationsAndReferences } from "./theme-resolution-pass.js";
import { ThemeSchemaIndex } from "./theme-schema-index.js";
import { collectThemeSchemaSettings } from "./theme-schema-setting-pass.js";

function collectScheduledDeclarationAndReferenceRecords(facts: ThemeFact[]): {
	files: Map<string, ThemeFileRecord>;
	declarations: ThemeDeclaration[];
	references: ThemeReference[];
} {
	const factStore = new ThemeFactStore(facts);
	const context: ThemeDeclarationPassContext & ThemeReferencePassContext = {
		facts: factStore,
		resultsBySource: new Map(),
		referencesBySource: new Map(),
		ids: { file: fileId, declaration: declarationId },
		id: referenceId,
	};
	const scheduler = new ThemePassScheduler<typeof context>([
		incrementalThemePass<typeof context, string, ThemeDeclarationPassRecord>(
			createThemeDeclarationPass(),
		),
		incrementalThemePass<typeof context, string, ThemeReference>(
			createThemeReferencePass(),
		),
	]);
	scheduler.execute(
		factStore
			.files()
			.map((path): PassChange => ({ kind: "factsChanged", path })),
		context,
	);
	const files = new Map<string, ThemeFileRecord>();
	const declarations: ThemeDeclaration[] = [];
	for (const path of [...context.resultsBySource.keys()].sort((a, b) =>
		a.localeCompare(b),
	)) {
		const result = context.resultsBySource.get(path);
		if (!result) continue;
		for (const [filePath, file] of result.files) files.set(filePath, file);
		declarations.push(...result.declarations);
	}
	const references = [...context.referencesBySource.keys()]
		.sort((a, b) => a.localeCompare(b))
		.flatMap((path) => context.referencesBySource.get(path) ?? []);
	return { files, declarations, references };
}

export function buildThemeSemanticModel(
	facts: ThemeFact[],
	issues: Diagnostic[],
	options: {
		root?: string;
		metafields?: import("./theme-metafields.js").ThemeMetafieldSnapshot;
	} = {},
): ThemeSemanticModel {
	const {
		files,
		declarations,
		references: collectedReferences,
	} = collectScheduledDeclarationAndReferenceRecords(facts);
	const {
		schemas,
		settings,
		blocks,
		blockSettings,
		settingReads: unresolvedSettingReads,
	} = collectThemeSchemaSettings(facts, {
		schema: schemaId,
		setting: settingId,
		block: blockId,
		blockSetting: blockSettingId,
		settingRead: settingReadId,
	});
	const {
		sectionInstances: unresolvedSectionInstances,
		blockInstances: unresolvedBlockInstances,
	} = collectThemeInstances(facts, {
		section: sectionInstanceId,
		block: blockInstanceId,
	});
	const {
		localeKeys,
		localeTranslations,
		localeReferences: unresolvedLocaleReferences,
	} = collectThemeLocales(facts, {
		key: localeKeyId,
		translation: localeTranslationId,
		reference: localeReferenceId,
	});
	const dataFlowInputs = collectThemeDataFlowInputs(facts, {
		dataAccess: dataAccessId,
		variableRead: variableReadId,
		renderArgument: renderArgumentId,
	});
	const dataAccesses = [...dataFlowInputs.dataAccesses];
	const variableReads = dataFlowInputs.variableReads;
	const guardedObjects = new Set(dataFlowInputs.guardedObjects);
	const defaultedObjects = new Set(dataFlowInputs.defaultedObjects);
	const docParams = dataFlowInputs.docParams;
	const renderSiteFacts = dataFlowInputs.renderSiteFacts;
	const renderArguments = dataFlowInputs.renderArguments;
	const capabilitySignals = collectThemeCapabilitySignals(
		new ThemeFactStore(facts),
	);

	const modelIssues = [...issues];
	const resolution = resolveThemeDeclarationsAndReferences(
		declarations,
		collectedReferences,
	);
	modelIssues.push(...resolution.issues);
	const byKindName = resolution.declarationByKey;
	const references = resolution.references;

	const schemaIndex = new ThemeSchemaIndex({
		declarations,
		blocks,
		settings,
		blockSettings,
		localeKeys,
	});
	const instanceResolution = schemaIndex.resolveInstances(
		unresolvedSectionInstances,
		unresolvedBlockInstances,
	);
	const { sectionInstances, blockInstances } = instanceResolution;
	const settingResolution = schemaIndex.resolveSettingReads(
		unresolvedSettingReads,
	);
	const settingReads = settingResolution.records;
	const localeResolution = schemaIndex.resolveLocaleReferences(
		unresolvedLocaleReferences,
	);
	const localeReferences = localeResolution.records;

	const pages = pageRecords(declarations);
	const expectedInputs = deriveThemeExpectedInputs(
		declarations,
		dataAccesses,
		variableReads,
		guardedObjects,
		defaultedObjects,
		docParams,
		renderArguments,
	);
	modelIssues.push(
		...themeDocContractIssues(expectedInputs, docParams, defaultedObjects),
	);
	const renderSites = deriveThemeRenderSites(
		renderSiteFacts,
		byKindName,
		renderArguments,
		renderSiteId,
	);
	addInputDiagnostics(
		modelIssues,
		renderSites,
		expectedInputs,
		renderArguments,
		declarations,
	);
	dataAccesses.push(
		...deriveRenderArgumentDataAccesses(
			renderSites,
			renderArguments,
			expectedInputs,
			declarations,
			variableReads,
		),
	);
	const metafields = analyzeMetafields(options.metafields, dataAccesses);
	modelIssues.push(...metafields.issues);
	const capabilities = inferCapabilities(dataAccesses, capabilitySignals);
	const classifications = inferClassifications(capabilities, dataAccesses);
	const evidence = deriveThemeEvidenceRecords({
		references,
		sectionInstances,
		blockInstances,
		localeReferences,
		schemas,
		settings,
		settingReads,
		dataAccesses,
		variableReads,
		renderArguments,
		capabilitySignals,
		docParams,
	});

	modelIssues.push(...settingResolution.issues, ...localeResolution.issues);

	const model: ThemeSemanticModel = {
		version: 2,
		root: options.root ?? ".",
		files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
		declarations: dedupeById(declarations).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		references: references.sort((a, b) => a.id.localeCompare(b.id)),
		schemas: dedupeById(schemas).sort((a, b) => a.id.localeCompare(b.id)),
		settings: dedupeById(settings).sort((a, b) => a.id.localeCompare(b.id)),
		blocks: dedupeById(blocks).sort((a, b) => a.id.localeCompare(b.id)),
		blockSettings: dedupeById(blockSettings).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		sectionInstances: dedupeById(sectionInstances).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		blockInstances: dedupeById(blockInstances).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		pages: dedupeById(pages).sort((a, b) => a.id.localeCompare(b.id)),
		localeKeys: dedupeById(localeKeys).sort((a, b) => a.id.localeCompare(b.id)),
		localeTranslations: dedupeById(localeTranslations).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		localeReferences: dedupeById(localeReferences).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		settingReads: dedupeById(settingReads).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		dataAccesses: dedupeById(dataAccesses).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		metafieldDefinitions: metafields.definitions,
		metafieldReads: metafields.reads,
		metafieldSchema: {
			state: options.metafields ? metafields.state : "unknown",
			path: metafields.path,
			pulledAt: metafields.pulledAt ?? null,
		},
		themeCheck: {
			path: ".theme-check.yml",
			ignoredChecks: [],
		},
		variableReads: dedupeById(variableReads).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		renderArguments: dedupeById(renderArguments).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		expectedInputs: dedupeById(expectedInputs).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		renderSites: dedupeById(renderSites).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		capabilitySignals: dedupeById(capabilitySignals).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		capabilities: dedupeById(capabilities).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		classifications: dedupeById(classifications).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		evidence: dedupeById(evidence).sort((a, b) => a.id.localeCompare(b.id)),
		issues: modelIssues,
	};
	assertThemeSemanticModel(model);
	return model;
}

function assertThemeSemanticModel(model: ThemeSemanticModel): void {
	const declarationIds = new Set(model.declarations.map((item) => item.id));
	const settingIds = new Set([
		...model.settings.map((item) => item.id),
		...model.blockSettings.map((item) => item.id),
	]);
	const localeKeyIds = new Set(model.localeKeys.map((item) => item.id));
	const renderArgumentIds = new Set(
		model.renderArguments.map((item) => item.id),
	);

	for (const reference of model.references) {
		if (
			reference.resolvedDeclarationId &&
			!declarationIds.has(reference.resolvedDeclarationId)
		) {
			throw new Error(
				`Theme reference ${reference.id} resolves to missing declaration ${reference.resolvedDeclarationId}`,
			);
		}
	}
	for (const instance of model.sectionInstances) {
		if (
			instance.resolvedDeclarationId &&
			!declarationIds.has(instance.resolvedDeclarationId)
		) {
			throw new Error(
				`Theme section instance ${instance.id} resolves to missing declaration ${instance.resolvedDeclarationId}`,
			);
		}
	}
	const blockIds = new Set([
		...model.blocks.map((block) => block.id),
		...model.declarations
			.filter((declaration) => declaration.kind === "themeBlock")
			.map((declaration) => declaration.id),
	]);
	for (const instance of model.blockInstances) {
		if (instance.resolvedBlockId && !blockIds.has(instance.resolvedBlockId)) {
			throw new Error(
				`Theme block instance ${instance.id} resolves to missing block ${instance.resolvedBlockId}`,
			);
		}
	}
	for (const read of model.settingReads) {
		if (read.resolvedSettingId && (read.candidateSettingIds?.length ?? 0) > 0) {
			throw new Error(
				`Theme setting read ${read.id} has both resolved and candidate settings`,
			);
		}
		if (read.candidateSettingIds) {
			assertUniqueSorted(
				read.candidateSettingIds,
				`Theme setting read ${read.id} candidate settings`,
			);
		}
		if (read.resolvedSettingId && !settingIds.has(read.resolvedSettingId)) {
			throw new Error(
				`Theme setting read ${read.id} resolves to missing setting ${read.resolvedSettingId}`,
			);
		}
		for (const candidateId of read.candidateSettingIds ?? []) {
			if (!settingIds.has(candidateId)) {
				throw new Error(
					`Theme setting read ${read.id} has missing candidate ${candidateId}`,
				);
			}
		}
	}
	for (const translation of model.localeTranslations) {
		if (!localeKeyIds.has(translation.localeKeyId)) {
			throw new Error(
				`Theme locale translation ${translation.id} resolves to missing locale key ${translation.localeKeyId}`,
			);
		}
	}
	for (const reference of model.localeReferences) {
		for (const localeKeyId of reference.resolvedLocaleKeyIds) {
			if (!localeKeyIds.has(localeKeyId)) {
				throw new Error(
					`Theme locale reference ${reference.id} resolves to missing locale key ${localeKeyId}`,
				);
			}
		}
	}
	for (const site of model.renderSites) {
		assertUnique(site.argumentIds, `Theme render site ${site.id} arguments`);
		for (const argumentId of site.argumentIds) {
			if (!renderArgumentIds.has(argumentId)) {
				throw new Error(
					`Theme render site ${site.id} points to missing argument ${argumentId}`,
				);
			}
		}
	}
	const evidenceIds = new Set(model.evidence.map((item) => item.id));
	for (const record of [
		...model.expectedInputs,
		...model.capabilities,
		...model.classifications,
	]) {
		if (record.evidenceIds.length === 0) {
			throw new Error(`Theme semantic record ${record.id} has no evidence`);
		}
		assertUnique(
			record.evidenceIds,
			`Theme semantic record ${record.id} evidence`,
		);
		for (const evidenceId of record.evidenceIds) {
			if (!evidenceIds.has(evidenceId)) {
				throw new Error(
					`Theme semantic record ${record.id} points to missing evidence ${evidenceId}`,
				);
			}
		}
	}
}

function assertUnique(values: string[], label: string): void {
	if (values.length !== new Set(values).size) {
		throw new Error(`${label} must be unique`);
	}
}

function assertUniqueSorted(values: string[], label: string): void {
	assertUnique(values, label);
	const sorted = [...values].sort((a, b) => a.localeCompare(b));
	if (values.some((value, index) => value !== sorted[index])) {
		throw new Error(`${label} must be sorted`);
	}
}

function pageRecords(declarations: ThemeDeclaration[]): ThemePageRecord[] {
	return declarations
		.filter((declaration) => declaration.kind === "template")
		.map((declaration) => ({
			id: pageId(declaration.path),
			path: declaration.path,
			name: declaration.name,
			pageType: pageTypeFromTemplateName(declaration.name),
			templateDeclarationId: declaration.id,
		}));
}

function pageTypeFromTemplateName(name: string): string {
	const [pageType] = name.split(".");
	return pageType || "unknown";
}

/**
 * What a snippet expects its caller to pass: reads of page-context objects
 * ({% render %} isolates scope, so product/collection/... must be passed)
 * plus free variable reads (bare names that are neither Liquid globals nor
 * assigned in the file). A guarded input is optional. An input used only to
 * forward a render argument remains unknown because forwarding alone does not
 * prove the downstream snippet requires it.
 */
function addInputDiagnostics(
	issues: Diagnostic[],
	renderSites: ThemeRenderSiteRecord[],
	expectedInputs: ThemeExpectedInputRecord[],
	renderArguments: ThemeRenderArgumentRecord[],
	declarations: ThemeDeclaration[],
): void {
	const expectedByDeclaration = new Map<string, ThemeExpectedInputRecord[]>();
	for (const input of expectedInputs) {
		expectedByDeclaration.set(input.path, [
			...(expectedByDeclaration.get(input.path) ?? []),
			input,
		]);
	}
	const argumentById = new Map(
		renderArguments.map((argument) => [argument.id, argument]),
	);
	const declarationById = new Map(
		declarations.map((declaration) => [declaration.id, declaration]),
	);
	const argumentNamesByTarget = new Map<string, Set<string>[]>();
	const renderCountByDeclaration = new Map<string, number>();
	const argumentCountByDeclaration = new Map<string, Map<string, number>>();
	for (const site of renderSites) {
		if (site.invocationKind !== "render" || !site.resolvedDeclarationId)
			continue;
		renderCountByDeclaration.set(
			site.resolvedDeclarationId,
			(renderCountByDeclaration.get(site.resolvedDeclarationId) ?? 0) + 1,
		);
		const counts =
			argumentCountByDeclaration.get(site.resolvedDeclarationId) ??
			new Map<string, number>();
		for (const argumentId of site.argumentIds) {
			const name = argumentById.get(argumentId)?.argumentName;
			if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		argumentCountByDeclaration.set(site.resolvedDeclarationId, counts);
	}
	for (const site of renderSites) {
		if (
			site.invocationKind !== "render" ||
			!site.resolvedDeclarationId ||
			!site.targetName
		)
			continue;
		const declarationPath = declarationById.get(
			site.resolvedDeclarationId,
		)?.path;
		if (!declarationPath) continue;
		const expected = expectedByDeclaration.get(declarationPath) ?? [];
		const argumentNames = new Set(
			site.argumentIds
				.map((id) => argumentById.get(id)?.argumentName)
				.filter((name): name is string => typeof name === "string"),
		);
		argumentNamesByTarget.set(site.targetName, [
			...(argumentNamesByTarget.get(site.targetName) ?? []),
			argumentNames,
		]);
		const expectedNames = new Set(expected.map((input) => input.name));
		for (const input of expected) {
			const renderCount =
				renderCountByDeclaration.get(site.resolvedDeclarationId) ?? 0;
			const argumentCount =
				argumentCountByDeclaration
					.get(site.resolvedDeclarationId)
					?.get(input.name) ?? 0;
			if (
				!input.required ||
				argumentNames.has(input.name) ||
				argumentCount <= renderCount - argumentCount
			)
				continue;
			issues.push({
				severity: "warning",
				code: "THEME_RENDER_ARGUMENT_MISSING",
				message: `Render of ${site.targetName} from ${site.fromPath} omits inferred input ${input.name}, which most calls pass`,
				phase: "resolve",
				span: site.span,
			});
		}
		for (const argumentName of argumentNames) {
			if (expectedNames.has(argumentName)) continue;
			issues.push({
				severity: "warning",
				code: "THEME_RENDER_ARGUMENT_UNKNOWN",
				message: `Render of ${site.targetName} from ${site.fromPath} passes argument ${argumentName}, but the target does not read it as an inferred input`,
				phase: "resolve",
				span: site.span,
			});
		}
	}
	for (const [targetName, sets] of argumentNamesByTarget) {
		const signatures = new Set(
			sets.map((set) => [...set].sort((a, b) => a.localeCompare(b)).join(",")),
		);
		if (signatures.size <= 1) continue;
		issues.push({
			severity: "warning",
			code: "THEME_RENDER_ARGUMENT_INCONSISTENT",
			message: `Render calls for ${targetName} use inconsistent argument sets: ${[...signatures].join(" | ")}`,
			phase: "resolve",
		});
	}
}

export function referenceId(reference: Omit<ThemeReference, "id">): string {
	return `ref:${reference.kind}:${reference.fromPath}:${reference.targetPath ?? reference.targetName ?? "dynamic"}:${occurrenceSuffix(reference.span)}`;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
	const seen = new Map<string, T>();
	for (const item of items) seen.set(item.id, item);
	return [...seen.values()];
}

// Single owner of every theme-graph ID format (the artifact-layer namespace
// lives in ids.ts). IDs are opaque: construct them here, never parse data
// back out of one.
export function fileId(path: string): string {
	return `file:${path}`;
}

export function declarationId(
	kind: string,
	path: string,
	name: string,
): string {
	return `${kind}:${path}:${name}`;
}

export function schemaId(path: string, schemaPath: string): string {
	return `schema:${path}:${schemaPath}`;
}

export function settingId(
	path: string,
	schemaPath: string,
	id: string,
): string {
	return `setting:${path}:${schemaPath}:${id}`;
}

export function blockId(path: string, blockType: string): string {
	return `block:${path}:${blockType}`;
}

export function blockSettingId(
	path: string,
	blockType: string,
	settingId: string,
): string {
	return `block-setting:${path}:${blockType}:${settingId}`;
}

export function pageId(path: string): string {
	return `page:${path}`;
}

export function localeKeyId(key: string): string {
	return `locale-key:${key}`;
}

export function localeTranslationId(path: string, key: string): string {
	return `locale-translation:${path}:${key}`;
}

export function localeReferenceId(
	path: string,
	key: string,
	span?: SourceSpan,
): string {
	return `locale-reference:${path}:${key}:${occurrenceSuffix(span)}`;
}

export function sectionInstanceId(
	templatePath: string,
	instanceId: string,
): string {
	return `section-instance:${templatePath}:${instanceId}`;
}

export function blockInstanceId(
	ownerPath: string,
	sectionInstanceId: string,
	instanceId: string,
): string {
	return `block-instance:${ownerPath}:${sectionInstanceId}:${instanceId}`;
}

export function settingReadId(
	path: string,
	settingObject: string,
	settingId: string,
	span?: SourceSpan,
): string {
	return `setting-read:${path}:${settingObject}:${settingId}:${occurrenceSuffix(span)}`;
}

export function dataObjectId(object: string): string {
	return `shopify-object:${object}`;
}

export function dataPropertyId(object: string, propertyPath: string): string {
	return `shopify-property:${object}.${propertyPath}`;
}

export function dataAccessId(
	path: string,
	expression: string,
	span?: SourceSpan,
): string {
	return `data-access:${path}:${expression}:${occurrenceSuffix(span)}`;
}

export function renderArgumentId(siteId: string, argumentName: string): string {
	return `render-argument:${siteId}:${argumentName}`;
}

export function renderSiteId(siteId: string): string {
	return `render-site:${siteId}`;
}

export function variableReadId(
	path: string,
	name: string,
	span?: SourceSpan,
): string {
	return `variable-read:${path}:${name}:${occurrenceSuffix(span)}`;
}

function occurrenceSuffix(span: SourceSpan | undefined): string {
	if (!span) return "unlocated";
	return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}
