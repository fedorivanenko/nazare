import type { Diagnostic, SourceSpan } from "@nazare/core";
import type {
	ThemeBlockInstanceRecord,
	ThemeBlockRecord,
	ThemeBlockSettingRecord,
	ThemeCapabilitySignalRecord,
	ThemeDataAccessRecord,
	ThemeDeclaration,
	ThemeEvidenceRecord,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeFileRecord,
	ThemeLocaleKeyRecord,
	ThemeLocaleReferenceRecord,
	ThemeLocaleTranslationRecord,
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

export function buildThemeSemanticModel(
	facts: ThemeFact[],
	issues: Diagnostic[],
	options: { root?: string } = {},
): ThemeSemanticModel {
	const files = new Map<string, ThemeFileRecord>();
	const declarations: ThemeDeclaration[] = [];
	const schemas: ThemeSchemaRecord[] = [];
	const settings: ThemeSettingRecord[] = [];
	const blocks: ThemeBlockRecord[] = [];
	const blockSettings: ThemeBlockSettingRecord[] = [];
	const sectionInstances: ThemeSectionInstanceRecord[] = [];
	const blockInstances: ThemeBlockInstanceRecord[] = [];
	const localeKeys: ThemeLocaleKeyRecord[] = [];
	const localeTranslations: ThemeLocaleTranslationRecord[] = [];
	const localeReferences: ThemeLocaleReferenceRecord[] = [];
	const settingReads: ThemeSettingReadRecord[] = [];
	const dataAccesses: ThemeDataAccessRecord[] = [];
	const variableReads: ThemeVariableReadRecord[] = [];
	const guardedObjects = new Set<string>();
	const renderSiteFacts: Extract<ThemeFact, { kind: "rendersSnippet" }>[] = [];
	const renderArguments: ThemeRenderArgumentRecord[] = [];
	const capabilitySignals: ThemeCapabilitySignalRecord[] = [];

	for (const fact of facts) {
		if (fact.kind === "file") {
			files.set(fact.path, {
				id: fileId(fact.path),
				path: fact.path,
				fileKind: fact.fileKind,
			});
		}
		if (fact.kind === "declaresSection") {
			declarations.push(declaration("section", fact.path, fact.name));
		}
		if (fact.kind === "declaresSnippet") {
			declarations.push(declaration("snippet", fact.path, fact.name));
		}
		if (fact.kind === "declaresTemplate") {
			declarations.push(declaration("template", fact.path, fact.name));
		}
		if (fact.kind === "declaresLayout") {
			declarations.push(declaration("layout", fact.path, fact.name));
		}
		if (fact.kind === "declaresLocale") {
			declarations.push(declaration("locale", fact.path, fact.name));
		}
		if (fact.kind === "declaresAsset") {
			declarations.push(declaration("asset", fact.path, fact.name));
		}
		if (fact.kind === "declaresSectionGroup") {
			declarations.push(declaration("sectionGroup", fact.path, fact.name));
		}
		if (fact.kind === "declaresThemeBlock") {
			declarations.push(declaration("themeBlock", fact.path, fact.name));
		}
		if (fact.kind === "declaresComponent") {
			declarations.push({
				...declaration("component", fact.path, fact.name),
				componentKind: fact.componentKind,
			});
		}
		if (fact.kind === "sectionInstance") {
			sectionInstances.push({
				id: sectionInstanceId(fact.templatePath, fact.instanceId),
				templatePath: fact.templatePath,
				instanceId: fact.instanceId,
				sectionType: fact.sectionType,
				static: fact.static,
			});
		}
		if (fact.kind === "blockInstance") {
			blockInstances.push({
				id: blockInstanceId(
					fact.ownerPath,
					fact.sectionInstanceId,
					fact.instanceId,
				),
				ownerPath: fact.ownerPath,
				sectionInstanceId: fact.sectionInstanceId,
				instanceId: fact.instanceId,
				blockType: fact.blockType,
				parentInstanceId: fact.parentInstanceId,
				static: fact.static,
			});
		}
		if (fact.kind === "definesSchema") {
			schemas.push({
				id: schemaId(fact.path, fact.schemaPath),
				path: fact.path,
				schemaPath: fact.schemaPath,
				span: fact.span,
			});
		}
		if (fact.kind === "definesSetting") {
			settings.push({
				id: settingId(fact.path, fact.schemaPath, fact.settingId),
				path: fact.path,
				schemaPath: fact.schemaPath,
				settingId: fact.settingId,
				settingType: fact.settingType,
				span: fact.span,
			});
		}
		if (fact.kind === "definesLocaleKey") {
			const keyId = localeKeyId(fact.key);
			localeKeys.push({ id: keyId, key: fact.key });
			localeTranslations.push({
				id: localeTranslationId(fact.path, fact.key),
				path: fact.path,
				key: fact.key,
				localeKeyId: keyId,
				span: fact.span,
			});
		}
		if (fact.kind === "referencesLocaleKey") {
			localeReferences.push({
				id: localeReferenceId(fact.fromPath, fact.key ?? "dynamic", fact.span),
				fromPath: fact.fromPath,
				key: fact.key,
				resolvedLocaleKeyIds: [],
				static: fact.static,
				span: fact.span,
			});
		}
		if (fact.kind === "declaresBlock") {
			blocks.push({
				id: blockId(fact.path, fact.blockType),
				path: fact.path,
				blockType: fact.blockType,
				name: fact.name,
				span: fact.span,
			});
		}
		if (fact.kind === "definesBlockSetting") {
			blockSettings.push({
				id: blockSettingId(fact.path, fact.blockType, fact.settingId),
				path: fact.path,
				blockType: fact.blockType,
				settingId: fact.settingId,
				settingType: fact.settingType,
				span: fact.span,
			});
		}
		if (fact.kind === "readsSetting") {
			settingReads.push({
				id: settingReadId(
					fact.fromPath,
					fact.settingObject,
					fact.settingId,
					fact.span,
				),
				fromPath: fact.fromPath,
				settingObject: fact.settingObject,
				settingId: fact.settingId,
				span: fact.span,
			});
		}
		if (fact.kind === "rendersSnippet") {
			renderSiteFacts.push(fact);
		}
		if (fact.kind === "readsFreeVariable") {
			variableReads.push({
				id: variableReadId(fact.fromPath, fact.name, fact.span),
				fromPath: fact.fromPath,
				name: fact.name,
				propertyPath: fact.propertyPath,
				expression: fact.expression,
				span: fact.span,
			});
		}
		if (fact.kind === "guardsObject") {
			guardedObjects.add(`${fact.fromPath}:${fact.name}`);
		}
		if (fact.kind === "readsShopifyData") {
			dataAccesses.push({
				id: dataAccessId(fact.fromPath, fact.expression, fact.span),
				fromPath: fact.fromPath,
				object: fact.object,
				propertyPath: fact.propertyPath,
				expression: fact.expression,
				span: fact.span,
			});
		}
		if (fact.kind === "detectsCapability") {
			capabilitySignals.push({
				id: capabilitySignalId(fact.path, fact.capability, fact.span),
				path: fact.path,
				capability: fact.capability,
				confidence: fact.confidence,
				span: fact.span,
			});
		}
		if (fact.kind === "passesRenderArgument") {
			renderArguments.push({
				id: renderArgumentId(fact.siteId, fact.argumentName),
				fromPath: fact.fromPath,
				targetName: fact.targetName,
				siteId: fact.siteId,
				argumentName: fact.argumentName,
				valueExpression: fact.valueExpression,
				sourceObject: fact.sourceObject,
				sourcePath: fact.sourcePath,
				span: fact.span,
			});
		}
	}

	const modelIssues = [...issues];
	const declarationCollisions = new Map<string, ThemeDeclaration[]>();
	for (const declaration of declarations) {
		const key = `${declaration.kind}:${declaration.name}`;
		declarationCollisions.set(key, [
			...(declarationCollisions.get(key) ?? []),
			declaration,
		]);
	}
	for (const [key, colliding] of declarationCollisions) {
		const paths = [
			...new Set(colliding.map((declaration) => declaration.path)),
		];
		if (paths.length <= 1) continue;
		modelIssues.push({
			severity: "warning",
			code: "THEME_DUPLICATE_DECLARATION",
			message: `Duplicate theme declaration ${key} in ${paths.join(", ")}`,
			phase: "resolve",
		});
	}

	const ambiguousDeclarationKeys = new Set(
		[...declarationCollisions.entries()]
			.filter(([, colliding]) => {
				const paths = new Set(colliding.map((declaration) => declaration.path));
				return paths.size > 1;
			})
			.map(([key]) => key),
	);
	const byKindName = new Map<string, ThemeDeclaration>();
	const componentByPath = new Map<string, ThemeDeclaration>();
	for (const declaration of declarations) {
		const key = `${declaration.kind}:${declaration.name}`;
		if (!ambiguousDeclarationKeys.has(key)) byKindName.set(key, declaration);
		if (declaration.kind === "component") {
			componentByPath.set(declaration.path, declaration);
		}
		if (declaration.kind === "asset")
			byKindName.set(`asset:${declaration.path}`, declaration);
	}

	const references: ThemeReference[] = [];
	for (const fact of facts) {
		if (fact.kind === "rendersSnippet") {
			references.push(
				reference({
					kind: "rendersSnippet",
					fromPath: fact.fromPath,
					targetKind: "snippet",
					targetName: fact.targetName,
					static: fact.static,
					span: fact.span,
					declaration: fact.targetName
						? byKindName.get(`snippet:${fact.targetName}`)
						: undefined,
				}),
			);
		}
		if (fact.kind === "containsSection") {
			references.push(
				reference({
					kind: "containsSection",
					fromPath: fact.fromPath,
					targetKind: "section",
					targetName: fact.targetName,
					static: fact.static,
					span: fact.span,
					declaration: fact.targetName
						? byKindName.get(`section:${fact.targetName}`)
						: undefined,
				}),
			);
		}
		if (fact.kind === "containsSectionGroup") {
			references.push(
				reference({
					kind: "containsSectionGroup",
					fromPath: fact.fromPath,
					targetKind: "sectionGroup",
					targetName: fact.targetName,
					static: fact.static,
					span: fact.span,
					declaration: fact.targetName
						? byKindName.get(`sectionGroup:${fact.targetName}`)
						: undefined,
				}),
			);
		}
		if (fact.kind === "usesLayout") {
			references.push(
				reference({
					kind: "usesLayout",
					fromPath: fact.fromPath,
					targetKind: "layout",
					targetName: fact.targetName,
					static: fact.static,
					span: fact.span,
					declaration: fact.targetName
						? byKindName.get(`layout:${fact.targetName}`)
						: undefined,
				}),
			);
		}
		if (fact.kind === "referencesAsset") {
			const declaration = fact.targetName
				? (byKindName.get(`asset:${fact.targetName}`) ??
					byKindName.get(`asset:assets/${fact.targetName}`))
				: undefined;
			references.push(
				reference({
					kind: "referencesAsset",
					fromPath: fact.fromPath,
					targetKind: "asset",
					targetName: fact.targetName,
					static: fact.static,
					span: fact.span,
					declaration,
				}),
			);
		}
		if (fact.kind === "importsComponent") {
			references.push(
				reference({
					kind: "importsComponent",
					fromPath: fact.fromPath,
					targetKind: "component",
					targetName: fact.localName,
					targetPath: fact.targetPath,
					static: true,
					span: fact.span,
					declaration: componentByPath.get(fact.targetPath),
				}),
			);
		}
	}

	for (const instance of sectionInstances) {
		if (!instance.sectionType) continue;
		const declaration = byKindName.get(`section:${instance.sectionType}`);
		if (declaration) instance.resolvedDeclarationId = declaration.id;
	}
	const sectionInstanceByOwnerAndId = new Map(
		sectionInstances.map((instance) => [
			`${instance.templatePath}:${instance.instanceId}`,
			instance,
		]),
	);
	for (const instance of blockInstances) {
		if (!instance.blockType) continue;
		const themeBlock = byKindName.get(`themeBlock:${instance.blockType}`);
		if (themeBlock) {
			instance.resolvedBlockId = themeBlock.id;
			continue;
		}
		const sectionInstance = sectionInstanceByOwnerAndId.get(
			`${instance.ownerPath}:${instance.sectionInstanceId}`,
		);
		const sectionPath = sectionInstance?.resolvedDeclarationId
			? declarations.find(
					(declaration) =>
						declaration.id === sectionInstance.resolvedDeclarationId,
				)?.path
			: undefined;
		if (!sectionPath) continue;
		const schemaBlock = blocks.find(
			(block) =>
				block.path === sectionPath && block.blockType === instance.blockType,
		);
		if (schemaBlock) instance.resolvedBlockId = schemaBlock.id;
	}

	const pages = pageRecords(declarations);
	const expectedInputs = expectedInputRecords(
		declarations,
		dataAccesses,
		variableReads,
		guardedObjects,
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
	});

	const settingByPathAndId = new Map(
		settings.map((setting) => [
			`${setting.path}:${setting.settingId}`,
			setting,
		]),
	);
	const globalSettingById = new Map(
		settings
			.filter((setting) => setting.path === "config/settings_schema.json")
			.map((setting) => [setting.settingId, setting]),
	);
	const blockSettingsByPathAndId = new Map<string, ThemeBlockSettingRecord[]>();
	for (const setting of blockSettings) {
		const key = `${setting.path}:${setting.settingId}`;
		blockSettingsByPathAndId.set(key, [
			...(blockSettingsByPathAndId.get(key) ?? []),
			setting,
		]);
	}
	for (const read of settingReads) {
		if (read.settingObject === "settings") {
			read.resolvedSettingId = globalSettingById.get(read.settingId)?.id;
			continue;
		}
		if (read.settingObject === "section") {
			read.resolvedSettingId = settingByPathAndId.get(
				`${read.fromPath}:${read.settingId}`,
			)?.id;
			continue;
		}
		const candidates =
			blockSettingsByPathAndId.get(`${read.fromPath}:${read.settingId}`) ?? [];
		if (candidates.length === 1) {
			read.resolvedSettingId = candidates[0]?.id;
			continue;
		}
		if (candidates.length > 1) {
			read.candidateSettingIds = candidates
				.map((candidate) => candidate.id)
				.sort((a, b) => a.localeCompare(b));
			modelIssues.push({
				severity: "warning",
				code: "THEME_AMBIGUOUS_SETTING_READ",
				message: `Block setting read ${read.settingId} from ${read.fromPath} matches multiple block types`,
				phase: "resolve",
				span: read.span,
			});
		}
	}
	for (const read of settingReads) {
		if (read.resolvedSettingId || (read.candidateSettingIds?.length ?? 0) > 0) {
			continue;
		}
		modelIssues.push({
			severity: "warning",
			code: "THEME_UNRESOLVED_SETTING_READ",
			message: `Unresolved ${read.settingObject} setting ${read.settingId} from ${read.fromPath}`,
			phase: "resolve",
			span: read.span,
		});
	}

	const localeKeyByKey = new Map(
		localeKeys.map((localeKey) => [localeKey.key, localeKey]),
	);
	for (const reference of localeReferences) {
		if (!reference.static || !reference.key) continue;
		const resolved = localeKeyByKey.get(reference.key);
		reference.resolvedLocaleKeyIds = resolved ? [resolved.id] : [];
		if (reference.resolvedLocaleKeyIds.length === 0) {
			modelIssues.push({
				severity: "warning",
				code: "THEME_UNRESOLVED_LOCALE_KEY",
				message: `Unresolved locale key ${reference.key} from ${reference.fromPath}`,
				phase: "resolve",
				span: reference.span,
			});
		}
	}

	for (const ref of references) {
		if (!ref.static || ref.resolvedDeclarationId) continue;
		const targetKey = ref.targetName
			? `${ref.targetKind}:${ref.targetName}`
			: undefined;
		if (targetKey && ambiguousDeclarationKeys.has(targetKey)) {
			modelIssues.push({
				severity: "warning",
				code: "THEME_AMBIGUOUS_REFERENCE",
				message: `Ambiguous ${ref.targetKind} reference ${ref.targetName} from ${ref.fromPath}`,
				phase: "resolve",
				span: ref.span,
			});
			continue;
		}
		modelIssues.push({
			severity: "warning",
			code: "THEME_UNRESOLVED_REFERENCE",
			message: `Unresolved ${ref.targetKind} reference${ref.targetName ? ` ${ref.targetName}` : ""} from ${ref.fromPath}`,
			phase: "resolve",
			span: ref.span,
		});
	}

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
}): ThemeEvidenceRecord[] {
	return [
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
 * assigned in the file). An input is required unless the file guards the
 * name in a condition — a guarded read tolerates absence.
 */
function expectedInputRecords(
	declarations: ThemeDeclaration[],
	dataAccesses: ThemeDataAccessRecord[],
	variableReads: ThemeVariableReadRecord[],
	guardedObjects: Set<string>,
): ThemeExpectedInputRecord[] {
	const componentPaths = new Set(
		declarations
			.filter(
				(declaration) =>
					declaration.kind === "snippet" || declaration.kind === "component",
			)
			.map((declaration) => declaration.path),
	);
	const byId = new Map<string, ThemeExpectedInputRecord>();
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
			if (origin === "freeVariable") {
				existing.origin = origin;
				existing.requirement = guardedObjects.has(`${path}:${name}`)
					? "optional"
					: "required";
				existing.required = existing.requirement === "required";
			}
			return;
		}
		const requirement =
			origin === "ambientShopifyContext"
				? "unknown"
				: guardedObjects.has(`${path}:${name}`)
					? "optional"
					: "required";
		byId.set(id, {
			id,
			path,
			name,
			required: requirement === "required",
			requirement,
			origin,
			propertyPaths: propertyPath ? [propertyPath] : [],
			evidenceIds: [evidenceId],
		});
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
	return [...byId.values()];
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
			if (!input.required || argumentNames.has(input.name)) continue;
			issues.push({
				severity: "warning",
				code: "THEME_RENDER_ARGUMENT_MISSING",
				message: `Render of ${site.targetName} from ${site.fromPath} does not pass inferred required input ${input.name}`,
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

function declaration(
	kind: ThemeDeclaration["kind"],
	path: string,
	name: string,
): ThemeDeclaration {
	return { id: declarationId(kind, path, name), kind, path, name };
}

function reference(options: {
	kind: ThemeReference["kind"];
	fromPath: string;
	targetKind: ThemeReference["targetKind"];
	targetName?: string;
	targetPath?: string;
	static: boolean;
	span?: ThemeReference["span"];
	declaration?: ThemeDeclaration;
}): ThemeReference {
	return {
		id: `ref:${options.kind}:${options.fromPath}:${options.targetPath ?? options.targetName ?? "dynamic"}:${occurrenceSuffix(options.span)}`,
		kind: options.kind,
		fromPath: options.fromPath,
		targetKind: options.targetKind,
		targetName: options.targetName,
		targetPath: options.targetPath,
		resolvedDeclarationId: options.declaration?.id,
		static: options.static,
		span: options.span,
	};
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
