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
	version: 2;
	root: ProductKeySnapshotValue;
	objects: readonly ProductKeySnapshotObject[];
};

type ProductKeySnapshotValue =
	| { kind: "null" }
	| { kind: "boolean"; value: boolean }
	| { kind: "number"; value: number | "-0" }
	| { kind: "string"; value: string }
	| { kind: "reference"; id: number };

type ProductKeySnapshotObject =
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

type ProductKeySnapshotEncoding = {
	ancestors: WeakSet<object>;
	ids: WeakMap<object, number>;
	objects: ProductKeySnapshotObject[];
};

/**
 * Cache a ProductKey result through an explicit runtime-shape snapshot.
 *
 * Product keys identify products; their snapshot is independent persistence data.
 * The codec preserves supported plain/null-prototype object and array descriptors,
 * extensibility, negative zero, and shared-reference identity. Accessors, symbols,
 * functions, exotic prototypes, cycles, and non-finite numbers are rejected before
 * cache writes.
 */
export function productKeyCodec<Result extends ProductKey>(): ComputationCodec<
	Result,
	ProductKeySnapshot
> {
	return {
		encode(result) {
			const encoding: ProductKeySnapshotEncoding = {
				ancestors: new WeakSet<object>(),
				ids: new WeakMap<object, number>(),
				objects: [],
			};
			return {
				kind: "product-key-snapshot",
				version: 2,
				root: encodeProductKeySnapshotValue(result, encoding),
				objects: encoding.objects,
			};
		},
		decode(snapshot) {
			return decodeProductKeySnapshot(snapshot) as Result;
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
	encoding: ProductKeySnapshotEncoding,
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
			return encodeObjectSnapshot(value, encoding);
		default:
			throw new TypeError(
				"Product key values must be null, booleans, finite numbers, strings, arrays, or plain objects",
			);
	}
}

function encodeObjectSnapshot(
	value: object,
	encoding: ProductKeySnapshotEncoding,
): ProductKeySnapshotValue {
	if (encoding.ancestors.has(value)) {
		throw new TypeError("Product key values must not contain cycles");
	}
	const knownId = encoding.ids.get(value);
	if (knownId !== undefined) return { kind: "reference", id: knownId };

	const id = encoding.objects.length;
	encoding.ids.set(value, id);
	encoding.objects.push({
		kind: "object",
		prototype: "object",
		extensible: true,
		properties: [],
	});
	encoding.ancestors.add(value);
	try {
		if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
			throw new TypeError("Product key values must not have symbol properties");
		}
		let snapshot: ProductKeySnapshotObject;
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
			snapshot = {
				kind: "array",
				extensible: Object.isExtensible(value),
				length: { value: length.value, writable: length.writable ?? false },
				properties: encodeProperties(value, encoding, new Set(["length"])),
			};
		} else {
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError(
					"Product key objects must be plain objects or null-prototype objects",
				);
			}
			snapshot = {
				kind: "object",
				prototype: prototype === null ? "null" : "object",
				extensible: Object.isExtensible(value),
				properties: encodeProperties(value, encoding),
			};
		}
		encoding.objects[id] = snapshot;
		return { kind: "reference", id };
	} finally {
		encoding.ancestors.delete(value);
	}
}

function encodeProperties(
	value: object,
	encoding: ProductKeySnapshotEncoding,
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
				value: encodeProductKeySnapshotValue(descriptor.value, encoding),
			};
		});
}

function decodeProductKeySnapshot(snapshot: ProductKeySnapshot): ProductKey {
	if (
		!isSnapshotRecord(snapshot) ||
		!hasOnlyKeys(snapshot, ["kind", "version", "root", "objects"]) ||
		snapshot.kind !== "product-key-snapshot" ||
		snapshot.version !== 2 ||
		!Array.isArray(snapshot.objects)
	) {
		throw new TypeError("Invalid ProductKey cache snapshot");
	}
	validateSnapshotGraph(snapshot.root, snapshot.objects);
	const objects = snapshot.objects.map(createSnapshotObject);
	for (let id = 0; id < snapshot.objects.length; id++) {
		const value = snapshot.objects[id];
		const target = objects[id];
		defineSnapshotProperties(target, value.properties, objects);
		if (value.kind === "array") {
			Object.defineProperty(target, "length", {
				value: value.length.value,
				writable: value.length.writable,
				enumerable: false,
				configurable: false,
			});
		}
		if (!value.extensible) Object.preventExtensions(target);
	}
	return decodeProductKeySnapshotValue(snapshot.root, objects);
}

function validateSnapshotGraph(
	root: unknown,
	objects: readonly unknown[],
): void {
	const states = new Array<"visiting" | "visited" | undefined>(objects.length);
	const visitValue = (value: unknown): void => {
		if (!isSnapshotRecord(value) || typeof value.kind !== "string") {
			throw new TypeError("Invalid ProductKey cache snapshot");
		}
		switch (value.kind) {
			case "null":
				if (hasOnlyKeys(value, ["kind"])) return;
				break;
			case "boolean":
				if (
					hasOnlyKeys(value, ["kind", "value"]) &&
					typeof value.value === "boolean"
				)
					return;
				break;
			case "number":
				if (
					hasOnlyKeys(value, ["kind", "value"]) &&
					(typeof value.value === "number" || value.value === "-0") &&
					(value.value === "-0" || Number.isFinite(value.value))
				) {
					return;
				}
				break;
			case "string":
				if (
					hasOnlyKeys(value, ["kind", "value"]) &&
					typeof value.value === "string"
				)
					return;
				break;
			case "reference": {
				if (
					!hasOnlyKeys(value, ["kind", "id"]) ||
					typeof value.id !== "number" ||
					!Number.isSafeInteger(value.id) ||
					value.id < 0 ||
					value.id >= objects.length
				) {
					break;
				}
				if (states[value.id] === "visiting") {
					throw new TypeError(
						"Product key cache snapshots must not contain cycles",
					);
				}
				if (states[value.id] === "visited") return;
				states[value.id] = "visiting";
				validateSnapshotObject(objects[value.id], visitValue);
				states[value.id] = "visited";
				return;
			}
		}
		throw new TypeError("Invalid ProductKey cache snapshot");
	};
	visitValue(root);
	for (let id = 0; id < objects.length; id++) {
		if (states[id] !== "visited") {
			throw new TypeError("Invalid ProductKey cache snapshot");
		}
	}
}

function validateSnapshotObject(
	value: unknown,
	visitValue: (value: unknown) => void,
): asserts value is ProductKeySnapshotObject {
	if (!isSnapshotRecord(value) || typeof value.kind !== "string") {
		throw new TypeError("Invalid ProductKey cache snapshot");
	}
	if (value.kind === "object") {
		if (
			!hasOnlyKeys(value, ["kind", "prototype", "extensible", "properties"]) ||
			(value.prototype !== "object" && value.prototype !== "null") ||
			typeof value.extensible !== "boolean" ||
			!Array.isArray(value.properties)
		) {
			throw new TypeError("Invalid ProductKey object cache snapshot");
		}
	} else if (value.kind === "array") {
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
	} else {
		throw new TypeError("Invalid ProductKey cache snapshot");
	}
	validateSnapshotProperties(value.properties, visitValue);
}

function validateSnapshotProperties(
	properties: readonly unknown[],
	visitValue: (value: unknown) => void,
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
		visitValue(property.value);
	}
}

function createSnapshotObject(value: ProductKeySnapshotObject): object {
	if (value.kind === "array") return [];
	return Object.create(value.prototype === "null" ? null : Object.prototype);
}

function decodeProductKeySnapshotValue(
	value: ProductKeySnapshotValue,
	objects: readonly object[],
): ProductKey {
	switch (value.kind) {
		case "null":
			return null;
		case "boolean":
		case "string":
			return value.value;
		case "number":
			return value.value === "-0" ? -0 : value.value;
		case "reference":
			return objects[value.id] as ProductKey;
	}
}

function defineSnapshotProperties(
	target: object,
	properties: readonly ProductKeySnapshotProperty[],
	objects: readonly object[],
): void {
	for (const property of properties) {
		Object.defineProperty(target, property.key, {
			value: decodeProductKeySnapshotValue(property.value, objects),
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
