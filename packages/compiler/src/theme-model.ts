import type { Diagnostic } from "@nazare/core";
import type {
	ThemeCapabilityRecord,
	ThemeDataAccessRecord,
	ThemeDeclaration,
	ThemeFact,
	ThemeFileRecord,
	ThemeReference,
	ThemeRenderArgumentRecord,
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
	const sectionInstances: ThemeSectionInstanceRecord[] = [];
	const settingReads: ThemeSettingReadRecord[] = [];
	const dataAccesses: ThemeDataAccessRecord[] = [];
	const renderArguments: ThemeRenderArgumentRecord[] = [];

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

	const capabilities = capabilityRecords(dataAccesses);

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
		sectionInstances: dedupeById(sectionInstances).sort((a, b) =>
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
		capabilities: dedupeById(capabilities).sort((a, b) =>
			a.id.localeCompare(b.id),
		),
		issues: modelIssues,
	};
}

function capabilityRecords(
	dataAccesses: ThemeDataAccessRecord[],
): ThemeCapabilityRecord[] {
	const byPathCapability = new Map<string, ThemeCapabilityRecord>();
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

export function capabilityId(path: string, capability: string): string {
	return `capability:${path}:${capability}`;
}
