import type {
	ThemeCapabilityRecord,
	ThemeCapabilitySignalRecord,
	ThemeDataAccessRecord,
} from "./theme-facts.js";
import { inferCapabilities } from "./theme-inference.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeCapabilityPassContext = {
	dataAccessesBySource: Map<string, ThemeDataAccessRecord[]>;
	capabilitySignalsBySource: Map<string, ThemeCapabilitySignalRecord[]>;
	capabilitiesBySource: Map<string, ThemeCapabilityRecord[]>;
};

export function deriveThemeCapabilities(
	path: string,
	dataAccesses: ThemeDataAccessRecord[],
	capabilitySignals: ThemeCapabilitySignalRecord[],
): ThemeCapabilityRecord[] {
	return inferCapabilities(dataAccesses, capabilitySignals)
		.filter((record) => record.path === path)
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function createThemeCapabilityPass(): IncrementalPass<
	string,
	ThemeCapabilityRecord,
	ThemeCapabilityPassContext
> {
	return {
		name: "capabilities",
		stage: "capabilities",
		routes: [{ kind: "capabilityChanged", target: "classifications" }],
		collectChanges(changes) {
			return new Set(
				changes.flatMap((change) => {
					if (change.kind === "dataFlowChanged") return [change.sourcePath];
					if (change.kind === "capabilitySignalChanged") {
						return [change.sourcePath];
					}
					return [];
				}),
			);
		},
		run(paths, context) {
			const records: ThemeCapabilityRecord[] = [];
			const changes: PassChange[] = [];
			for (const path of [...paths].sort()) {
				const previous = context.capabilitiesBySource.get(path) ?? [];
				const next = deriveThemeCapabilities(
					path,
					context.dataAccessesBySource.get(path) ?? [],
					context.capabilitySignalsBySource.get(path) ?? [],
				);
				if (next.length > 0) context.capabilitiesBySource.set(path, next);
				else context.capabilitiesBySource.delete(path);
				records.push(...next);
				for (const id of changedIds(previous, next)) {
					changes.push({ kind: "capabilityChanged", id, sourcePath: path });
				}
			}
			return { records, changes };
		},
	};
}

function changedIds(
	previous: ThemeCapabilityRecord[],
	next: ThemeCapabilityRecord[],
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
