import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProductKey } from "./canonical-key.js";

const FILESYSTEM_CACHE_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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
	valueFingerprint: string;
	productFingerprint: string;
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

export function createFileSystemComputationCache(options: {
	directory: string;
}): ComputationCache {
	if (!options.directory) {
		throw new TypeError("Computation cache directory is required");
	}

	const pathFor = (cacheKey: string): string => {
		const digest = createHash("sha256").update(cacheKey).digest("hex");
		return join(options.directory, digest.slice(0, 2), `${digest}.json`);
	};

	return {
		async read(cacheKey) {
			const path = pathFor(cacheKey);
			try {
				const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
				const entry = parseFileSystemEntry(parsed);
				if (entry) return entry;
				await removeIfPresent(path);
				return undefined;
			} catch (error) {
				if (isNodeError(error, "ENOENT")) return undefined;
				if (error instanceof SyntaxError) {
					await removeIfPresent(path);
					return undefined;
				}
				throw error;
			}
		},
		async write(cacheKey, value) {
			const path = pathFor(cacheKey);
			await mkdir(dirname(path), { recursive: true });
			const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
			const encoded = JSON.stringify({
				version: FILESYSTEM_CACHE_VERSION,
				entry: value,
			});
			try {
				await writeFile(temporaryPath, encoded, "utf8");
				await rename(temporaryPath, path);
			} catch (error) {
				await removeIfPresent(temporaryPath);
				throw error;
			}
		},
		async delete(cacheKey) {
			await removeIfPresent(pathFor(cacheKey));
		},
	};
}

function parseFileSystemEntry(value: unknown): CachedComputation | undefined {
	if (!isRecord(value) || value.version !== FILESYSTEM_CACHE_VERSION) {
		return undefined;
	}
	const entry = value.entry;
	if (
		!isRecord(entry) ||
		!isProductKey(entry.value) ||
		!isFingerprint(entry.valueFingerprint) ||
		!isFingerprint(entry.productFingerprint) ||
		!Array.isArray(entry.dependencies) ||
		!entry.dependencies.every(isCachedDependency)
	) {
		return undefined;
	}
	return {
		value: entry.value,
		valueFingerprint: entry.valueFingerprint,
		productFingerprint: entry.productFingerprint,
		dependencies: entry.dependencies,
	};
}

function isCachedDependency(
	value: unknown,
): value is CachedComputationDependency {
	if (!isRecord(value) || !isFingerprint(value.fingerprint)) return false;
	if (value.kind === "input")
		return typeof value.key === "string" && !!value.key;
	if (value.kind !== "product" || !isRecord(value.product)) return false;
	return (
		typeof value.product.namespace === "string" &&
		!!value.product.namespace &&
		typeof value.product.id === "string" &&
		!!value.product.id &&
		Number.isSafeInteger(value.product.version) &&
		(value.product.version as number) > 0 &&
		isProductKey(value.product.key) &&
		typeof value.product.cacheKey === "string" &&
		!!value.product.cacheKey
	);
}

function isProductKey(
	value: unknown,
	ancestors = new WeakSet<object>(),
): value is ProductKey {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		return true;
	}
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object" || ancestors.has(value)) return false;
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.every((item) => isProductKey(item, ancestors));
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return false;
		return Object.values(value).every((item) => isProductKey(item, ancestors));
	} finally {
		ancestors.delete(value);
	}
}

function isFingerprint(value: unknown): value is string {
	return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function removeIfPresent(path: string): Promise<void> {
	try {
		await rm(path, { force: true });
	} catch (error) {
		if (!isNodeError(error, "ENOENT")) throw error;
	}
}

function isNodeError(error: unknown, code: string): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}
