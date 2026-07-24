import type { ThemeMetafieldSnapshot } from "./theme-external-types.js";
import type { ThemeDataAccessRecord } from "./theme-facts.js";
import {
	collectMetafieldDefinitions,
	collectMetafieldReads,
	joinMetafieldReads,
	metafieldJoinKey,
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
					keys.add("snapshot-state");
					for (const key of change.changedKeys) keys.add(`snapshot:${key}`);
				}
			}
			return keys;
		},
		run(keys, context) {
			const previous = context.metafieldResult.current;
			const snapshotChanged =
				keys.has("snapshot-state") ||
				(context.metafieldSnapshot !== undefined &&
					previous.state === "unknown" &&
					previous.definitions.length === 0);
			const collection = snapshotChanged
				? collectMetafieldDefinitions(context.metafieldSnapshot)
				: previous;
			const definitions = shareDefinitions(
				previous.definitions,
				collection.definitions,
			);
			let reads = [...previous.reads];
			if (collection.state === "invalid") {
				reads = [];
			} else {
				for (const key of [...keys].sort()) {
					if (!key.startsWith("source:")) continue;
					const sourcePath = key.slice("source:".length);
					reads = reads.filter((read) => read.fromPath !== sourcePath);
					reads.push(
						...joinMetafieldReads(
							definitions,
							collectMetafieldReads(
								context.dataAccessesBySource.get(sourcePath) ?? [],
							),
						),
					);
				}
				const changedJoinKeys = new Set(
					[...keys]
						.filter((key) => key.startsWith("snapshot:"))
						.map((key) => key.slice("snapshot:".length)),
				);
				reads = reads.map((read) =>
					changedJoinKeys.has(
						metafieldJoinKey(read.owner, read.namespace, read.key),
					)
						? rejoinRead(definitions, read)
						: read,
				);
			}
			reads.sort((a, b) => a.id.localeCompare(b.id));
			const issues = metafieldIssues(
				collection,
				reads,
				context.metafieldSnapshot,
			);
			const next: ThemeMetafieldAnalysis = {
				definitions,
				reads,
				issues,
				state: collection.state,
				path: collection.path,
				pulledAt: collection.pulledAt,
			};
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

function shareDefinitions(
	previous: ThemeMetafieldDefinitionRecord[],
	next: ThemeMetafieldDefinitionRecord[],
): ThemeMetafieldDefinitionRecord[] {
	const previousById = new Map(previous.map((record) => [record.id, record]));
	return next.map((record) => {
		const existing = previousById.get(record.id);
		return existing && JSON.stringify(existing) === JSON.stringify(record)
			? existing
			: record;
	});
}

function rejoinRead(
	definitions: ThemeMetafieldDefinitionRecord[],
	read: ThemeMetafieldReadRecord,
): ThemeMetafieldReadRecord {
	const joined = joinMetafieldReads(definitions, [read])[0];
	return joined?.definitionId === read.definitionId ? read : (joined ?? read);
}

function metafieldIssues(
	collection: Pick<ThemeMetafieldAnalysis, "issues" | "path" | "state">,
	reads: ThemeMetafieldReadRecord[],
	snapshot: ThemeMetafieldSnapshot | undefined,
): ThemeMetafieldAnalysis["issues"] {
	if (collection.state === "invalid") return collection.issues;
	if (!snapshot) return [];
	return reads
		.filter((read) => !read.definitionId)
		.map((read) => ({
			severity: "warning" as const,
			code: "THEME_METAFIELD_UNRESOLVED",
			message: `Metafield ${read.owner}.metafields.${read.namespace}.${read.key} is not defined in ${collection.path}`,
			phase: "resolve" as const,
		}));
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
