import type {
	ThemeDeclaration,
	ThemeFact,
	ThemeFileRecord,
} from "./theme-facts.js";

export type ThemeDeclarationPassResult = {
	files: Map<string, ThemeFileRecord>;
	declarations: ThemeDeclaration[];
};

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

function record(
	kind: ThemeDeclaration["kind"],
	fact: { path: string; name: string },
): Omit<ThemeDeclaration, "id"> {
	return { kind, path: fact.path, name: fact.name };
}
