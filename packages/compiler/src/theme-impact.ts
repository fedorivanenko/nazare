import type { ThemeImpactSummary, ThemeSemanticModel } from "./theme-facts.js";

export function impactSummary(model: ThemeSemanticModel): ThemeImpactSummary {
	const declarationPathById = new Map(
		model.declarations.map((declaration) => [declaration.id, declaration.path]),
	);
	const dependencies = new Map<string, Set<string>>();
	const dependents = new Map<string, Set<string>>();
	const add = (from: string, to: string | undefined) => {
		if (!to || from === to) return;
		dependencies.set(from, dependencies.get(from) ?? new Set());
		dependencies.get(from)?.add(to);
		dependents.set(to, dependents.get(to) ?? new Set());
		dependents.get(to)?.add(from);
	};
	for (const reference of model.references) {
		add(
			reference.fromPath,
			reference.resolvedDeclarationId
				? declarationPathById.get(reference.resolvedDeclarationId)
				: undefined,
		);
	}
	for (const instance of model.sectionInstances) {
		add(
			instance.templatePath,
			instance.resolvedDeclarationId
				? declarationPathById.get(instance.resolvedDeclarationId)
				: undefined,
		);
	}
	for (const instance of model.blockInstances) {
		add(
			instance.ownerPath,
			instance.resolvedBlockId
				? declarationPathById.get(instance.resolvedBlockId)
				: undefined,
		);
	}
	for (const read of model.metafieldReads) {
		if (read.definitionId) add(read.fromPath, read.definitionId);
	}
	const pageDependencies = new Map(
		[...dependencies].map(([path, values]) => [path, new Set(values)]),
	);
	const domBehaviorBySubject = new Map<
		string,
		Array<
			Extract<
				ThemeSemanticModel["behavior"][number],
				{ subjectKind: "domHook" }
			>
		>
	>();
	for (const behavior of model.behavior) {
		if (behavior.subjectKind !== "domHook") continue;
		const key = `${behavior.hookKind}:${behavior.name}`;
		domBehaviorBySubject.set(key, [
			...(domBehaviorBySubject.get(key) ?? []),
			behavior,
		]);
	}
	for (const records of domBehaviorBySubject.values()) {
		const providers = records.filter(
			(record) =>
				record.operation === "emits" || record.operation === "mutates",
		);
		const consumers = records.filter(
			(record) =>
				record.operation === "selects" || record.operation === "queries",
		);
		for (const consumer of consumers) {
			for (const provider of providers)
				add(consumer.fromPath, provider.fromPath);
		}
	}
	const linkedBehaviorBySubject = new Map<
		string,
		ThemeSemanticModel["behavior"]
	>();
	for (const behavior of model.behavior) {
		if (behavior.subjectKind === "domHook") continue;
		const key = `${behavior.subjectKind}:${behavior.name}`;
		linkedBehaviorBySubject.set(key, [
			...(linkedBehaviorBySubject.get(key) ?? []),
			behavior,
		]);
	}
	for (const records of linkedBehaviorBySubject.values()) {
		const providers = records.filter(
			(record) =>
				record.operation === "defines" || record.operation === "dispatches",
		);
		const consumers = records.filter(
			(record) =>
				record.operation === "reads" ||
				record.operation === "listens" ||
				record.operation === "uses",
		);
		for (const consumer of consumers) {
			for (const provider of providers)
				add(consumer.fromPath, provider.fromPath);
		}
	}
	const affectedPages = new Map<string, Set<string>>();
	for (const page of model.pages) {
		const visited = new Set<string>();
		const stack = [page.path];
		while (stack.length > 0) {
			const path = stack.pop();
			if (!path || visited.has(path)) continue;
			visited.add(path);
			affectedPages.set(path, affectedPages.get(path) ?? new Set());
			affectedPages.get(path)?.add(page.path);
			for (const dependency of pageDependencies.get(path) ?? [])
				stack.push(dependency);
		}
	}
	const declaredFiles = new Set(model.files.map((file) => file.path));
	const entryFiles = new Set([
		...model.pages.map((page) => page.path),
		...model.declarations
			.filter(
				(declaration) =>
					declaration.kind === "layout" || declaration.kind === "locale",
			)
			.map((declaration) => declaration.path),
		...model.files
			.filter(
				(file) =>
					file.fileKind === "settingsSchema" ||
					file.fileKind === "settingsData",
			)
			.map((file) => file.path),
	]);
	const referencedFiles = new Set([...dependents.keys(), ...entryFiles]);
	const hasDynamicSnippetReference = model.references.some(
		(reference) => reference.kind === "rendersSnippet" && !reference.static,
	);
	const unusedCandidates = new Set(
		model.declarations
			.filter(
				(declaration) =>
					declaration.kind === "section" ||
					declaration.kind === "snippet" ||
					declaration.kind === "themeBlock" ||
					declaration.kind === "component",
			)
			.filter(
				(declaration) =>
					!(hasDynamicSnippetReference && declaration.kind === "snippet"),
			)
			.map((declaration) => declaration.path),
	);
	return {
		dependencies: sortedRecord(dependencies),
		dependents: sortedRecord(dependents),
		affectedPages: sortedRecord(affectedPages),
		unusedFiles: [...declaredFiles]
			.filter(
				(path) => unusedCandidates.has(path) && !referencedFiles.has(path),
			)
			.sort((a, b) => a.localeCompare(b)),
	};
}

function sortedRecord(map: Map<string, Set<string>>): Record<string, string[]> {
	return Object.fromEntries(
		[...map.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, values]) => [
				key,
				[...values].sort((a, b) => a.localeCompare(b)),
			]),
	);
}
