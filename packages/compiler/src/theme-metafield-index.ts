import type {
	ThemeMetafieldDefinitionRecord,
	ThemeMetafieldReadRecord,
	ThemeSemanticModel,
} from "./theme-facts.js";
import type { ThemeSemanticUpdate } from "./theme-semantic-store.js";

export class ThemeMetafieldIndex {
	private readonly definitions = new Map<
		string,
		ThemeMetafieldDefinitionRecord
	>();
	private readonly reads = new Map<string, ThemeMetafieldReadRecord>();
	private readonly readIdsByDefinition = new Map<string, Set<string>>();

	constructor(model: ThemeSemanticModel) {
		this.addModel(model);
	}

	apply(update: ThemeSemanticUpdate): void {
		for (const id of [...update.removedRecordIds, ...update.changedRecordIds]) {
			this.removeDefinition(id);
			this.removeRead(id);
		}
		const ids = new Set([...update.addedRecordIds, ...update.changedRecordIds]);
		for (const definition of update.model.metafieldDefinitions) {
			if (ids.has(definition.id)) this.addDefinition(definition);
		}
		for (const read of update.model.metafieldReads) {
			if (ids.has(read.id)) this.addRead(read);
		}
	}

	getDefinition(id: string): ThemeMetafieldDefinitionRecord | undefined {
		return this.definitions.get(id);
	}

	getReads(definitionId: string): ThemeMetafieldReadRecord[] {
		return [...(this.readIdsByDefinition.get(definitionId) ?? [])]
			.map((id) => this.reads.get(id))
			.filter((read): read is ThemeMetafieldReadRecord => read !== undefined)
			.sort((a, b) => a.id.localeCompare(b.id));
	}

	getAffectedSources(definitionId: string): string[] {
		return [
			...new Set(this.getReads(definitionId).map((read) => read.fromPath)),
		].sort();
	}

	getConsumedDefinitionIds(): string[] {
		return [...this.definitions.keys()]
			.filter((id) => (this.readIdsByDefinition.get(id)?.size ?? 0) > 0)
			.sort();
	}

	getUnconsumedDefinitionIds(): string[] {
		return [...this.definitions.keys()]
			.filter((id) => (this.readIdsByDefinition.get(id)?.size ?? 0) === 0)
			.sort();
	}

	getBrokenReadIds(): string[] {
		return [...this.reads.values()]
			.filter((read) => !read.definitionId)
			.map((read) => read.id)
			.sort();
	}

	private addModel(model: ThemeSemanticModel): void {
		for (const definition of model.metafieldDefinitions)
			this.addDefinition(definition);
		for (const read of model.metafieldReads) this.addRead(read);
	}

	private addDefinition(definition: ThemeMetafieldDefinitionRecord): void {
		this.definitions.set(definition.id, definition);
	}

	private removeDefinition(id: string): void {
		this.definitions.delete(id);
	}

	private addRead(read: ThemeMetafieldReadRecord): void {
		this.reads.set(read.id, read);
		if (!read.definitionId) return;
		const ids =
			this.readIdsByDefinition.get(read.definitionId) ?? new Set<string>();
		ids.add(read.id);
		this.readIdsByDefinition.set(read.definitionId, ids);
	}

	private removeRead(id: string): void {
		const read = this.reads.get(id);
		if (!read) return;
		this.reads.delete(id);
		if (!read.definitionId) return;
		const ids = this.readIdsByDefinition.get(read.definitionId);
		ids?.delete(id);
		if (ids?.size === 0) this.readIdsByDefinition.delete(read.definitionId);
	}
}
