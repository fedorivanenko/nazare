import { compareCanonicalStrings } from "./canonical-order.js";
import type {
	ThemeMetafieldDefinitionRecord,
	ThemeMetafieldReadRecord,
	ThemeSemanticModel,
} from "./theme-facts.js";
import { metafieldJoinKey } from "./theme-metafields.js";
import type { ThemeSemanticUpdate } from "./theme-semantic-store.js";

export type ThemeMetafieldIdentity = {
	owner: string;
	namespace: string;
	key: string;
};

export type ThemeMetafieldQueryResult = {
	identity: ThemeMetafieldIdentity;
	definition: ThemeMetafieldDefinitionRecord | undefined;
	reads: ThemeMetafieldReadRecord[];
	affectedSources: string[];
};

export class ThemeMetafieldIndex {
	private readonly definitions = new Map<
		string,
		ThemeMetafieldDefinitionRecord
	>();
	private readonly definitionsByIdentity = new Map<
		string,
		ThemeMetafieldDefinitionRecord
	>();
	private readonly reads = new Map<string, ThemeMetafieldReadRecord>();
	private readonly readIdsByDefinition = new Map<string, Set<string>>();
	private readonly readIdsByIdentity = new Map<string, Set<string>>();

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

	query(identity: ThemeMetafieldIdentity): ThemeMetafieldQueryResult {
		assertMetafieldIdentity(identity);
		const identityKey = metafieldJoinKey(
			identity.owner,
			identity.namespace,
			identity.key,
		);
		const reads = [...(this.readIdsByIdentity.get(identityKey) ?? [])]
			.map((id) => this.reads.get(id))
			.filter((read): read is ThemeMetafieldReadRecord => read !== undefined)
			.sort((a, b) => compareCanonicalStrings(a.id, b.id));
		return {
			identity: { ...identity },
			definition: this.definitionsByIdentity.get(identityKey),
			reads,
			affectedSources: [...new Set(reads.map((read) => read.fromPath))].sort(
				compareCanonicalStrings,
			),
		};
	}

	getReads(definitionId: string): ThemeMetafieldReadRecord[] {
		return [...(this.readIdsByDefinition.get(definitionId) ?? [])]
			.map((id) => this.reads.get(id))
			.filter((read): read is ThemeMetafieldReadRecord => read !== undefined)
			.sort((a, b) => compareCanonicalStrings(a.id, b.id));
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
		this.definitionsByIdentity.set(
			metafieldJoinKey(definition.owner, definition.namespace, definition.key),
			definition,
		);
	}

	private removeDefinition(id: string): void {
		const definition = this.definitions.get(id);
		if (!definition) return;
		this.definitions.delete(id);
		this.definitionsByIdentity.delete(
			metafieldJoinKey(definition.owner, definition.namespace, definition.key),
		);
	}

	private addRead(read: ThemeMetafieldReadRecord): void {
		this.reads.set(read.id, read);
		const identityKey = metafieldJoinKey(read.owner, read.namespace, read.key);
		const identityIds =
			this.readIdsByIdentity.get(identityKey) ?? new Set<string>();
		identityIds.add(read.id);
		this.readIdsByIdentity.set(identityKey, identityIds);
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
		const identityKey = metafieldJoinKey(read.owner, read.namespace, read.key);
		const identityIds = this.readIdsByIdentity.get(identityKey);
		identityIds?.delete(id);
		if (identityIds?.size === 0) this.readIdsByIdentity.delete(identityKey);
		if (!read.definitionId) return;
		const ids = this.readIdsByDefinition.get(read.definitionId);
		ids?.delete(id);
		if (ids?.size === 0) this.readIdsByDefinition.delete(read.definitionId);
	}
}

function assertMetafieldIdentity(identity: ThemeMetafieldIdentity): void {
	if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
		throw new Error("Metafield identity must be an object");
	}
	const expectedFields = ["key", "namespace", "owner"];
	const actualFields = Object.keys(identity).sort(compareCanonicalStrings);
	if (
		actualFields.length !== expectedFields.length ||
		actualFields.some((field, index) => field !== expectedFields[index])
	) {
		throw new Error(
			`Metafield identity must contain exactly owner, namespace, and key`,
		);
	}
	for (const field of expectedFields) {
		const value = (identity as unknown as Record<string, unknown>)[field];
		if (typeof value !== "string" || value.length === 0) {
			throw new Error(`Metafield ${field} is required`);
		}
		if (value.trim() !== value) {
			throw new Error(
				`Metafield ${field} must not contain surrounding whitespace`,
			);
		}
		if (value.includes(".")) {
			throw new Error(`Metafield ${field} must not contain a period`);
		}
	}
}
