import type { ThemeFactStore } from "./theme-fact-store.js";
import type { ThemeFact, ThemeReference } from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeReferencePassContext = {
	facts: ThemeFactStore;
	referencesBySource: Map<string, ThemeReference[]>;
	id(reference: Omit<ThemeReference, "id">): string;
};

export function createThemeReferencePass(): IncrementalPass<
	string,
	ThemeReference,
	ThemeReferencePassContext
> {
	return {
		name: "references",
		stage: "references",
		routes: [{ kind: "referenceChanged", target: "resolution" }],
		collectChanges(changes) {
			return new Set(
				changes
					.filter((change) => change.kind === "factsChanged")
					.map((change) => change.path),
			);
		},
		run(paths, context) {
			const records: ThemeReference[] = [];
			const changedIds = new Set<string>();
			for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
				const previous = context.referencesBySource.get(path) ?? [];
				const next = collectThemeReferences(
					context.facts.getFile(path),
					context.id,
				);
				for (const reference of previous) changedIds.add(reference.id);
				for (const reference of next) changedIds.add(reference.id);
				if (next.length === 0) context.referencesBySource.delete(path);
				else context.referencesBySource.set(path, next);
				records.push(...next);
			}
			return {
				records,
				changes: [...changedIds]
					.sort((a, b) => a.localeCompare(b))
					.map((id): PassChange => ({ kind: "referenceChanged", id })),
			};
		},
	};
}

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
