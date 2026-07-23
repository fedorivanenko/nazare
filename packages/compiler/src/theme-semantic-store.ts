import type { ThemeSemanticModel } from "./theme-facts.js";

export class ThemeSemanticStore {
	private model: ThemeSemanticModel;

	constructor(model: ThemeSemanticModel) {
		this.model = model;
	}

	getModel(): ThemeSemanticModel {
		return this.model;
	}

	beginUpdate(next: ThemeSemanticModel): ThemeSemanticTransaction {
		return new ThemeSemanticTransaction(
			this,
			mergeSemanticModels(this.model, next),
		);
	}

	commit(next: ThemeSemanticModel): ThemeSemanticModel {
		this.model = next;
		return this.model;
	}
}

export class ThemeSemanticTransaction {
	private committed = false;

	constructor(
		private readonly store: ThemeSemanticStore,
		readonly model: ThemeSemanticModel,
	) {}

	commit(): ThemeSemanticModel {
		if (this.committed)
			throw new Error("Semantic transaction already committed");
		this.committed = true;
		return this.store.commit(this.model);
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
	for (const record of previous) {
		if (isIdentifiedRecord(record)) previousById.set(record.id, record);
	}
	return current.map((record) => {
		if (!isIdentifiedRecord(record)) return record;
		const old = previousById.get(record.id);
		return old !== undefined && JSON.stringify(old) === JSON.stringify(record)
			? old
			: record;
	});
}

function isIdentifiedRecord(value: unknown): value is { id: string } {
	return (
		value !== null &&
		typeof value === "object" &&
		"id" in value &&
		typeof value.id === "string"
	);
}
