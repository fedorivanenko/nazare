import type { ThemeSemanticModel } from "./theme-facts.js";

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
		this.model = model;
		this.indexModel(model);
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
		for (const record of records(update.model)) {
			if (!identified(record)) continue;
			if (
				!update.addedRecordIds.includes(record.id) &&
				!update.changedRecordIds.includes(record.id)
			)
				continue;
			this.recordsById.set(record.id, record);
			const path = sourcePath(record);
			if (path) addSourceIndex(this.recordIdsBySourcePath, path, record.id);
		}
		return update;
	}

	private indexModel(model: ThemeSemanticModel): void {
		for (const record of records(model)) {
			if (!identified(record)) continue;
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
		const old = new Map(
			records(previous)
				.filter(identified)
				.map((record) => [record.id, record]),
		);
		const next = new Map(
			records(model)
				.filter(identified)
				.map((record) => [record.id, record]),
		);
		const addedRecordIds = [...next.keys()].filter((id) => !old.has(id)).sort();
		const removedRecordIds = [...old.keys()]
			.filter((id) => !next.has(id))
			.sort();
		const changedRecordIds = [...next.entries()]
			.filter(
				([id, record]) =>
					old.has(id) && JSON.stringify(old.get(id)) !== JSON.stringify(record),
			)
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
	const merged: ThemeSemanticModel = { ...next };
	for (const key of Object.keys(next) as Array<keyof ThemeSemanticModel>) {
		const current = next[key];
		const old = previous[key];
		if (!Array.isArray(current) || !Array.isArray(old)) continue;
		(merged[key] as unknown[]) = shareRecords(old, current);
	}
	return merged;
}

function shareRecords(previous: unknown[], current: unknown[]): unknown[] {
	const previousById = new Map<string, unknown>();
	for (const record of previous)
		if (identified(record)) previousById.set(record.id, record);
	return current.map((record) => {
		if (!identified(record)) return record;
		const old = previousById.get(record.id);
		return old !== undefined && JSON.stringify(old) === JSON.stringify(record)
			? old
			: record;
	});
}

function records(model: ThemeSemanticModel): unknown[] {
	return Object.values(model).flatMap((value) =>
		Array.isArray(value) ? value : [],
	);
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
