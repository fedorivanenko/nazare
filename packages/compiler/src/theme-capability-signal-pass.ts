import type { SourceSpan } from "@nazare/core";
import type { ThemeFactStore } from "./theme-fact-store.js";
import type { ThemeCapabilitySignalRecord } from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeCapabilitySignalPassContext = {
	facts: ThemeFactStore;
	capabilitySignalsBySource: Map<string, ThemeCapabilitySignalRecord[]>;
};

export function collectThemeCapabilitySignals(
	facts: ThemeFactStore,
	sourcePath?: string,
): ThemeCapabilitySignalRecord[] {
	const signals: ThemeCapabilitySignalRecord[] = [];
	for (const fact of sourcePath ? facts.getFile(sourcePath) : facts.all()) {
		if (fact.kind !== "detectsCapability") continue;
		signals.push({
			id: capabilitySignalId(fact.path, fact.capability, fact.span),
			path: fact.path,
			capability: fact.capability,
			evidenceStrength: fact.evidenceStrength,
			span: fact.span,
		});
	}
	return signals.sort((a, b) => a.id.localeCompare(b.id));
}

export function createThemeCapabilitySignalPass(): IncrementalPass<
	string,
	ThemeCapabilitySignalRecord,
	ThemeCapabilitySignalPassContext
> {
	return {
		name: "capability-signals",
		stage: "dataFlow",
		routes: [{ kind: "capabilitySignalChanged", target: "capabilities" }],
		collectChanges(changes) {
			return new Set(
				changes
					.filter((change) => change.kind === "factsChanged")
					.map((change) => change.path),
			);
		},
		run(paths, context) {
			const records: ThemeCapabilitySignalRecord[] = [];
			const changes: PassChange[] = [];
			for (const path of [...paths].sort()) {
				const previous = context.capabilitySignalsBySource.get(path) ?? [];
				const next = collectThemeCapabilitySignals(context.facts, path);
				if (next.length > 0) context.capabilitySignalsBySource.set(path, next);
				else context.capabilitySignalsBySource.delete(path);
				records.push(...next);
				for (const id of changedIds(previous, next)) {
					changes.push({
						kind: "capabilitySignalChanged",
						id,
						sourcePath: path,
					});
				}
			}
			return { records, changes };
		},
	};
}

export function capabilitySignalId(
	path: string,
	capability: string,
	span?: SourceSpan,
): string {
	return `capability-signal:${path}:${capability}:${occurrenceSuffix(span)}`;
}

function changedIds(
	previous: ThemeCapabilitySignalRecord[],
	next: ThemeCapabilitySignalRecord[],
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

function occurrenceSuffix(span: SourceSpan | undefined): string {
	if (!span) return "unlocated";
	return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}
