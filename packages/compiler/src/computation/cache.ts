import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalProductKey, type ProductKey } from "./canonical-key.js";

const FILESYSTEM_CACHE_VERSION = 4;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** Default LRU capacity; prevents long-lived sessions retaining unbounded results. */
export const DEFAULT_MEMORY_COMPUTATION_CACHE_MAX_ENTRIES = 1_024;

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
	/** Canonical codec snapshot; never a computation's runtime result. */
	snapshot: ProductKey;
	snapshotFingerprint: string;
	productFingerprint: string;
	dependencies: readonly CachedComputationDependency[];
};

export type ComputationCache = {
	read(cacheKey: string): Promise<CachedComputation | undefined>;
	write(cacheKey: string, value: CachedComputation): Promise<void>;
	delete(cacheKey: string): Promise<void>;
};

export function createMemoryComputationCache(
	options: { maxEntries?: number } = {},
): ComputationCache {
	const maxEntries =
		options.maxEntries ?? DEFAULT_MEMORY_COMPUTATION_CACHE_MAX_ENTRIES;
	if (
		maxEntries !== undefined &&
		(!Number.isSafeInteger(maxEntries) || maxEntries < 1)
	) {
		throw new TypeError(
			"Memory computation cache maxEntries must be a positive integer",
		);
	}

	const entries = new Map<string, CachedComputation>();

	return {
		async read(cacheKey) {
			const value = entries.get(cacheKey);
			if (value === undefined) return undefined;
			entries.delete(cacheKey);
			entries.set(cacheKey, value);
			return value;
		},
		async write(cacheKey, value) {
			entries.delete(cacheKey);
			entries.set(cacheKey, value);
			while (entries.size > maxEntries) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) return;
				entries.delete(oldest);
			}
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
				entry: serializeFileSystemEntry(value),
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

function serializeFileSystemEntry(value: CachedComputation): unknown {
	if (
		!isFingerprint(value.snapshotFingerprint) ||
		!isFingerprint(value.productFingerprint) ||
		!Array.isArray(value.dependencies)
	) {
		throw new TypeError("Invalid computation cache entry");
	}
	return {
		snapshot: encodeProductKey(value.snapshot),
		snapshotFingerprint: value.snapshotFingerprint,
		productFingerprint: value.productFingerprint,
		dependencies: value.dependencies.map(encodeCachedDependency),
	};
}

function encodeCachedDependency(value: CachedComputationDependency): unknown {
	if (!isFingerprint(value.fingerprint)) {
		throw new TypeError("Invalid computation cache dependency");
	}
	if (value.kind === "input") {
		if (!value.key) throw new TypeError("Invalid computation cache dependency");
		return { kind: "input", key: value.key, fingerprint: value.fingerprint };
	}
	const { product } = value;
	if (
		value.kind !== "product" ||
		!product.namespace ||
		!product.id ||
		!Number.isSafeInteger(product.version) ||
		product.version < 1 ||
		!product.cacheKey
	) {
		throw new TypeError("Invalid computation cache dependency");
	}
	return {
		kind: "product",
		product: {
			namespace: product.namespace,
			id: product.id,
			version: product.version,
			key: encodeProductKey(product.key),
			cacheKey: product.cacheKey,
		},
		fingerprint: value.fingerprint,
	};
}

function encodeProductKey(value: ProductKey): unknown {
	canonicalProductKey(value);
	return encodeValidatedProductKey(value);
}

function encodeValidatedProductKey(value: ProductKey): unknown {
	if (value === null) return { kind: "null" };
	switch (typeof value) {
		case "boolean":
			return { kind: "boolean", value };
		case "number":
			return Object.is(value, -0)
				? { kind: "negative-zero" }
				: { kind: "number", value };
		case "string":
			return { kind: "string", value };
		case "object":
			if (Array.isArray(value)) {
				return {
					kind: "array",
					items: value.map(encodeValidatedProductKey),
				};
			}
			return {
				kind: "object",
				prototype: Object.getPrototypeOf(value) === null ? "null" : "object",
				entries: Object.keys(value).map((key) => [
					key,
					encodeValidatedProductKey(
						(value as { readonly [key: string]: ProductKey })[key],
					),
				]),
			};
	}
}

function parseFileSystemEntry(value: unknown): CachedComputation | undefined {
	if (!isRecord(value) || value.version !== FILESYSTEM_CACHE_VERSION) {
		return undefined;
	}
	const entry = value.entry;
	if (
		!isRecord(entry) ||
		!isFingerprint(entry.snapshotFingerprint) ||
		!isFingerprint(entry.productFingerprint) ||
		!Array.isArray(entry.dependencies)
	) {
		return undefined;
	}
	const decodedSnapshot = decodeProductKey(entry.snapshot);
	const dependencies = entry.dependencies.map(parseCachedDependency);
	if (decodedSnapshot === undefined || dependencies.some((item) => !item)) {
		return undefined;
	}
	return {
		snapshot: decodedSnapshot,
		snapshotFingerprint: entry.snapshotFingerprint,
		productFingerprint: entry.productFingerprint,
		dependencies: dependencies as CachedComputationDependency[],
	};
}

function parseCachedDependency(
	value: unknown,
): CachedComputationDependency | undefined {
	if (!isRecord(value) || !isFingerprint(value.fingerprint)) return undefined;
	if (value.kind === "input") {
		return typeof value.key === "string" && value.key
			? { kind: "input", key: value.key, fingerprint: value.fingerprint }
			: undefined;
	}
	if (value.kind !== "product" || !isRecord(value.product)) return undefined;
	const { product } = value;
	const { namespace, id, version, cacheKey } = product;
	const key = decodeProductKey(product.key);
	if (
		typeof namespace !== "string" ||
		!namespace ||
		typeof id !== "string" ||
		!id ||
		typeof version !== "number" ||
		!Number.isSafeInteger(version) ||
		version < 1 ||
		key === undefined ||
		typeof cacheKey !== "string" ||
		!cacheKey
	) {
		return undefined;
	}
	return {
		kind: "product",
		product: {
			namespace,
			id,
			version,
			key,
			cacheKey,
		},
		fingerprint: value.fingerprint,
	};
}

function decodeProductKey(value: unknown): ProductKey | undefined {
	if (!isRecord(value) || typeof value.kind !== "string") return undefined;
	let decoded: ProductKey | undefined;
	switch (value.kind) {
		case "null":
			decoded = hasOnlyKeys(value, ["kind"]) ? null : undefined;
			break;
		case "boolean":
			decoded =
				hasOnlyKeys(value, ["kind", "value"]) &&
				typeof value.value === "boolean"
					? value.value
					: undefined;
			break;
		case "number":
			decoded =
				hasOnlyKeys(value, ["kind", "value"]) &&
				typeof value.value === "number" &&
				Number.isFinite(value.value) &&
				!Object.is(value.value, -0)
					? value.value
					: undefined;
			break;
		case "negative-zero":
			decoded = hasOnlyKeys(value, ["kind"]) ? -0 : undefined;
			break;
		case "string":
			decoded =
				hasOnlyKeys(value, ["kind", "value"]) && typeof value.value === "string"
					? value.value
					: undefined;
			break;
		case "array": {
			if (
				!hasOnlyKeys(value, ["kind", "items"]) ||
				!Array.isArray(value.items)
			) {
				return undefined;
			}
			const items = value.items.map(decodeProductKey);
			decoded = items.some((item) => item === undefined)
				? undefined
				: (items as ProductKey[]);
			break;
		}
		case "object":
			decoded = decodeObjectProductKey(value);
			break;
		default:
			return undefined;
	}
	if (decoded === undefined) return undefined;
	try {
		canonicalProductKey(decoded);
		return decoded;
	} catch {
		return undefined;
	}
}

function decodeObjectProductKey(
	value: Record<string, unknown>,
): ProductKey | undefined {
	if (
		!hasOnlyKeys(value, ["kind", "prototype", "entries"]) ||
		(value.prototype !== "object" && value.prototype !== "null") ||
		!Array.isArray(value.entries)
	) {
		return undefined;
	}
	const result = Object.create(
		value.prototype === "null" ? null : Object.prototype,
	) as Record<string, ProductKey>;
	for (const entry of value.entries) {
		if (
			!Array.isArray(entry) ||
			entry.length !== 2 ||
			typeof entry[0] !== "string"
		) {
			return undefined;
		}
		if (Object.hasOwn(result, entry[0])) return undefined;
		const item = decodeProductKey(entry[1]);
		if (item === undefined) return undefined;
		Object.defineProperty(result, entry[0], {
			value: item,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return result;
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	return (
		actual.length === keys.length &&
		actual.every((key, index) => key === [...keys].sort()[index])
	);
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
