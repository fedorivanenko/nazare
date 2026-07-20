import type { Diagnostic } from "@nazare/core";
import type {
	ThemeDeclaration,
	ThemeFact,
	ThemeFileRecord,
	ThemeReference,
	ThemeSchemaRecord,
	ThemeSemanticModel,
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
		if (fact.kind === "declaresAsset") {
			declarations.push(declaration("asset", fact.path, fact.name));
		}
		if (fact.kind === "declaresComponent") {
			declarations.push({
				...declaration("component", fact.path, fact.name),
				componentKind: fact.componentKind,
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

	for (const ref of references) {
		if (ref.static && !ref.resolvedDeclarationId) {
			modelIssues.push({
				severity: "warning",
				code: "THEME_UNRESOLVED_REFERENCE",
				message: `Unresolved ${ref.targetKind} reference${ref.targetName ? ` ${ref.targetName}` : ""} from ${ref.fromPath}`,
				phase: "resolve",
				span: ref.span,
			});
		}
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
		issues: modelIssues,
	};
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
