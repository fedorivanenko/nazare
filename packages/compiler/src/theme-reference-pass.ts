import { compareCanonicalStrings } from "./canonical-order.js";
import type { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeDeclaration,
	ThemeFact,
	ThemeReference,
} from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

/**
 * Shopify applies `layout/theme.liquid` when a template has no authored
 * `{% layout %}` tag. Materialize that platform default as a canonical
 * semantic reference so every dependency and impact query sees one topology.
 */
export function withImplicitDefaultLayoutReferences(
	declarations: ThemeDeclaration[],
	references: ThemeReference[],
): ThemeReference[] {
	const defaultLayout = declarations.find(
		(declaration) =>
			declaration.kind === "layout" && declaration.name === "theme",
	);
	if (!defaultLayout) return references;
	const explicitLayoutPaths = new Set(
		references
			.filter((reference) => reference.kind === "usesLayout")
			.map((reference) => reference.fromPath),
	);
	const implicit = declarations
		.filter(
			(declaration) =>
				declaration.kind === "template" &&
				!explicitLayoutPaths.has(declaration.path),
		)
		.map(
			(declaration): ThemeReference => ({
				id: `ref:usesLayout:${declaration.path}:theme:implicit`,
				kind: "usesLayout",
				fromPath: declaration.path,
				targetKind: "layout",
				targetName: "theme",
				resolvedDeclarationId: defaultLayout.id,
				static: true,
			}),
		);
	return [...references, ...implicit].sort((left, right) =>
		compareCanonicalStrings(left.id, right.id),
	);
}

export type ThemeReferencePassContext = {
	facts: ThemeFactStore;
	referencesBySource: Map<string, ThemeReference[]>;
	referencesById?: Map<string, ThemeReference>;
	referencesByTargetKey?: Map<string, Map<string, ThemeReference>>;
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
			for (const path of [...paths].sort((a, b) =>
				compareCanonicalStrings(a, b),
			)) {
				const previous = context.referencesBySource.get(path) ?? [];
				const next = collectThemeReferences(
					context.facts.getFile(path),
					context.id,
				);
				for (const reference of previous) {
					changedIds.add(reference.id);
					removeReferenceFromIndexes(context, reference);
				}
				for (const reference of next) {
					changedIds.add(reference.id);
					addReferenceToIndexes(context, reference);
				}
				if (next.length === 0) context.referencesBySource.delete(path);
				else context.referencesBySource.set(path, next);
				records.push(...next);
			}
			return {
				records,
				changes: [...changedIds]
					.sort((a, b) => compareCanonicalStrings(a, b))
					.map((id): PassChange => ({ kind: "referenceChanged", id })),
			};
		},
	};
}

export function referenceTargetKeys(reference: ThemeReference): string[] {
	if (reference.targetPath) {
		return [`${reference.targetKind}:${reference.targetPath}`];
	}
	if (!reference.targetName) return [];
	if (reference.kind === "referencesAsset") {
		return [
			`asset:${reference.targetName}`,
			`asset:assets/${reference.targetName}`,
		];
	}
	return [`${reference.targetKind}:${reference.targetName}`];
}

function addReferenceToIndexes(
	context: ThemeReferencePassContext,
	reference: ThemeReference,
): void {
	context.referencesById?.set(reference.id, reference);
	for (const key of referenceTargetKeys(reference)) {
		if (!context.referencesByTargetKey) continue;
		const references = new Map(context.referencesByTargetKey.get(key));
		references.set(reference.id, reference);
		context.referencesByTargetKey.set(key, references);
	}
}

function removeReferenceFromIndexes(
	context: ThemeReferencePassContext,
	reference: ThemeReference,
): void {
	context.referencesById?.delete(reference.id);
	for (const key of referenceTargetKeys(reference)) {
		const current = context.referencesByTargetKey?.get(key);
		if (!context.referencesByTargetKey || !current) continue;
		const references = new Map(current);
		references.delete(reference.id);
		if (references.size === 0) context.referencesByTargetKey.delete(key);
		else context.referencesByTargetKey.set(key, references);
	}
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
