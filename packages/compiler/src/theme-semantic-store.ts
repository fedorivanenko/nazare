import { isDeepStrictEqual } from "node:util";
import type { ThemeSemanticModel } from "./theme-facts.js";

const NON_RECORD_MODEL_KEYS = new Set<keyof ThemeSemanticModel>([
	"version",
	"root",
	"metafieldSchema",
	"themeCheck",
	"issues",
]);

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

	constructor(model: ThemeSemanticModel) {
		this.model = canonicalizeSemanticModel(model);
		this.indexModel(this.model);
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
			mergeSemanticModels(this.model, next),
		);
	}

	commit(update: ThemeSemanticUpdate): ThemeSemanticUpdate {
		this.model = update.model;
		for (const id of [...update.removedRecordIds, ...update.changedRecordIds]) {
			const previous = this.recordsById.get(id);
			if (previous)
				removeSourceIndex(this.recordIdsBySourcePath, id, sourcePath(previous));
			this.recordsById.delete(id);
		}
		const updatedRecordIds = new Set([
			...update.addedRecordIds,
			...update.changedRecordIds,
		]);
		for (const record of records(update.model)) {
			if (!updatedRecordIds.has(record.id)) continue;
			this.recordsById.set(record.id, record);
			const path = sourcePath(record);
			if (path) addSourceIndex(this.recordIdsBySourcePath, path, record.id);
		}
		return update;
	}

	private indexModel(model: ThemeSemanticModel): void {
		for (const record of records(model)) {
			this.recordsById.set(record.id, record);
			const path = sourcePath(record);
			if (path) addSourceIndex(this.recordIdsBySourcePath, path, record.id);
		}
	}
}

export class ThemeSemanticTransaction {
	readonly update: ThemeSemanticUpdate;
	private committed = false;

	constructor(
		private readonly store: ThemeSemanticStore,
		previous: ThemeSemanticModel,
		model: ThemeSemanticModel,
	) {
		const old = groupRecordsById(previous);
		const next = groupRecordsById(model);
		const addedRecordIds = [...next.keys()].filter((id) => !old.has(id)).sort();
		const removedRecordIds = [...old.keys()]
			.filter((id) => !next.has(id))
			.sort();
		const changedRecordIds = [...next.entries()]
			.filter(([id, groupedRecords]) => {
				const previousRecords = old.get(id);
				return (
					previousRecords !== undefined &&
					!sameRecords(previousRecords, groupedRecords)
				);
			})
			.map(([id]) => id)
			.sort();
		this.update = { model, addedRecordIds, removedRecordIds, changedRecordIds };
	}

	commit(): ThemeSemanticUpdate {
		if (this.committed)
			throw new Error("Semantic transaction already committed");
		this.committed = true;
		return this.store.commit(this.update);
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
		if (!Array.isArray(value) || !value.every(identified)) continue;
		const sorted = [...value].sort((a, b) =>
			identified(a) && identified(b) ? a.id.localeCompare(b.id) : 0,
		);
		const unchanged = sorted.every((record, index) => record === value[index]);
		if (!unchanged) (canonical[key] as unknown[]) = sorted;
	}
	return canonical;
}

function shareRecords(previous: unknown[], current: unknown[]): unknown[] {
	const previousById = new Map<string, unknown>();
	for (const record of previous)
		if (identified(record)) previousById.set(record.id, record);
	return current.map((record) => {
		if (!identified(record)) return record;
		const old = previousById.get(record.id);
		return old !== undefined && sameRecord(old, record) ? old : record;
	});
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

function groupRecordsById(model: ThemeSemanticModel): Map<string, unknown[]> {
	const grouped = new Map<string, unknown[]>();
	for (const record of records(model)) {
		const values = grouped.get(record.id) ?? [];
		values.push(record);
		grouped.set(record.id, values);
	}
	return grouped;
}

function records(model: ThemeSemanticModel): Array<{ id: string }> {
	const result: Array<{ id: string }> = [];
	for (const [key, value] of Object.entries(model)) {
		if (NON_RECORD_MODEL_KEYS.has(key as keyof ThemeSemanticModel)) continue;
		if (!Array.isArray(value)) {
			throw new Error(`Semantic model field ${key} must be a record array`);
		}
		for (const record of value) {
			if (!identified(record) || record.id.length === 0) {
				throw new Error(
					`Semantic model field ${key} contains a record without an id`,
				);
			}
			result.push(record);
		}
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
