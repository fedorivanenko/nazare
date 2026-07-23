import type { ThemeFact } from "./theme-facts.js";

/** Mutable per-file fact buckets used by incremental workspace sessions. */
export class ThemeFactStore {
	private readonly buckets = new Map<string, ThemeFact[]>();

	constructor(facts: ThemeFact[] = []) {
		this.add(facts);
	}

	replaceFile(path: string, facts: ThemeFact[]): void {
		this.buckets.delete(path);
		this.add(facts);
	}

	removeFile(path: string): void {
		this.buckets.delete(path);
	}

	getFile(path: string): ThemeFact[] {
		return [...(this.buckets.get(path) ?? [])];
	}

	files(): string[] {
		return [...this.buckets.keys()].sort((a, b) => a.localeCompare(b));
	}

	all(): ThemeFact[] {
		return this.files().flatMap((path) => this.buckets.get(path) ?? []);
	}

	private add(facts: ThemeFact[]): void {
		for (const fact of facts) {
			const path = factSourcePath(fact);
			const bucket = this.buckets.get(path) ?? [];
			bucket.push(fact);
			this.buckets.set(path, bucket);
		}
	}
}

function factSourcePath(fact: ThemeFact): string {
	if ("path" in fact) return fact.path;
	if ("fromPath" in fact) return fact.fromPath;
	if ("templatePath" in fact) return fact.templatePath;
	return fact.ownerPath;
}
