import type { Diagnostic } from "@nazare/core";
import type {
	ThemeBlockRecord,
	ThemeBlockSettingRecord,
	ThemeCapabilityRecord,
	ThemeCapabilitySignalRecord,
	ThemeClassificationRecord,
	ThemeDataAccessRecord,
	ThemeDeclaration,
	ThemeEvidenceRecord,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeFileRecord,
	ThemeLocaleKeyRecord,
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
} from "./theme-facts.js";

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
	const localeKeys: ThemeLocaleKeyRecord[] = [];
	const localeReferences: ThemeLocaleReferenceRecord[] = [];
	const settingReads: ThemeSettingReadRecord[] = [];
	const dataAccesses: ThemeDataAccessRecord[] = [];
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
			localeKeys.push({
				id: localeKeyId(fact.path, fact.key),
				path: fact.path,
				key: fact.key,
				span: fact.span,
			});
		}
		if (fact.kind === "referencesLocaleKey") {
			localeReferences.push({
				id: localeReferenceId(fact.fromPath, fact.key ?? "dynamic"),
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
				id: settingReadId(fact.fromPath, fact.settingObject, fact.settingId),
				fromPath: fact.fromPath,
				settingObject: fact.settingObject,
				settingId: fact.settingId,
				span: fact.span,
			});
		}
		if (fact.kind === "readsShopifyData") {
			dataAccesses.push({
				id: dataAccessId(fact.fromPath, fact.expression),
				fromPath: fact.fromPath,
				object: fact.object,
				propertyPath: fact.propertyPath,
				expression: fact.expression,
				span: fact.span,
			});
		}
		if (fact.kind === "detectsCapability") {
			capabilitySignals.push({
				id: capabilitySignalId(fact.path, fact.capability),
				path: fact.path,
				capability: fact.capability,
				confidence: fact.confidence,
				span: fact.span,
			});
		}
		if (fact.kind === "passesRenderArgument") {
			renderArguments.push({
				id: renderArgumentId(fact.fromPath, fact.targetName, fact.argumentName),
				fromPath: fact.fromPath,
				targetName: fact.targetName,
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
	const byPath = new Map<string, ThemeDeclaration>();
	for (const declaration of declarations) {
		const key = `${declaration.kind}:${declaration.name}`;
		if (!ambiguousDeclarationKeys.has(key)) byKindName.set(key, declaration);
		byPath.set(declaration.path, declaration);
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
					declaration: byPath.get(fact.targetPath),
				}),
			);
		}
	}

	for (const instance of sectionInstances) {
		if (!instance.sectionType) continue;
		const declaration = byKindName.get(`section:${instance.sectionType}`);
		if (declaration) instance.resolvedDeclarationId = declaration.id;
	}

	const pages = pageRecords(declarations);
	const expectedInputs = expectedInputRecords(declarations, dataAccesses);
	const renderSites = renderSiteRecords(references, renderArguments);
	addInputDiagnostics(
		modelIssues,
		renderSites,
		expectedInputs,
		references,
		renderArguments,
		declarations,
	);
	const capabilities = capabilityRecords(dataAccesses, capabilitySignals);
	const classifications = classificationRecords(capabilities, dataAccesses);
	const evidence = evidenceRecords({
		references,
		schemas,
		settings,
		settingReads,
		dataAccesses,
		renderArguments,
		capabilitySignals,
	});

	const settingByPathAndId = new Map(
		settings.map((setting) => [
			`${setting.path}:${setting.settingId}`,
			setting,
		]),
	);
	for (const read of settingReads) {
		const setting = settingByPathAndId.get(
			`${read.fromPath}:${read.settingId}`,
		);
		if (setting) read.resolvedSettingId = setting.id;
	}

	const localeKeysByKey = new Map<string, ThemeLocaleKeyRecord[]>();
	for (const key of localeKeys) {
		localeKeysByKey.set(key.key, [
			...(localeKeysByKey.get(key.key) ?? []),
			key,
		]);
	}
	for (const reference of localeReferences) {
		if (!reference.static || !reference.key) continue;
		reference.resolvedLocaleKeyIds = (
			localeKeysByKey.get(reference.key) ?? []
		).map((key) => key.id);
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

	return {
		version: 1,
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
		pages: dedupeById(pages).sort((a, b) => a.id.localeCompare(b.id)),
		localeKeys: dedupeById(localeKeys).sort((a, b) => a.id.localeCompare(b.id)),
		localeReferences: dedupeById(localeReferences).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		settingReads: dedupeById(settingReads).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		dataAccesses: dedupeById(dataAccesses).sort((a, b) =>
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
	schemas: ThemeSchemaRecord[];
	settings: ThemeSettingRecord[];
	settingReads: ThemeSettingReadRecord[];
	dataAccesses: ThemeDataAccessRecord[];
	renderArguments: ThemeRenderArgumentRecord[];
	capabilitySignals: ThemeCapabilitySignalRecord[];
}): ThemeEvidenceRecord[] {
	return [
		...records.references.map((reference) => ({
			id: reference.id,
			kind: "dependency" as const,
			file: reference.fromPath,
			span: reference.span,
			extractor: "theme-liquid-dependencies",
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

function expectedInputRecords(
	declarations: ThemeDeclaration[],
	dataAccesses: ThemeDataAccessRecord[],
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
	for (const access of dataAccesses) {
		if (!componentPaths.has(access.fromPath)) continue;
		const id = expectedInputId(access.fromPath, access.object);
		const existing = byId.get(id);
		if (existing) {
			existing.evidenceIds = [...new Set([...existing.evidenceIds, access.id])];
			continue;
		}
		byId.set(id, {
			id,
			path: access.fromPath,
			name: access.object,
			required: true,
			evidenceIds: [access.id],
		});
	}
	return [...byId.values()];
}

function renderSiteRecords(
	references: ThemeReference[],
	renderArguments: ThemeRenderArgumentRecord[],
): ThemeRenderSiteRecord[] {
	const argsBySite = new Map<string, ThemeRenderArgumentRecord[]>();
	for (const argument of renderArguments) {
		const key = `${argument.fromPath}:${argument.targetName}`;
		argsBySite.set(key, [...(argsBySite.get(key) ?? []), argument]);
	}
	return references
		.filter((reference) => reference.kind === "rendersSnippet")
		.map((reference) => ({
			id: renderSiteId(reference.id),
			fromPath: reference.fromPath,
			targetName: reference.targetName,
			resolvedDeclarationId: reference.resolvedDeclarationId,
			argumentIds: (reference.targetName
				? (argsBySite.get(`${reference.fromPath}:${reference.targetName}`) ??
					[])
				: []
			).map((argument) => argument.id),
			span: reference.span,
		}));
}

function addInputDiagnostics(
	issues: Diagnostic[],
	renderSites: ThemeRenderSiteRecord[],
	expectedInputs: ThemeExpectedInputRecord[],
	references: ThemeReference[],
	renderArguments: ThemeRenderArgumentRecord[],
	declarations: ThemeDeclaration[],
): void {
	const expectedByDeclaration = new Map<string, ThemeExpectedInputRecord[]>();
	for (const input of expectedInputs) {
		const key = input.path;
		expectedByDeclaration.set(key, [
			...(expectedByDeclaration.get(key) ?? []),
			input,
		]);
	}
	const referenceById = new Map(
		references.map((reference) => [renderSiteId(reference.id), reference]),
	);
	const argumentById = new Map(
		renderArguments.map((argument) => [argument.id, argument]),
	);
	const declarationById = new Map(
		declarations.map((declaration) => [declaration.id, declaration]),
	);
	const argumentNamesByTarget = new Map<string, Set<string>[]>();
	for (const site of renderSites) {
		const reference = referenceById.get(site.id);
		if (!reference?.resolvedDeclarationId || !reference.targetName) continue;
		const declarationPath = declarationById.get(
			reference.resolvedDeclarationId,
		)?.path;
		if (!declarationPath) continue;
		const expected = expectedByDeclaration.get(declarationPath) ?? [];
		const argumentNames = new Set(
			site.argumentIds
				.map((id) => argumentById.get(id)?.argumentName)
				.filter((name): name is string => typeof name === "string"),
		);
		argumentNamesByTarget.set(reference.targetName, [
			...(argumentNamesByTarget.get(reference.targetName) ?? []),
			argumentNames,
		]);
		for (const input of expected) {
			if (!input.required || argumentNames.has(input.name)) continue;
			issues.push({
				severity: "warning",
				code: "THEME_RENDER_ARGUMENT_MISSING",
				message: `Render of ${reference.targetName} from ${site.fromPath} does not pass inferred required input ${input.name}`,
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

function capabilityRecords(
	dataAccesses: ThemeDataAccessRecord[],
	capabilitySignals: ThemeCapabilitySignalRecord[],
): ThemeCapabilityRecord[] {
	const byPathCapability = new Map<string, ThemeCapabilityRecord>();
	for (const signal of capabilitySignals) {
		byPathCapability.set(signal.id.replace("capability-signal", "capability"), {
			id: capabilityId(signal.path, signal.capability),
			path: signal.path,
			capability: signal.capability,
			confidence: signal.confidence,
			evidenceIds: [signal.id],
		});
	}
	for (const access of dataAccesses) {
		for (const capability of capabilitiesForAccess(access)) {
			const id = capabilityId(access.fromPath, capability.name);
			const existing = byPathCapability.get(id);
			if (existing) {
				existing.evidenceIds = [
					...new Set([...existing.evidenceIds, access.id]),
				];
				existing.confidence = Math.max(
					existing.confidence,
					capability.confidence,
				);
				continue;
			}
			byPathCapability.set(id, {
				id,
				path: access.fromPath,
				capability: capability.name,
				confidence: capability.confidence,
				evidenceIds: [access.id],
			});
		}
	}
	return [...byPathCapability.values()];
}

function classificationRecords(
	capabilities: ThemeCapabilityRecord[],
	dataAccesses: ThemeDataAccessRecord[],
): ThemeClassificationRecord[] {
	const capabilitiesByPath = new Map<string, Set<string>>();
	for (const capability of capabilities) {
		capabilitiesByPath.set(
			capability.path,
			capabilitiesByPath.get(capability.path) ?? new Set(),
		);
		capabilitiesByPath.get(capability.path)?.add(capability.capability);
	}
	const dataByPath = new Map<string, Set<string>>();
	for (const access of dataAccesses) {
		dataByPath.set(
			access.fromPath,
			dataByPath.get(access.fromPath) ?? new Set(),
		);
		dataByPath
			.get(access.fromPath)
			?.add(`${access.object}.${access.propertyPath ?? ""}`);
	}
	const records: ThemeClassificationRecord[] = [];
	for (const [path, caps] of capabilitiesByPath) {
		const data = dataByPath.get(path) ?? new Set();
		const labels: Array<{
			label: string;
			confidence: number;
			uncertainty?: string;
		}> = [];
		if (caps.has("addsToCart") && caps.has("selectsVariants"))
			labels.push({ label: "productForm", confidence: 0.9 });
		if (
			caps.has("displaysProductPrice") &&
			(caps.has("displaysProductMedia") || data.has("product.title"))
		)
			labels.push({
				label: "productCard",
				confidence: 0.75,
				uncertainty: "could be full product section",
			});
		if (caps.has("updatesCart") || caps.has("displaysCartItems"))
			labels.push({
				label: "cartDrawer",
				confidence: 0.65,
				uncertainty: "cart page and drawer share signals",
			});
		if (caps.has("performsPredictiveSearch"))
			labels.push({ label: "searchOverlay", confidence: 0.8 });
		if (caps.has("filtersCollections"))
			labels.push({ label: "collectionGrid", confidence: 0.75 });
		if (caps.has("usesLocalization"))
			labels.push({ label: "localizationSelector", confidence: 0.7 });
		for (const label of labels) {
			const evidenceIds = capabilities
				.filter((capability) => capability.path === path)
				.flatMap((capability) => capability.evidenceIds);
			records.push({
				id: classificationId(path, label.label),
				path,
				label: label.label,
				confidence: label.confidence,
				evidenceIds: [...new Set(evidenceIds)].sort((a, b) =>
					a.localeCompare(b),
				),
				uncertainty: label.uncertainty ? [label.uncertainty] : [],
			});
		}
	}
	return records;
}

function capabilitiesForAccess(
	access: ThemeDataAccessRecord,
): { name: string; confidence: number }[] {
	const path = access.propertyPath ?? "";
	if (access.object === "product" && path === "price") {
		return [{ name: "displaysProductPrice", confidence: 0.95 }];
	}
	if (
		access.object === "product" &&
		/(^|\.)(featured_image|media|images)$/.test(path)
	) {
		return [{ name: "displaysProductMedia", confidence: 0.85 }];
	}
	if (access.object === "cart" && /(^|\.)items/.test(path)) {
		return [{ name: "displaysCartItems", confidence: 0.9 }];
	}
	if (access.object === "cart") {
		return [{ name: "usesCart", confidence: 0.75 }];
	}
	if (access.object === "search") {
		return [{ name: "usesSearch", confidence: 0.75 }];
	}
	if (access.object === "recommendations") {
		return [{ name: "displaysRecommendations", confidence: 0.85 }];
	}
	if (access.object === "localization") {
		return [{ name: "usesLocalization", confidence: 0.85 }];
	}
	return [];
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
		id: `ref:${options.kind}:${options.fromPath}:${options.targetPath ?? options.targetName ?? "dynamic"}`,
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

export function localeKeyId(path: string, key: string): string {
	return `locale-key:${path}:${key}`;
}

export function localeReferenceId(path: string, key: string): string {
	return `locale-reference:${path}:${key}`;
}

export function sectionInstanceId(
	templatePath: string,
	instanceId: string,
): string {
	return `section-instance:${templatePath}:${instanceId}`;
}

export function settingReadId(
	path: string,
	settingObject: string,
	settingId: string,
): string {
	return `setting-read:${path}:${settingObject}:${settingId}`;
}

export function dataObjectId(object: string): string {
	return `shopify-object:${object}`;
}

export function dataPropertyId(object: string, propertyPath: string): string {
	return `shopify-property:${object}.${propertyPath}`;
}

export function dataAccessId(path: string, expression: string): string {
	return `data-access:${path}:${expression}`;
}

export function renderArgumentId(
	path: string,
	targetName: string,
	argumentName: string,
): string {
	return `render-argument:${path}:${targetName}:${argumentName}`;
}

export function renderSiteId(referenceId: string): string {
	return `render-site:${referenceId}`;
}

export function expectedInputId(path: string, name: string): string {
	return `expected-input:${path}:${name}`;
}

export function capabilityId(path: string, capability: string): string {
	return `capability:${path}:${capability}`;
}

export function capabilitySignalId(path: string, capability: string): string {
	return `capability-signal:${path}:${capability}`;
}

export function classificationId(path: string, label: string): string {
	return `classification:${path}:${label}`;
}
