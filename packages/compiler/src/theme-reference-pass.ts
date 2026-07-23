import type { ThemeFact, ThemeReference } from "./theme-facts.js";

export function collectThemeReferences(
	facts: ThemeFact[],
	id: (reference: Omit<ThemeReference, "id">) => string,
): ThemeReference[] {
	const references: ThemeReference[] = [];
	for (const fact of facts) {
		const reference = referenceFromFact(fact);
		if (!reference) continue;
		references.push({ id: id(reference), ...reference });
	}
	return references;
}

function referenceFromFact(
	fact: ThemeFact,
): Omit<ThemeReference, "id"> | undefined {
	if (fact.kind === "rendersSnippet") {
		return {
			kind: "rendersSnippet",
			fromPath: fact.fromPath,
			targetKind: "snippet",
			targetName: fact.targetName,
			static: fact.static,
			span: fact.span,
		};
	}
	if (fact.kind === "containsSection") {
		return {
			kind: "containsSection",
			fromPath: fact.fromPath,
			targetKind: "section",
			targetName: fact.targetName,
			static: fact.static,
			span: fact.span,
		};
	}
	if (fact.kind === "containsSectionGroup") {
		return {
			kind: "containsSectionGroup",
			fromPath: fact.fromPath,
			targetKind: "sectionGroup",
			targetName: fact.targetName,
			static: fact.static,
			span: fact.span,
		};
	}
	if (fact.kind === "usesLayout") {
		return {
			kind: "usesLayout",
			fromPath: fact.fromPath,
			targetKind: "layout",
			targetName: fact.targetName,
			static: fact.static,
			span: fact.span,
		};
	}
	if (fact.kind === "referencesAsset") {
		return {
			kind: "referencesAsset",
			fromPath: fact.fromPath,
			targetKind: "asset",
			targetName: fact.targetName,
			static: fact.static,
			span: fact.span,
		};
	}
	if (fact.kind === "importsComponent") {
		return {
			kind: "importsComponent",
			fromPath: fact.fromPath,
			targetKind: "component",
			targetName: fact.localName,
			targetPath: fact.targetPath,
			static: true,
			span: fact.span,
		};
	}
	return undefined;
}
