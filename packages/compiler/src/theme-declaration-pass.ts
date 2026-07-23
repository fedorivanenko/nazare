import type { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeDeclaration,
	ThemeFact,
	ThemeFileRecord,
} from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeDeclarationPassResult = {
	files: Map<string, ThemeFileRecord>;
	declarations: ThemeDeclaration[];
};

export type ThemeDeclarationPassContext = {
	facts: ThemeFactStore;
	resultsBySource: Map<string, ThemeDeclarationPassResult>;
	declarationsByKey?: Map<string, Map<string, ThemeDeclaration>>;
	ids: {
		file(path: string): string;
		declaration(kind: string, path: string, name: string): string;
	};
};

export type ThemeDeclarationPassRecord = ThemeFileRecord | ThemeDeclaration;

export function createThemeDeclarationPass(): IncrementalPass<
	string,
	ThemeDeclarationPassRecord,
	ThemeDeclarationPassContext
> {
	return {
		name: "declarations",
		stage: "declarations",
		routes: [{ kind: "declarationChanged", target: "resolution" }],
		collectChanges(changes) {
			return changedSourcePaths(changes);
		},
		run(paths, context) {
			const records: ThemeDeclarationPassRecord[] = [];
			const changedKeys = new Set<string>();
			for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
				const previous = context.resultsBySource.get(path);
				const next = collectThemeDeclarations(
					context.facts.getFile(path),
					context.ids,
				);
				for (const declaration of previous?.declarations ?? []) {
					for (const key of declarationKeys(declaration)) {
						changedKeys.add(key);
						removeDeclarationFromIndex(
							context.declarationsByKey,
							key,
							declaration.id,
						);
					}
				}
				for (const declaration of next.declarations) {
					for (const key of declarationKeys(declaration)) {
						changedKeys.add(key);
						addDeclarationToIndex(context.declarationsByKey, key, declaration);
					}
				}
				if (next.files.size === 0 && next.declarations.length === 0) {
					context.resultsBySource.delete(path);
				} else {
					context.resultsBySource.set(path, next);
				}
				records.push(...next.files.values(), ...next.declarations);
			}
			return {
				records,
				changes: [...changedKeys]
					.sort((a, b) => a.localeCompare(b))
					.map((key): PassChange => ({ kind: "declarationChanged", key })),
			};
		},
	};
}

export function collectThemeDeclarations(
	facts: ThemeFact[],
	ids: {
		file(path: string): string;
		declaration(kind: string, path: string, name: string): string;
	},
): ThemeDeclarationPassResult {
	const files = new Map<string, ThemeFileRecord>();
	const declarations: ThemeDeclaration[] = [];
	for (const fact of facts) {
		if (fact.kind === "file") {
			files.set(fact.path, {
				id: ids.file(fact.path),
				path: fact.path,
				fileKind: fact.fileKind,
			});
			continue;
		}
		const declaration = declarationFromFact(fact);
		if (!declaration) continue;
		declarations.push({
			id: ids.declaration(declaration.kind, declaration.path, declaration.name),
			...declaration,
		});
	}
	return { files, declarations };
}

function declarationFromFact(
	fact: ThemeFact,
): Omit<ThemeDeclaration, "id"> | undefined {
	if (fact.kind === "declaresSection") return record("section", fact);
	if (fact.kind === "declaresSnippet") return record("snippet", fact);
	if (fact.kind === "declaresTemplate") return record("template", fact);
	if (fact.kind === "declaresLayout") return record("layout", fact);
	if (fact.kind === "declaresLocale") return record("locale", fact);
	if (fact.kind === "declaresAsset") return record("asset", fact);
	if (fact.kind === "declaresSectionGroup") return record("sectionGroup", fact);
	if (fact.kind === "declaresThemeBlock") return record("themeBlock", fact);
	if (fact.kind === "declaresComponent") {
		return { ...record("component", fact), componentKind: fact.componentKind };
	}
	return undefined;
}

function changedSourcePaths(changes: readonly PassChange[]): Set<string> {
	return new Set(
		changes
			.filter((change) => change.kind === "factsChanged")
			.map((change) => change.path),
	);
}

function declarationKeys(declaration: ThemeDeclaration): string[] {
	const keys = [`${declaration.kind}:${declaration.name}`];
	if (declaration.kind === "component" || declaration.kind === "asset") {
		keys.push(`${declaration.kind}:${declaration.path}`);
	}
	return keys;
}

function addDeclarationToIndex(
	index: Map<string, Map<string, ThemeDeclaration>> | undefined,
	key: string,
	declaration: ThemeDeclaration,
): void {
	if (!index) return;
	const declarations = index.get(key) ?? new Map<string, ThemeDeclaration>();
	declarations.set(declaration.id, declaration);
	index.set(key, declarations);
}

function removeDeclarationFromIndex(
	index: Map<string, Map<string, ThemeDeclaration>> | undefined,
	key: string,
	id: string,
): void {
	const declarations = index?.get(key);
	if (!declarations) return;
	declarations.delete(id);
	if (declarations.size === 0) index?.delete(key);
}

function record(
	kind: ThemeDeclaration["kind"],
	fact: { path: string; name: string },
): Omit<ThemeDeclaration, "id"> {
	return { kind, path: fact.path, name: fact.name };
}
