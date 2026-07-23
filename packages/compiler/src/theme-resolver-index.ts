import type {
	ThemeDeclaration,
	ThemeReference,
	ThemeSemanticModel,
} from "./theme-facts.js";
import { resolveThemeDeclarationsAndReferences } from "./theme-resolution-pass.js";
import type { ThemeSemanticUpdate } from "./theme-semantic-store.js";

export class ThemeResolverIndex {
	private readonly declarations = new Map<string, ThemeDeclaration>();
	private readonly references = new Map<string, ThemeReference>();
	private readonly declarationIdsByKey = new Map<string, Set<string>>();
	private readonly referenceIdsByDeclaration = new Map<string, Set<string>>();

	constructor(model: ThemeSemanticModel) {
		this.addModel(model);
	}

	apply(update: ThemeSemanticUpdate): void {
		for (const id of [...update.removedRecordIds, ...update.changedRecordIds]) {
			this.removeDeclaration(id);
			this.removeReference(id);
		}
		const ids = new Set([...update.addedRecordIds, ...update.changedRecordIds]);
		for (const declaration of update.model.declarations) {
			if (ids.has(declaration.id)) this.addDeclaration(declaration);
		}
		for (const reference of update.model.references) {
			if (ids.has(reference.id)) this.addReference(reference);
		}
	}

	getDeclarations(key: string): string[] {
		return [...(this.declarationIdsByKey.get(key) ?? [])].sort();
	}

	resolveModel(model: ThemeSemanticModel): ThemeSemanticModel {
		const resolution = resolveThemeDeclarationsAndReferences(
			model.declarations,
			model.references,
		);
		return { ...model, references: resolution.references };
	}

	getDependents(declarationId: string): string[] {
		const result: string[] = [];
		for (const referenceId of this.referenceIdsByDeclaration.get(
			declarationId,
		) ?? []) {
			const reference = this.references.get(referenceId);
			if (reference) result.push(reference.fromPath);
		}
		return result.sort();
	}

	private addModel(model: ThemeSemanticModel): void {
		for (const declaration of model.declarations)
			this.addDeclaration(declaration);
		for (const reference of model.references) this.addReference(reference);
	}

	private addDeclaration(declaration: ThemeDeclaration): void {
		this.declarations.set(declaration.id, declaration);
		const key = `${declaration.kind}:${declaration.name}`;
		const ids = this.declarationIdsByKey.get(key) ?? new Set<string>();
		ids.add(declaration.id);
		this.declarationIdsByKey.set(key, ids);
	}

	private removeDeclaration(id: string): void {
		const declaration = this.declarations.get(id);
		if (!declaration) return;
		this.declarations.delete(id);
		const key = `${declaration.kind}:${declaration.name}`;
		const ids = this.declarationIdsByKey.get(key);
		ids?.delete(id);
		if (ids?.size === 0) this.declarationIdsByKey.delete(key);
	}

	private addReference(reference: ThemeReference): void {
		this.references.set(reference.id, reference);
		if (!reference.resolvedDeclarationId) return;
		const ids =
			this.referenceIdsByDeclaration.get(reference.resolvedDeclarationId) ??
			new Set<string>();
		ids.add(reference.id);
		this.referenceIdsByDeclaration.set(reference.resolvedDeclarationId, ids);
	}

	private removeReference(id: string): void {
		const reference = this.references.get(id);
		if (!reference) return;
		this.references.delete(id);
		if (!reference.resolvedDeclarationId) return;
		const ids = this.referenceIdsByDeclaration.get(
			reference.resolvedDeclarationId,
		);
		ids?.delete(id);
		if (ids?.size === 0)
			this.referenceIdsByDeclaration.delete(reference.resolvedDeclarationId);
	}
}
