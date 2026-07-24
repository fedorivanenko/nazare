import type { ThemeMetafieldSnapshot } from "./theme-external-types.js";
import type { ThemeDataAccessRecord } from "./theme-facts.js";
import {
	analyzeMetafields,
	type ThemeMetafieldAnalysis,
	type ThemeMetafieldDefinitionRecord,
	type ThemeMetafieldReadRecord,
} from "./theme-metafields.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeMetafieldRecord =
	| ThemeMetafieldDefinitionRecord
	| ThemeMetafieldReadRecord;

export type ThemeMetafieldPassContext = {
	metafieldSnapshot?: ThemeMetafieldSnapshot;
	dataAccessesBySource: Map<string, ThemeDataAccessRecord[]>;
	metafieldResult: { current: ThemeMetafieldAnalysis };
};

export function createThemeMetafieldPass(): IncrementalPass<
	string,
	ThemeMetafieldRecord,
	ThemeMetafieldPassContext
> {
	return {
		name: "metafields",
		stage: "metafields",
		routes: [
			{ kind: "metafieldReadChanged", target: "capabilities" },
			{ kind: "diagnosticsChanged", target: "diagnostics" },
		],
		collectChanges(changes) {
			const keys = new Set<string>();
			for (const change of changes) {
				if (change.kind === "dataFlowChanged") {
					keys.add(`source:${change.sourcePath}`);
				} else if (change.kind === "metafieldSnapshotChanged") {
					keys.add("snapshot");
				}
			}
			return keys;
		},
		run(_keys, context) {
			const previous = context.metafieldResult.current;
			const next = analyzeMetafields(
				context.metafieldSnapshot,
				[...context.dataAccessesBySource.values()].flat(),
			);
			context.metafieldResult.current = next;
			const changedReadIds = changedIds(previous.reads, next.reads);
			const diagnosticsChanged =
				JSON.stringify(previous.issues) !== JSON.stringify(next.issues);
			return {
				records: [...next.definitions, ...next.reads],
				changes: [
					...changedReadIds.map(
						(id): PassChange => ({ kind: "metafieldReadChanged", id }),
					),
					...(diagnosticsChanged
						? ([
								{ kind: "diagnosticsChanged", owner: "metafields" },
							] satisfies PassChange[])
						: []),
				],
			};
		},
	};
}

function changedIds(
	previous: ThemeMetafieldReadRecord[],
	next: ThemeMetafieldReadRecord[],
): string[] {
	const previousById = new Map(previous.map((record) => [record.id, record]));
	const nextById = new Map(next.map((record) => [record.id, record]));
	return [...new Set([...previousById.keys(), ...nextById.keys()])]
		.filter(
			(id) =>
				JSON.stringify(previousById.get(id)) !==
				JSON.stringify(nextById.get(id)),
		)
		.sort();
}
