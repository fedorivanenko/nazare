import type { Diagnostic, SourceSpan } from "@nazare/core";
import { collectThemeDataFlowInputs } from "./theme-data-flow-pass.js";
import {
	createThemeDeclarationPass,
	type ThemeDeclarationPassContext,
	type ThemeDeclarationPassRecord,
} from "./theme-declaration-pass.js";
import { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeBlockInstanceRecord,
	ThemeCapabilitySignalRecord,
	ThemeDataAccessRecord,
	ThemeDeclaration,
	ThemeEvidenceRecord,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeFileRecord,
	ThemeLocaleReferenceRecord,
	ThemePageRecord,
	ThemeReference,
	ThemeRenderArgumentRecord,
	ThemeRenderSiteRecord,
	ThemeSchemaRecord,
	ThemeSectionInstanceRecord,
	ThemeSemanticModel,
	ThemeSettingReadRecord,
	ThemeSettingRecord,
	ThemeVariableReadRecord,
} from "./theme-facts.js";
import { inferCapabilities, inferClassifications } from "./theme-inference.js";
import { CONTEXT_INPUT_OBJECTS } from "./theme-input-policy.js";
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
	const capabilitySignals: ThemeCapabilitySignalRecord[] = [];

	for (const fact of facts) {
		if (fact.kind === "detectsCapability") {
			capabilitySignals.push({
				id: capabilitySignalId(fact.path, fact.capability, fact.span),
				path: fact.path,
				capability: fact.capability,
				confidence: fact.confidence,
				span: fact.span,
			});
		}
	}

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
	const expectedInputs = expectedInputRecords(
		declarations,
		dataAccesses,
		variableReads,
		guardedObjects,
		defaultedObjects,
		docParams,
		renderArguments,
	);
	modelIssues.push(
		...docContractIssues(expectedInputs, docParams, defaultedObjects),
	);
	const renderSites = renderSiteRecords(
		renderSiteFacts,
		byKindName,
		renderArguments,
	);
	addInputDiagnostics(
		modelIssues,
		renderSites,
		expectedInputs,
		renderArguments,
		declarations,
	);
	dataAccesses.push(
		...deriveArgumentDataAccesses(
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
	const evidence = evidenceRecords({
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

function evidenceRecords(records: {
	references: ThemeReference[];
	sectionInstances: ThemeSectionInstanceRecord[];
	blockInstances: ThemeBlockInstanceRecord[];
	localeReferences: ThemeLocaleReferenceRecord[];
	schemas: ThemeSchemaRecord[];
	settings: ThemeSettingRecord[];
	settingReads: ThemeSettingReadRecord[];
	dataAccesses: ThemeDataAccessRecord[];
	variableReads: ThemeVariableReadRecord[];
	renderArguments: ThemeRenderArgumentRecord[];
	capabilitySignals: ThemeCapabilitySignalRecord[];
	docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[];
}): ThemeEvidenceRecord[] {
	return [
		...records.docParams.map((param) => ({
			id: docParamEvidenceId(param.path, param.name),
			kind: "docParam" as const,
			file: param.path,
			span: param.span,
			extractor: "theme-source-facts",
		})),
		...records.sectionInstances.map((instance) => ({
			id: instance.id,
			kind: "templateConfig" as const,
			file: instance.templatePath,
			extractor: "theme-json-facts",
		})),
		...records.blockInstances.map((instance) => ({
			id: instance.id,
			kind: "templateConfig" as const,
			file: instance.ownerPath,
			extractor: "theme-json-facts",
		})),
		...records.references.map((reference) => ({
			id: reference.id,
			kind:
				reference.kind === "rendersSnippet"
					? ("renderCall" as const)
					: ("dependency" as const),
			file: reference.fromPath,
			span: reference.span,
			extractor: "theme-liquid-dependencies",
		})),
		...records.localeReferences.map((reference) => ({
			id: reference.id,
			kind: "dependency" as const,
			file: reference.fromPath,
			span: reference.span,
			extractor: "theme-source-facts",
		})),
		...records.schemas.map((schema) => ({
			id: schema.id,
			kind: "schema" as const,
			file: schema.path,
			span: schema.span,
			extractor: "theme-schema",
		})),
		...records.settings.map((setting) => ({
			id: setting.id,
			kind: "schemaSetting" as const,
			file: setting.path,
			span: setting.span,
			extractor: "theme-schema",
		})),
		...records.settingReads.map((read) => ({
			id: read.id,
			kind: "settingRead" as const,
			file: read.fromPath,
			span: read.span,
			extractor: "theme-source-facts",
		})),
		...records.dataAccesses.map((access) => ({
			id: access.id,
			kind: "dataRead" as const,
			file: access.fromPath,
			span: access.span,
			extractor: "theme-source-facts",
		})),
		...records.variableReads.map((read) => ({
			id: read.id,
			kind: "dataRead" as const,
			file: read.fromPath,
			span: read.span,
			extractor: "theme-source-facts",
		})),
		...records.renderArguments.map((argument) => ({
			id: argument.id,
			kind: "renderArgument" as const,
			file: argument.fromPath,
			span: argument.span,
			extractor: "theme-source-facts",
		})),
		...records.capabilitySignals.map((signal) => ({
			id: signal.id,
			kind: "dataRead" as const,
			file: signal.path,
			span: signal.span,
			extractor: "theme-source-facts",
		})),
	];
}

/**
 * What a snippet expects its caller to pass: reads of page-context objects
 * ({% render %} isolates scope, so product/collection/... must be passed)
 * plus free variable reads (bare names that are neither Liquid globals nor
 * assigned in the file). A guarded input is optional. An input used only to
 * forward a render argument remains unknown because forwarding alone does not
 * prove the downstream snippet requires it.
 */
function expectedInputRecords(
	declarations: ThemeDeclaration[],
	dataAccesses: ThemeDataAccessRecord[],
	variableReads: ThemeVariableReadRecord[],
	guardedObjects: Set<string>,
	defaultedObjects: Set<string>,
	docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[],
	renderArguments: ThemeRenderArgumentRecord[],
): ThemeExpectedInputRecord[] {
	const declaredByPathAndName = new Map(
		docParams.map((param) => [`${param.path}:${param.name}`, param]),
	);
	const snippetPathsByName = new Map(
		declarations
			.filter((declaration) => declaration.kind === "snippet")
			.map((declaration) => [declaration.name, declaration.path]),
	);
	const componentPaths = new Set(
		declarations
			.filter(
				(declaration) =>
					declaration.kind === "snippet" || declaration.kind === "component",
			)
			.map((declaration) => declaration.path),
	);
	const byId = new Map<string, ThemeExpectedInputRecord>();
	const directlyReadInputs = new Set(
		variableReads
			.filter((read) => read.usage !== "renderArgument")
			.map((read) => `${read.fromPath}:${read.name}`),
	);
	// A name that callers pass by name is a parameter of the target, whatever it
	// looks like from inside the body. Shopify's ambient objects are the case
	// that matters: a snippet reading `product.title` could be relying on page
	// context, but once a caller writes `product: featured`, the source has said
	// which it is. This is evidence, not preference — the argument is only
	// attributed when the render target resolves statically.
	const callerSuppliedInputs = new Set(
		renderArguments.flatMap((argument) => {
			const target = argument.targetName
				? snippetPathsByName.get(argument.targetName)
				: undefined;
			return target ? [`${target}:${argument.argumentName}`] : [];
		}),
	);
	// Only unconditional reads show the file needs the value on every render.
	const readsDataDirectly = new Set(
		dataAccesses
			.filter((access) => !access.conditional)
			.map((access) => `${access.fromPath}:${access.object}`),
	);
	/**
	 * Whether the file handles the input being absent. Guards and defaults both
	 * count: treating a guard as merely "unknown" instead was measured against
	 * the declared contracts and agreement fell from 68% to 40%, because authors
	 * overwhelmingly guard the inputs they consider optional.
	 */
	const absenceHandled = (key: string): boolean =>
		defaultedObjects.has(key) || guardedObjects.has(key);
	const inferredRequirement = (
		path: string,
		name: string,
		origin: ThemeExpectedInputRecord["origin"],
	): ThemeExpectedInputRecord["requirement"] => {
		const key = `${path}:${name}`;
		if (origin === "ambientShopifyContext") {
			// Without caller evidence an ambient read stays unknown: page context
			// and an omitted argument are indistinguishable from inside the file.
			if (!callerSuppliedInputs.has(key)) return "unknown";
			// A guard around an ambient object may be protecting against absent
			// page context rather than an omitted argument, so caller evidence
			// raises it only as far as "unknown" — never to a claim that the
			// caller may safely omit it. Measured: calling these optional buys
			// one more agreement and costs two more inputs wrongly described as
			// safe to omit, which is the direction that misleads a caller.
			if (absenceHandled(key)) return "unknown";
			return readsDataDirectly.has(key) ? "required" : "unknown";
		}
		if (absenceHandled(key)) return "optional";
		return directlyReadInputs.has(key) ? "required" : "unknown";
	};
	const addInput = (
		path: string,
		name: string,
		propertyPath: string | undefined,
		evidenceId: string,
		origin: ThemeExpectedInputRecord["origin"],
	): void => {
		const id = expectedInputId(path, name);
		const existing = byId.get(id);
		if (existing) {
			existing.propertyPaths = [
				...new Set([
					...existing.propertyPaths,
					...(propertyPath ? [propertyPath] : []),
				]),
			].sort((a, b) => a.localeCompare(b));
			existing.evidenceIds = [
				...new Set([...existing.evidenceIds, evidenceId]),
			];
			// A free-variable read is stronger evidence than ambient context.
			if (origin === "freeVariable" && existing.origin !== "docParam") {
				existing.origin = origin;
				existing.inferredRequirement = inferredRequirement(path, name, origin);
				if (existing.provenance === "inferred") {
					existing.requirement = existing.inferredRequirement;
					existing.required = existing.requirement === "required";
				}
			}
			return;
		}
		byId.set(
			id,
			reconciledInput(path, name, origin, [evidenceId], propertyPath),
		);
	};
	/**
	 * Effective requirement is the author's when they declared one, and the
	 * inferred requirement otherwise. Both are kept: the declaration is the
	 * answer, the inference is what makes disagreement visible.
	 */
	const reconciledInput = (
		path: string,
		name: string,
		origin: ThemeExpectedInputRecord["origin"],
		evidenceIds: string[],
		propertyPath?: string,
	): ThemeExpectedInputRecord => {
		const declared = declaredByPathAndName.get(`${path}:${name}`);
		const inferred = inferredRequirement(path, name, origin);
		const requirement = declared
			? declared.required
				? "required"
				: "optional"
			: inferred;
		return {
			id: expectedInputId(path, name),
			path,
			name,
			required: requirement === "required",
			requirement,
			provenance: declared ? "declared" : "inferred",
			inferredRequirement: inferred,
			origin,
			declaredType: declared?.paramType,
			propertyPaths: propertyPath ? [propertyPath] : [],
			evidenceIds: declared
				? [...evidenceIds, docParamEvidenceId(path, name)]
				: evidenceIds,
		};
	};
	for (const access of dataAccesses) {
		if (!componentPaths.has(access.fromPath)) continue;
		if (!CONTEXT_INPUT_OBJECTS.has(access.object)) continue;
		addInput(
			access.fromPath,
			access.object,
			access.propertyPath,
			access.id,
			"ambientShopifyContext",
		);
	}
	for (const read of variableReads) {
		if (!componentPaths.has(read.fromPath)) continue;
		addInput(
			read.fromPath,
			read.name,
			read.propertyPath,
			read.id,
			"freeVariable",
		);
	}
	// A declared parameter is part of the interface whether or not the body
	// happens to read it, so declarations seed inputs that no read produced.
	for (const param of docParams) {
		if (!componentPaths.has(param.path)) continue;
		const id = expectedInputId(param.path, param.name);
		if (byId.has(id)) continue;
		byId.set(id, reconciledInput(param.path, param.name, "docParam", []));
	}
	return [...byId.values()];
}

/**
 * Where a `{% doc %}` block and the source it documents disagree. A stale
 * declaration outranks correct inference, so these are what keep a contract
 * honest once declarations win.
 *
 * All of these are informational. None of them is a runtime defect: Liquid
 * renders an absent variable as empty rather than raising, so an unguarded
 * read of an optional parameter is how an optional class hook is *supposed*
 * to be written (`class='{{ item_class }}'`). These report a disagreement
 * between two descriptions of one interface, which is worth a human's
 * attention and is not worth a warning.
 *
 * Not reported: a declared-required input that inference calls optional or
 * unknown. Inference is deliberately conservative, so its silence is expected
 * and flagging it would blame the author for the compiler's caution. That
 * disagreement is still recorded on the input for the agreement harness.
 */
function docContractIssues(
	expectedInputs: ThemeExpectedInputRecord[],
	docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[],
	defaultedObjects: Set<string>,
): Diagnostic[] {
	if (docParams.length === 0) return [];
	const issues: Diagnostic[] = [];
	const documentedPaths = new Set(docParams.map((param) => param.path));
	const declaredByPathAndName = new Map(
		docParams.map((param) => [`${param.path}:${param.name}`, param]),
	);
	const defaultedNames = new Set(
		docParams
			.filter((param) => defaultedObjects.has(`${param.path}:${param.name}`))
			.map((param) => `${param.path}:${param.name}`),
	);
	for (const input of expectedInputs) {
		const declared = declaredByPathAndName.get(`${input.path}:${input.name}`);
		if (declared?.required && input.inferredRequirement === "optional") {
			const key = `${input.path}:${input.name}`;
			const how = defaultedNames.has(key)
				? "a fallback value is supplied when it is absent"
				: "every read of it is guarded";
			issues.push({
				severity: "info",
				code: "THEME_DOC_PARAM_FALLBACK",
				message: `@param ${input.name} is declared required, but ${how}; either the contract is stricter than the code or the fallback is unreachable`,
				phase: "resolve",
				span: declared.span,
			});
			continue;
		}
		if (declared && !declared.required) {
			if (input.inferredRequirement === "required") {
				issues.push({
					severity: "info",
					code: "THEME_DOC_PARAM_UNGUARDED",
					message: `@param ${input.name} is declared optional, but no read of it is guarded or defaulted; source evidence alone would call it required`,
					phase: "resolve",
					span: declared.span,
				});
			}
			continue;
		}
		if (!declared && documentedPaths.has(input.path)) {
			issues.push({
				severity: "info",
				code: "THEME_DOC_PARAM_UNDECLARED",
				message: `${input.path} uses ${input.name} as an input but its {% doc %} block does not declare it`,
				phase: "resolve",
				span: fileSpan(input.path),
			});
		}
	}
	return issues;
}

/**
 * One record per render call site — sites are identified by their siteId
 * (path@line:column), so two renders of the same target from one file keep
 * their own argument lists instead of sharing one.
 */
function renderSiteRecords(
	renderSiteFacts: Extract<ThemeFact, { kind: "rendersSnippet" }>[],
	byKindName: Map<string, ThemeDeclaration>,
	renderArguments: ThemeRenderArgumentRecord[],
): ThemeRenderSiteRecord[] {
	const argsBySiteId = new Map<string, ThemeRenderArgumentRecord[]>();
	for (const argument of renderArguments) {
		argsBySiteId.set(argument.siteId, [
			...(argsBySiteId.get(argument.siteId) ?? []),
			argument,
		]);
	}
	return renderSiteFacts.map((fact) => ({
		id: renderSiteId(fact.siteId),
		fromPath: fact.fromPath,
		targetName: fact.targetName,
		invocationKind: fact.invocationKind,
		resolvedDeclarationId: fact.targetName
			? byKindName.get(`snippet:${fact.targetName}`)?.id
			: undefined,
		argumentIds: (argsBySiteId.get(fact.siteId) ?? []).map(
			(argument) => argument.id,
		),
		span: fact.span,
	}));
}

function deriveArgumentDataAccesses(
	renderSites: ThemeRenderSiteRecord[],
	renderArguments: ThemeRenderArgumentRecord[],
	expectedInputs: ThemeExpectedInputRecord[],
	declarations: ThemeDeclaration[],
	variableReads: ThemeVariableReadRecord[],
): ThemeDataAccessRecord[] {
	const declarationById = new Map(
		declarations.map((declaration) => [declaration.id, declaration]),
	);
	const argumentById = new Map(
		renderArguments.map((argument) => [argument.id, argument]),
	);
	const inputsByPathAndName = new Map(
		expectedInputs.map((input) => [`${input.path}:${input.name}`, input]),
	);
	const variableReadById = new Map(
		variableReads.map((read) => [read.id, read]),
	);
	const accesses: ThemeDataAccessRecord[] = [];
	for (const site of renderSites) {
		if (!site.resolvedDeclarationId) continue;
		const targetPath = declarationById.get(site.resolvedDeclarationId)?.path;
		if (!targetPath) continue;
		for (const argumentId of site.argumentIds) {
			const argument = argumentById.get(argumentId);
			if (
				!argument?.sourceObject ||
				argument.sourceObject.endsWith(".settings")
			)
				continue;
			const input = inputsByPathAndName.get(
				`${targetPath}:${argument.argumentName}`,
			);
			if (!input) continue;
			for (const inputPropertyPath of input.propertyPaths) {
				const propertyPath = [argument.sourcePath, inputPropertyPath]
					.filter(Boolean)
					.join(".");
				const expression = propertyPath
					? `${argument.sourceObject}.${propertyPath}`
					: argument.sourceObject;
				const readEvidence = input.evidenceIds
					.map((id) => variableReadById.get(id))
					.find((read) => read?.propertyPath === inputPropertyPath);
				accesses.push({
					id: `data-access-derived:${targetPath}:${argument.id}:${expression}`,
					fromPath: targetPath,
					object: argument.sourceObject,
					propertyPath: propertyPath || undefined,
					expression,
					origin: "renderArgument",
					sourceRenderArgumentId: argument.id,
					inputName: argument.argumentName,
					span: readEvidence?.span,
				});
			}
		}
	}
	return accesses;
}

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

export function expectedInputId(path: string, name: string): string {
	return `expected-input:${path}:${name}`;
}

export function docParamEvidenceId(path: string, name: string): string {
	return `doc-param:${path}:${name}`;
}

/** Anchors a file-level finding that has no single source position. */
function fileSpan(path: string): SourceSpan {
	const position = { line: 1, column: 1 };
	return { file: path, start: position, end: position };
}

export function capabilitySignalId(
	path: string,
	capability: string,
	span?: SourceSpan,
): string {
	return `capability-signal:${path}:${capability}:${occurrenceSuffix(span)}`;
}

function occurrenceSuffix(span: SourceSpan | undefined): string {
	if (!span) return "unlocated";
	return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}
