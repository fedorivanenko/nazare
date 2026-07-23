import { themeFactSourcePath } from "./theme-fact-store.js";
import type { ThemeFact } from "./theme-facts.js";

export type ThemeFactIndexSnapshot = {
	declarationsByKey: Record<string, string[]>;
	dependentsByKey: Record<string, string[]>;
};

export class ThemeFactIndex {
	private readonly declarationsByKey = new Map<string, Set<string>>();
	private readonly dependentsByKey = new Map<string, Set<string>>();
	private readonly entriesByFile = new Map<
		string,
		Array<{ declaration?: string; dependency?: string }>
	>();

	constructor(facts: ThemeFact[] = []) {
		const byFile = new Map<string, ThemeFact[]>();
		for (const fact of facts) {
			const path = themeFactSourcePath(fact);
			const bucket = byFile.get(path) ?? [];
			bucket.push(fact);
			byFile.set(path, bucket);
		}
		for (const bucket of byFile.values()) this.addFileFacts(bucket);
	}

	replaceFileFacts(path: string, facts: ThemeFact[]): void {
		this.removeFileFacts(path);
		this.addFileFacts(facts);
	}

	getDeclarations(key: string): string[] {
		return [...(this.declarationsByKey.get(key) ?? [])].sort();
	}

	getDependents(key: string): string[] {
		return [...(this.dependentsByKey.get(key) ?? [])].sort();
	}

	dependentsOfFiles(paths: string[]): string[] {
		const result = new Set<string>(paths);
		const pending = [...paths];
		while (pending.length > 0) {
			const path = pending.pop();
			if (!path) continue;
			for (const dependent of this.dependentsForPath(path)) {
				if (result.has(dependent)) continue;
				result.add(dependent);
				pending.push(dependent);
			}
		}
		return [...result].sort();
	}

	private dependentsForPath(path: string): string[] {
		const result = new Set<string>(this.getDependents(path));
		for (const [key, declarations] of this.declarationsByKey) {
			if (!declarations.has(path)) continue;
			for (const dependent of this.getDependents(key)) result.add(dependent);
		}
		return [...result];
	}

	snapshot(): ThemeFactIndexSnapshot {
		return {
			declarationsByKey: mapToRecord(this.declarationsByKey),
			dependentsByKey: mapToRecord(this.dependentsByKey),
		};
	}

	private addFileFacts(facts: ThemeFact[]): void {
		if (facts.length === 0) return;
		const path = themeFactSourcePath(facts[0]);
		const entries: Array<{ declaration?: string; dependency?: string }> = [];
		for (const fact of facts) {
			const declaration = declarationKey(fact);
			const dependency = dependencyKey(fact);
			entries.push({ declaration, dependency });
			if (declaration) add(this.declarationsByKey, declaration, path);
			if (dependency) add(this.dependentsByKey, dependency, path);
		}
		this.entriesByFile.set(path, entries);
	}

	private removeFileFacts(path: string): void {
		const entries = this.entriesByFile.get(path) ?? [];
		for (const entry of entries) {
			if (entry.declaration)
				remove(this.declarationsByKey, entry.declaration, path);
			if (entry.dependency)
				remove(this.dependentsByKey, entry.dependency, path);
		}
		this.entriesByFile.delete(path);
	}
}

function declarationKey(fact: ThemeFact): string | undefined {
	if (fact.kind === "declaresSnippet") return `snippet:${fact.name}`;
	if (fact.kind === "declaresSection") return `section:${fact.name}`;
	if (fact.kind === "declaresComponent") return `component:${fact.path}`;
	return undefined;
}

function dependencyKey(fact: ThemeFact): string | undefined {
	if (fact.kind === "rendersSnippet" && fact.targetName)
		return `snippet:${fact.targetName}`;
	if (fact.kind === "containsSection" && fact.targetName)
		return `section:${fact.targetName}`;
	if (fact.kind === "importsComponent")
		return `component:${normalize(fact.targetPath)}`;
	return undefined;
}

function normalize(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
	const values = map.get(key) ?? new Set<string>();
	values.add(value);
	map.set(key, values);
}

function remove(
	map: Map<string, Set<string>>,
	key: string,
	value: string,
): void {
	const values = map.get(key);
	if (!values) return;
	values.delete(value);
	if (values.size === 0) map.delete(key);
}

function mapToRecord(map: Map<string, Set<string>>): Record<string, string[]> {
	return Object.fromEntries(
		[...map.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, values]) => [key, [...values].sort()]),
	);
}
