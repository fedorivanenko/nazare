import { isDeepStrictEqual } from "node:util";
import { compareCanonicalStrings } from "./canonical-order.js";
import type { ThemeSemanticModel } from "./theme-facts.js";

const NON_RECORD_MODEL_KEYS = new Set<keyof ThemeSemanticModel>([
	"version",
	"root",
	"metafieldSchema",
	"themeCheck",
	"issues",
]);

type RecordGroups = Map<string, unknown[]>;
type RecordGroupsByField = Map<keyof ThemeSemanticModel, RecordGroups>;

export type ThemeSemanticUpdate = {
	model: ThemeSemanticModel;
	addedRecordIds: string[];
	removedRecordIds: string[];
	changedRecordIds: string[];
};

export class ThemeSemanticStore {
	private model: ThemeSemanticModel;
	private readonly recordsById = new Map<string, unknown>();
	private readonly recordIdsBySourcePath = new Map<string, Set<string>>();
	private recordGroupsById: RecordGroups;
	private recordGroupsByField: RecordGroupsByField;

	constructor(model: ThemeSemanticModel) {
		this.model = canonicalizeSemanticModel(model);
		this.recordGroupsByField = groupRecordsByField(this.model);
		this.recordGroupsById = combineFieldGroups(this.recordGroupsByField);
		this.indexRecordGroups(this.recordGroupsById);
	}

	getModel(): ThemeSemanticModel {
		return this.model;
	}

	getRecord(id: string): unknown {
		return this.recordsById.get(id);
	}

	getRecordIdsForSourcePath(path: string): string[] {
		return [...(this.recordIdsBySourcePath.get(path) ?? [])].sort();
	}

	beginUpdate(next: ThemeSemanticModel): ThemeSemanticTransaction {
		return new ThemeSemanticTransaction(
			this,
			this.model,
			this.recordGroupsById,
			this.recordGroupsByField,
			mergeSemanticModels(this.model, next),
		);
	}

	commit(
		update: ThemeSemanticUpdate,
		nextGroups: RecordGroups,
		nextGroupsByField: RecordGroupsByField,
	): ThemeSemanticUpdate {
		this.model = update.model;
		for (const id of [...update.removedRecordIds, ...update.changedRecordIds]) {
			for (const previous of this.recordGroupsById.get(id) ?? []) {
				removeSourceIndex(this.recordIdsBySourcePath, id, sourcePath(previous));
			}
			this.recordsById.delete(id);
		}
		for (const id of [...update.addedRecordIds, ...update.changedRecordIds]) {
			const records = nextGroups.get(id) ?? [];
			const representative = records.at(-1);
			if (representative) this.recordsById.set(id, representative);
			for (const record of records) {
				const path = sourcePath(record);
				if (path) addSourceIndex(this.recordIdsBySourcePath, path, id);
			}
		}
		this.recordGroupsById = nextGroups;
		this.recordGroupsByField = nextGroupsByField;
		return update;
	}

	private indexRecordGroups(groups: Map<string, unknown[]>): void {
		for (const [id, records] of groups) {
			const representative = records.at(-1);
			if (representative) this.recordsById.set(id, representative);
			for (const record of records) {
				const path = sourcePath(record);
				if (path) addSourceIndex(this.recordIdsBySourcePath, path, id);
			}
		}
	}
}

export class ThemeSemanticTransaction {
	readonly update: ThemeSemanticUpdate;
	private committed = false;

	private readonly nextGroups: RecordGroups;
	private readonly nextGroupsByField: RecordGroupsByField;

	constructor(
		private readonly store: ThemeSemanticStore,
		previousModel: ThemeSemanticModel,
		old: RecordGroups,
		oldByField: RecordGroupsByField,
		model: ThemeSemanticModel,
	) {
		const nextByField = new Map(oldByField);
		const next = new Map(old);
		const affectedIds = new Set<string>();
		for (const [key, value] of recordArrays(model)) {
			const previousValue = previousModel[key];
			if (value === previousValue || !Array.isArray(previousValue)) continue;
			const fieldAffectedIds = changedIds(previousValue, value);
			if (fieldAffectedIds.size === 0) continue;
			const previousGroups = oldByField.get(key) ?? new Map();
			const currentGroups = groupSelectedRecords(value, fieldAffectedIds);
			const nextFieldGroups = new Map(previousGroups);
			for (const id of fieldAffectedIds) {
				affectedIds.add(id);
				const previousRecords = previousGroups.get(id) ?? [];
				const currentRecords = currentGroups.get(id) ?? [];
				const retained = removeRecordOccurrences(
					next.get(id) ?? [],
					previousRecords,
				);
				const replacement = [...retained, ...currentRecords];
				if (replacement.length === 0) next.delete(id);
				else next.set(id, replacement);
				if (currentRecords.length === 0) nextFieldGroups.delete(id);
				else nextFieldGroups.set(id, currentRecords);
			}
			nextByField.set(key, nextFieldGroups);
		}
		this.nextGroups = next;
		this.nextGroupsByField = nextByField;
		const addedRecordIds = [...affectedIds]
			.filter((id) => !old.has(id) && next.has(id))
			.sort();
		const removedRecordIds = [...affectedIds]
			.filter((id) => old.has(id) && !next.has(id))
			.sort();
		const changedRecordIds = [...affectedIds]
			.filter((id) => {
				const previousRecords = old.get(id);
				const nextRecords = next.get(id);
				return (
					previousRecords !== undefined &&
					nextRecords !== undefined &&
					!sameRecords(previousRecords, nextRecords)
				);
			})
			.sort();
		this.update = { model, addedRecordIds, removedRecordIds, changedRecordIds };
	}

	commit(): ThemeSemanticUpdate {
		if (this.committed)
			throw new Error("Semantic transaction already committed");
		this.committed = true;
		return this.store.commit(
			this.update,
			this.nextGroups,
			this.nextGroupsByField,
		);
	}
}

function mergeSemanticModels(
	previous: ThemeSemanticModel,
	next: ThemeSemanticModel,
): ThemeSemanticModel {
	const canonicalNext = canonicalizeSemanticModel(next);
	const merged: ThemeSemanticModel = { ...canonicalNext };
	for (const key of Object.keys(canonicalNext) as Array<
		keyof ThemeSemanticModel
	>) {
		const current = canonicalNext[key];
		const old = previous[key];
		if (!Array.isArray(current) || !Array.isArray(old)) continue;
		(merged[key] as unknown[]) = shareRecords(old, current);
	}
	return merged;
}

function canonicalizeSemanticModel(
	model: ThemeSemanticModel,
): ThemeSemanticModel {
	const canonical: ThemeSemanticModel = { ...model };
	for (const key of Object.keys(model) as Array<keyof ThemeSemanticModel>) {
		const value = model[key];
		if (!Array.isArray(value)) continue;
		let previousId: string | undefined;
		let canonicalOrder = true;
		for (const record of value) {
			if (!identified(record)) {
				canonicalOrder = true;
				previousId = undefined;
				break;
			}
			if (
				previousId !== undefined &&
				compareCanonicalStrings(previousId, record.id) > 0
			) {
				canonicalOrder = false;
				break;
			}
			previousId = record.id;
		}
		if (!canonicalOrder) {
			(canonical[key] as unknown[]) = [...value].sort((a, b) =>
				identified(a) && identified(b)
					? compareCanonicalStrings(a.id, b.id)
					: 0,
			);
		}
	}
	return canonical;
}

function shareRecords(previous: unknown[], current: unknown[]): unknown[] {
	if (
		previous.length === current.length &&
		current.every((record, index) => record === previous[index])
	) {
		return previous;
	}
	const previousById = new Map<string, unknown>();
	for (const record of previous)
		if (identified(record)) previousById.set(record.id, record);
	const shared = current.map((record) => {
		if (!identified(record)) return record;
		const old = previousById.get(record.id);
		return old !== undefined && sameRecord(old, record) ? old : record;
	});
	return previous.length === shared.length &&
		shared.every((record, index) => record === previous[index])
		? previous
		: shared;
}

function removeRecordOccurrences(
	current: unknown[],
	removed: unknown[],
): unknown[] {
	const retained = [...current];
	for (const record of removed) {
		const index = retained.indexOf(record);
		if (index >= 0) retained.splice(index, 1);
	}
	return retained;
}

function sameRecords(previous: unknown[], next: unknown[]): boolean {
	return (
		previous.length === next.length &&
		previous.every((record, index) => sameRecord(record, next[index]))
	);
}

function sameRecord(previous: unknown, next: unknown): boolean {
	return previous === next || isDeepStrictEqual(previous, next);
}

function groupRecordsByField(model: ThemeSemanticModel): RecordGroupsByField {
	return new Map(
		recordArrays(model).map(([key, value]) => [key, groupRecords(value)]),
	);
}

function combineFieldGroups(byField: RecordGroupsByField): RecordGroups {
	const combined: RecordGroups = new Map();
	for (const groups of byField.values()) {
		for (const [id, records] of groups) {
			combined.set(id, [...(combined.get(id) ?? []), ...records]);
		}
	}
	return combined;
}

function changedIds(previous: unknown[], current: unknown[]): Set<string> {
	let prefix = 0;
	while (
		prefix < previous.length &&
		prefix < current.length &&
		sameRecord(previous[prefix], current[prefix])
	) {
		prefix += 1;
	}
	let previousEnd = previous.length;
	let currentEnd = current.length;
	while (
		previousEnd > prefix &&
		currentEnd > prefix &&
		sameRecord(previous[previousEnd - 1], current[currentEnd - 1])
	) {
		previousEnd -= 1;
		currentEnd -= 1;
	}
	const ids = new Set<string>();
	for (const record of previous.slice(prefix, previousEnd)) {
		if (identified(record)) ids.add(record.id);
	}
	for (const record of current.slice(prefix, currentEnd)) {
		if (identified(record)) ids.add(record.id);
	}
	return ids;
}

function groupSelectedRecords(
	records: unknown[],
	selectedIds: ReadonlySet<string>,
): RecordGroups {
	const grouped: RecordGroups = new Map();
	for (const record of records) {
		if (!identified(record) || !selectedIds.has(record.id)) continue;
		const values = grouped.get(record.id);
		if (values) values.push(record);
		else grouped.set(record.id, [record]);
	}
	return grouped;
}

function groupRecords(records: unknown[]): RecordGroups {
	const grouped: RecordGroups = new Map();
	for (const record of records) {
		if (!identified(record) || record.id.length === 0) {
			throw new Error(
				"Semantic model record field contains a record without an id",
			);
		}
		const values = grouped.get(record.id) ?? [];
		values.push(record);
		grouped.set(record.id, values);
	}
	return grouped;
}

function recordArrays(
	model: ThemeSemanticModel,
): Array<[keyof ThemeSemanticModel, unknown[]]> {
	const result: Array<[keyof ThemeSemanticModel, unknown[]]> = [];
	for (const [rawKey, value] of Object.entries(model)) {
		const key = rawKey as keyof ThemeSemanticModel;
		if (NON_RECORD_MODEL_KEYS.has(key)) continue;
		if (!Array.isArray(value)) {
			throw new Error(`Semantic model field ${rawKey} must be a record array`);
		}
		result.push([key, value]);
	}
	return result;
}

function identified(value: unknown): value is { id: string } {
	return (
		value !== null &&
		typeof value === "object" &&
		"id" in value &&
		typeof value.id === "string"
	);
}

function sourcePath(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	if ("path" in value && typeof value.path === "string") return value.path;
	if ("fromPath" in value && typeof value.fromPath === "string")
		return value.fromPath;
	return undefined;
}

function addSourceIndex(
	map: Map<string, Set<string>>,
	path: string,
	id: string,
): void {
	const ids = map.get(path) ?? new Set<string>();
	ids.add(id);
	map.set(path, ids);
}

function removeSourceIndex(
	map: Map<string, Set<string>>,
	id: string,
	path: string | undefined,
): void {
	if (!path) return;
	const ids = map.get(path);
	if (!ids) return;
	ids.delete(id);
	if (ids.size === 0) map.delete(path);
}
