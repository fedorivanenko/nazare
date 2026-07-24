import type {
	ThemeCapabilityRecord,
	ThemeClassificationRecord,
	ThemeDataAccessRecord,
} from "./theme-facts.js";
import { inferClassifications } from "./theme-inference.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeClassificationPassContext = {
	dataAccessesBySource: Map<string, ThemeDataAccessRecord[]>;
	capabilitiesBySource: Map<string, ThemeCapabilityRecord[]>;
	classificationsBySource: Map<string, ThemeClassificationRecord[]>;
};

export function deriveThemeClassifications(
	path: string,
	capabilities: ThemeCapabilityRecord[],
	dataAccesses: ThemeDataAccessRecord[],
): ThemeClassificationRecord[] {
	return inferClassifications(capabilities, dataAccesses)
		.filter((record) => record.path === path)
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function createThemeClassificationPass(): IncrementalPass<
	string,
	ThemeClassificationRecord,
	ThemeClassificationPassContext
> {
	return {
		name: "classifications",
		stage: "classifications",
		routes: [
			{ kind: "classificationChanged", target: "diagnostics" },
			{ kind: "classificationChanged", target: "impact" },
		],
		collectChanges(changes) {
			return new Set(
				changes.flatMap((change) => {
					if (change.kind === "dataFlowChanged") return [change.sourcePath];
					if (change.kind === "capabilityChanged") return [change.sourcePath];
					return [];
				}),
			);
		},
		run(paths, context) {
			const records: ThemeClassificationRecord[] = [];
			const changes: PassChange[] = [];
			for (const path of [...paths].sort()) {
				const previous = context.classificationsBySource.get(path) ?? [];
				const next = deriveThemeClassifications(
					path,
					context.capabilitiesBySource.get(path) ?? [],
					context.dataAccessesBySource.get(path) ?? [],
				);
				if (next.length > 0) context.classificationsBySource.set(path, next);
				else context.classificationsBySource.delete(path);
				records.push(...next);
				for (const id of changedIds(previous, next)) {
					changes.push({ kind: "classificationChanged", id, sourcePath: path });
				}
			}
			return { records, changes };
		},
	};
}

function changedIds(
	previous: ThemeClassificationRecord[],
	next: ThemeClassificationRecord[],
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
