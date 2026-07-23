import type { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeFact,
	ThemeLocaleKeyRecord,
	ThemeLocaleReferenceRecord,
	ThemeLocaleTranslationRecord,
} from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeLocalePassResult = {
	localeKeys: ThemeLocaleKeyRecord[];
	localeTranslations: ThemeLocaleTranslationRecord[];
	localeReferences: ThemeLocaleReferenceRecord[];
};

export type ThemeLocaleRecord =
	| ThemeLocaleKeyRecord
	| ThemeLocaleTranslationRecord
	| ThemeLocaleReferenceRecord;

export type ThemeLocaleIds = {
	key(key: string): string;
	translation(path: string, key: string): string;
	reference(
		path: string,
		key: string,
		span: ThemeLocaleReferenceRecord["span"],
	): string;
};

export type ThemeLocalePassContext = {
	facts: ThemeFactStore;
	localeResultsBySource: Map<string, ThemeLocalePassResult>;
	localeIds: ThemeLocaleIds;
};

export function createThemeLocalePass(): IncrementalPass<
	string,
	ThemeLocaleRecord,
	ThemeLocalePassContext
> {
	return {
		name: "locales",
		stage: "schema",
		routes: [{ kind: "diagnosticsChanged", target: "diagnostics" }],
		collectChanges(changes) {
			return new Set(
				changes
					.filter((change) => change.kind === "factsChanged")
					.map((change) => change.path),
			);
		},
		run(paths, context) {
			const records: ThemeLocaleRecord[] = [];
			const changes: PassChange[] = [];
			for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
				const next = collectThemeLocales(
					context.facts.getFile(path),
					context.localeIds,
				);
				if (localeRecords(next).length === 0) {
					context.localeResultsBySource.delete(path);
				} else {
					context.localeResultsBySource.set(path, next);
				}
				records.push(...localeRecords(next));
				changes.push({ kind: "diagnosticsChanged", owner: path });
			}
			return { records, changes };
		},
	};
}

export function collectThemeLocales(
	facts: ThemeFact[],
	ids: ThemeLocaleIds,
): ThemeLocalePassResult {
	const localeKeys: ThemeLocaleKeyRecord[] = [];
	const localeTranslations: ThemeLocaleTranslationRecord[] = [];
	const localeReferences: ThemeLocaleReferenceRecord[] = [];
	for (const fact of facts) {
		if (fact.kind === "definesLocaleKey") {
			const localeKeyId = ids.key(fact.key);
			localeKeys.push({ id: localeKeyId, key: fact.key });
			localeTranslations.push({
				id: ids.translation(fact.path, fact.key),
				path: fact.path,
				key: fact.key,
				localeKeyId,
				span: fact.span,
			});
		}
		if (fact.kind === "referencesLocaleKey") {
			localeReferences.push({
				id: ids.reference(fact.fromPath, fact.key ?? "dynamic", fact.span),
				fromPath: fact.fromPath,
				key: fact.key,
				resolvedLocaleKeyIds: [],
				static: fact.static,
				span: fact.span,
			});
		}
	}
	return { localeKeys, localeTranslations, localeReferences };
}

function localeRecords(result: ThemeLocalePassResult): ThemeLocaleRecord[] {
	return [
		...result.localeKeys,
		...result.localeTranslations,
		...result.localeReferences,
	];
}
