import type { Diagnostic, SourceSpan } from "@nazare/core";
import type { ProductKey } from "./canonical-key.js";
import type { Product, ProductDefinition } from "./product.js";

export type ComputationPriority = "interactive" | "background";

export type ComputationContext = {
	readonly signal: AbortSignal;
	readonly priority: ComputationPriority;
	get<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
	): Promise<Result>;
	input<Result>(key: string): Promise<Result>;
};

export type ComputationUncertainty = {
	code: string;
	message: string;
	span?: SourceSpan;
};

export type ComputationMetadata = {
	diagnostics: readonly Diagnostic[];
	uncertainty: readonly ComputationUncertainty[];
};

/** Canonical persistent representation, separate from a computation's result. */
export type ComputationCodec<
	Result,
	Snapshot extends ProductKey = ProductKey,
> = {
	encode(result: Result): Snapshot;
	decode(snapshot: Snapshot): Result;
};

export type Computation<
	Key extends ProductKey,
	Result,
	Snapshot extends ProductKey = ProductKey,
> = ProductDefinition<Key, Result> & {
	compute(context: ComputationContext, key: Key): Promise<Result>;
	cache?: ComputationCodec<Result, Snapshot>;
	diagnostics?(result: Result): readonly Diagnostic[];
	uncertainty?(result: Result): readonly ComputationUncertainty[];
};

export function defineComputation<
	Key extends ProductKey,
	Result,
	Snapshot extends ProductKey = ProductKey,
>(
	definition: ProductDefinition<Key, Result>,
	compute: Computation<Key, Result, Snapshot>["compute"],
	options: {
		cache?: ComputationCodec<Result, Snapshot>;
		diagnostics?(result: Result): readonly Diagnostic[];
		uncertainty?(result: Result): readonly ComputationUncertainty[];
	} = {},
): Computation<Key, Result, Snapshot> {
	return Object.freeze({ ...definition, compute, ...options });
}

export type ProductKeySnapshot = {
	kind: "product-key-snapshot";
	version: 1;
	value: ProductKeySnapshotValue;
};

type ProductKeySnapshotValue =
	| { kind: "null" }
	| { kind: "boolean"; value: boolean }
	| { kind: "number"; value: number | "-0" }
	| { kind: "string"; value: string }
	| {
			kind: "array";
			extensible: boolean;
			length: { value: number; writable: boolean };
			properties: readonly ProductKeySnapshotProperty[];
	  }
	| {
			kind: "object";
			prototype: "object" | "null";
			extensible: boolean;
			properties: readonly ProductKeySnapshotProperty[];
	  };

type ProductKeySnapshotProperty = {
	key: string;
	enumerable: boolean;
	configurable: boolean;
	writable: boolean;
	value: ProductKeySnapshotValue;
};

/**
 * Cache a ProductKey result through an explicit runtime-shape snapshot.
 *
 * Product keys identify products; their snapshot is independent persistence data.
 * The codec preserves supported plain/null-prototype object and array descriptors,
 * extensibility, and negative zero. Accessors, symbols, functions, exotic
 * prototypes, cycles, and non-finite numbers are rejected before cache writes.
 */
export function productKeyCodec<Result extends ProductKey>(): ComputationCodec<
	Result,
	ProductKeySnapshot
> {
	return {
		encode(result) {
			return {
				kind: "product-key-snapshot",
				version: 1,
				value: encodeProductKeySnapshotValue(result, new WeakSet<object>()),
			};
		},
		decode(snapshot) {
			if (snapshot.kind !== "product-key-snapshot" || snapshot.version !== 1) {
				throw new TypeError("Invalid ProductKey cache snapshot");
			}
			return decodeProductKeySnapshotValue(snapshot.value) as Result;
		},
	};
}

/** Cache an optional ProductKey through an explicit undefined snapshot tag. */
export function optionalProductKeyCodec<
	Result extends ProductKey,
>(): ComputationCodec<Result | undefined> {
	const valueCodec = productKeyCodec<Result>();
	return {
		encode(result): ProductKey {
			return result === undefined
				? { kind: "undefined" }
				: { kind: "value", value: valueCodec.encode(result) };
		},
		decode(snapshot) {
			if (!isSnapshotRecord(snapshot) || typeof snapshot.kind !== "string") {
				throw new TypeError("Invalid optional ProductKey cache snapshot");
			}
			if (snapshot.kind === "undefined" && Object.keys(snapshot).length === 1) {
				return undefined;
			}
			if (
				snapshot.kind === "value" &&
				Object.keys(snapshot).length === 2 &&
				"value" in snapshot
			) {
				return valueCodec.decode(snapshot.value as ProductKeySnapshot);
			}
			throw new TypeError("Invalid optional ProductKey cache snapshot");
		},
	};
}

function encodeProductKeySnapshotValue(
	value: unknown,
	ancestors: WeakSet<object>,
): ProductKeySnapshotValue {
	if (value === null) return { kind: "null" };
	switch (typeof value) {
		case "boolean":
			return { kind: "boolean", value };
		case "number":
			if (!Number.isFinite(value)) {
				throw new TypeError("Product key numbers must be finite");
			}
			return { kind: "number", value: Object.is(value, -0) ? "-0" : value };
		case "string":
			return { kind: "string", value };
		case "object":
			return encodeObjectSnapshot(value, ancestors);
		default:
			throw new TypeError(
				"Product key values must be null, booleans, finite numbers, strings, arrays, or plain objects",
			);
	}
}

function encodeObjectSnapshot(
	value: object,
	ancestors: WeakSet<object>,
): ProductKeySnapshotValue {
	if (ancestors.has(value)) {
		throw new TypeError("Product key values must not contain cycles");
	}
	ancestors.add(value);
	try {
		if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
			throw new TypeError("Product key values must not have symbol properties");
		}
		if (Array.isArray(value)) {
			if (Object.getPrototypeOf(value) !== Array.prototype) {
				throw new TypeError("Product key arrays must use Array.prototype");
			}
			const length = Object.getOwnPropertyDescriptor(value, "length");
			if (
				!length ||
				!("value" in length) ||
				typeof length.value !== "number" ||
				!Number.isSafeInteger(length.value) ||
				length.value < 0 ||
				length.enumerable ||
				length.configurable
			) {
				throw new TypeError("Product key arrays must have a standard length");
			}
			return {
				kind: "array",
				extensible: Object.isExtensible(value),
				length: { value: length.value, writable: length.writable ?? false },
				properties: encodeProperties(value, ancestors, new Set(["length"])),
			};
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(
				"Product key objects must be plain objects or null-prototype objects",
			);
		}
		return {
			kind: "object",
			prototype: prototype === null ? "null" : "object",
			extensible: Object.isExtensible(value),
			properties: encodeProperties(value, ancestors),
		};
	} finally {
		ancestors.delete(value);
	}
}

function encodeProperties(
	value: object,
	ancestors: WeakSet<object>,
	excluded = new Set<string>(),
): ProductKeySnapshotProperty[] {
	return Object.getOwnPropertyNames(value)
		.filter((key) => !excluded.has(key))
		.map((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor)) {
				throw new TypeError(
					"Product key values must have only data properties; accessors cannot be cached",
				);
			}
			return {
				key,
				enumerable: descriptor.enumerable ?? false,
				configurable: descriptor.configurable ?? false,
				writable: descriptor.writable ?? false,
				value: encodeProductKeySnapshotValue(descriptor.value, ancestors),
			};
		});
}

function decodeProductKeySnapshotValue(value: unknown): ProductKey {
	if (!isSnapshotRecord(value) || typeof value.kind !== "string") {
		throw new TypeError("Invalid ProductKey cache snapshot");
	}
	switch (value.kind) {
		case "null":
			if (hasOnlyKeys(value, ["kind"])) return null;
			break;
		case "boolean":
			if (
				hasOnlyKeys(value, ["kind", "value"]) &&
				typeof value.value === "boolean"
			) {
				return value.value;
			}
			break;
		case "number":
			if (
				hasOnlyKeys(value, ["kind", "value"]) &&
				(typeof value.value === "number" || value.value === "-0") &&
				(value.value === "-0" || Number.isFinite(value.value))
			) {
				return value.value === "-0" ? -0 : value.value;
			}
			break;
		case "string":
			if (
				hasOnlyKeys(value, ["kind", "value"]) &&
				typeof value.value === "string"
			) {
				return value.value;
			}
			break;
		case "object":
			return decodeObjectSnapshot(value);
		case "array":
			return decodeArraySnapshot(value);
	}
	throw new TypeError("Invalid ProductKey cache snapshot");
}

function decodeObjectSnapshot(value: Record<string, unknown>): ProductKey {
	if (
		!hasOnlyKeys(value, ["kind", "prototype", "extensible", "properties"]) ||
		(value.prototype !== "object" && value.prototype !== "null") ||
		typeof value.extensible !== "boolean" ||
		!Array.isArray(value.properties)
	) {
		throw new TypeError("Invalid ProductKey object cache snapshot");
	}
	const result = Object.create(
		value.prototype === "null" ? null : Object.prototype,
	) as Record<string, ProductKey>;
	defineSnapshotProperties(result, value.properties);
	if (!value.extensible) Object.preventExtensions(result);
	return result;
}

function decodeArraySnapshot(value: Record<string, unknown>): ProductKey {
	if (
		!hasOnlyKeys(value, ["kind", "extensible", "length", "properties"]) ||
		typeof value.extensible !== "boolean" ||
		!isSnapshotRecord(value.length) ||
		!hasOnlyKeys(value.length, ["value", "writable"]) ||
		typeof value.length.value !== "number" ||
		!Number.isSafeInteger(value.length.value) ||
		value.length.value < 0 ||
		typeof value.length.writable !== "boolean" ||
		!Array.isArray(value.properties)
	) {
		throw new TypeError("Invalid ProductKey array cache snapshot");
	}
	const result: ProductKey[] = [];
	defineSnapshotProperties(result, value.properties);
	Object.defineProperty(result, "length", {
		value: value.length.value,
		writable: value.length.writable,
		enumerable: false,
		configurable: false,
	});
	if (!value.extensible) Object.preventExtensions(result);
	return result;
}

function defineSnapshotProperties(
	target: object,
	properties: readonly unknown[],
): void {
	const keys = new Set<string>();
	for (const property of properties) {
		if (
			!isSnapshotRecord(property) ||
			!hasOnlyKeys(property, [
				"key",
				"enumerable",
				"configurable",
				"writable",
				"value",
			]) ||
			typeof property.key !== "string" ||
			typeof property.enumerable !== "boolean" ||
			typeof property.configurable !== "boolean" ||
			typeof property.writable !== "boolean" ||
			keys.has(property.key)
		) {
			throw new TypeError("Invalid ProductKey property cache snapshot");
		}
		keys.add(property.key);
		Object.defineProperty(target, property.key, {
			value: decodeProductKeySnapshotValue(property.value),
			enumerable: property.enumerable,
			configurable: property.configurable,
			writable: property.writable,
		});
	}
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function isSnapshotRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
