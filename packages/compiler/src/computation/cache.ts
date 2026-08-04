import type { ProductKey } from "./canonical-key.js";

export type CachedInputDependency = {
	kind: "input";
	key: string;
	fingerprint: string;
};

export type CachedProductDependency = {
	kind: "product";
	product: {
		namespace: string;
		id: string;
		version: number;
		key: ProductKey;
		cacheKey: string;
	};
	fingerprint: string;
};

export type CachedComputationDependency =
	| CachedInputDependency
	| CachedProductDependency;

export type CachedComputation = {
	value: ProductKey;
	fingerprint: string;
	dependencies: readonly CachedComputationDependency[];
};

export type ComputationCache = {
	read(cacheKey: string): Promise<CachedComputation | undefined>;
	write(cacheKey: string, value: CachedComputation): Promise<void>;
	delete(cacheKey: string): Promise<void>;
};

export function createMemoryComputationCache(): ComputationCache {
	const entries = new Map<string, CachedComputation>();

	return {
		async read(cacheKey) {
			return entries.get(cacheKey);
		},
		async write(cacheKey, value) {
			entries.set(cacheKey, value);
		},
		async delete(cacheKey) {
			entries.delete(cacheKey);
		},
	};
}
