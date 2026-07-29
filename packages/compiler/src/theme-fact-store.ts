import { compareCanonicalStrings } from "./canonical-order.js";
import type { ThemeFact } from "./theme-facts.js";

/** Mutable per-file fact buckets used by incremental workspace sessions. */
export class ThemeFactStore {
	private readonly buckets = new Map<string, ThemeFact[]>();
	private cachedFiles: string[] | undefined;
	private cachedFacts: ThemeFact[] | undefined;

	constructor(facts: ThemeFact[] = []) {
		for (const fact of facts) {
			const path = themeFactSourcePath(fact);
			const bucket = this.buckets.get(path);
			if (bucket) bucket.push(fact);
			else this.buckets.set(path, [fact]);
		}
	}

	replaceFile(path: string, facts: ThemeFact[]): void {
		for (const fact of facts) {
			const factPath = themeFactSourcePath(fact);
			if (factPath !== path) {
				throw new Error(
					`Cannot store fact for ${factPath} in source bucket ${path}`,
				);
			}
		}
		if (facts.length === 0) this.buckets.delete(path);
		else this.buckets.set(path, [...facts]);
		this.invalidateCaches();
	}

	removeFile(path: string): void {
		if (!this.buckets.delete(path)) return;
		this.invalidateCaches();
	}

	getFile(path: string): ThemeFact[] {
		return [...(this.buckets.get(path) ?? [])];
	}

	files(): string[] {
		this.cachedFiles ??= [...this.buckets.keys()].sort((a, b) =>
			compareCanonicalStrings(a, b),
		);
		return [...this.cachedFiles];
	}

	all(): ThemeFact[] {
		this.cachedFacts ??= this.files().flatMap((path) => {
			const bucket = this.buckets.get(path);
			if (!bucket) {
				throw new Error(`Fact file index references missing bucket ${path}`);
			}
			return bucket;
		});
		return [...this.cachedFacts];
	}

	private invalidateCaches(): void {
		this.cachedFiles = undefined;
		this.cachedFacts = undefined;
	}
}

export function themeFactSourcePath(fact: ThemeFact): string {
	if ("path" in fact) return fact.path;
	if ("fromPath" in fact) return fact.fromPath;
	if ("templatePath" in fact) return fact.templatePath;
	return fact.ownerPath;
}
