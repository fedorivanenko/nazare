import { createHash } from "node:crypto";

const frozenSerializationCache = new WeakMap<object, string>();
const deeplyFrozenProductKeys = new WeakSet<object>();

export type ProductKey =
	| null
	| boolean
	| number
	| string
	| readonly ProductKey[]
	| { readonly [key: string]: ProductKey };

/** Deterministic, type-preserving serialization for product cache keys. */
export function canonicalProductKey(value: ProductKey): string {
	return serialize(value, new WeakSet<object>());
}

export function fingerprintProductKey(value: ProductKey): string {
	return createHash("sha256").update(canonicalProductKey(value)).digest("hex");
}

function serialize(value: ProductKey, ancestors: WeakSet<object>): string {
	if (value === null) return "null";

	switch (typeof value) {
		case "boolean":
			return value ? "bool:true" : "bool:false";
		case "number":
			if (!Number.isFinite(value)) {
				throw new TypeError("Product key numbers must be finite");
			}
			return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
		case "string":
			return `string:${JSON.stringify(value)}`;
		case "object":
			return serializeObject(value, ancestors);
		default:
			throw new TypeError(
				"Product keys must be null, booleans, finite numbers, strings, arrays, or plain objects",
			);
	}
}

function serializeObject(
	value: readonly ProductKey[] | { readonly [key: string]: ProductKey },
	ancestors: WeakSet<object>,
): string {
	const cached = frozenSerializationCache.get(value);
	if (cached !== undefined) return cached;
	if (ancestors.has(value)) {
		throw new TypeError("Product keys must not contain cycles");
	}
	ancestors.add(value);

	try {
		let serialized: string;
		if (Array.isArray(value)) {
			assertDenseDataArray(value);
			serialized = `array:[${value
				.map((item) => serialize(item, ancestors))
				.join(",")}]`;
		} else {
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new TypeError(
					"Product key objects must be plain objects or null-prototype objects",
				);
			}

			const entries = dataEntries(
				value as { readonly [key: string]: ProductKey },
			);
			serialized = `object:{${entries
				.sort(([left], [right]) => left.localeCompare(right))
				.map(
					([key, item]) =>
						`${JSON.stringify(key)}:${serialize(item, ancestors)}`,
				)
				.join(",")}}`;
		}
		if (isDeeplyFrozenProductKey(value)) {
			frozenSerializationCache.set(value, serialized);
		}
		return serialized;
	} finally {
		ancestors.delete(value);
	}
}

function isDeeplyFrozenProductKey(value: object): boolean {
	if (deeplyFrozenProductKeys.has(value)) return true;
	if (!Object.isFrozen(value)) return false;
	for (const item of Object.values(value) as unknown[]) {
		if (
			typeof item === "object" &&
			item !== null &&
			!isDeeplyFrozenProductKey(item)
		) {
			return false;
		}
	}
	deeplyFrozenProductKeys.add(value);
	return true;
}

function assertDenseDataArray(value: readonly ProductKey[]): void {
	const keys = Reflect.ownKeys(value);
	const indexKeys = keys.filter(
		(key): key is string => typeof key === "string" && key !== "length",
	);
	if (keys.some((key) => typeof key === "symbol")) {
		throw new TypeError("Product key arrays must not have symbol properties");
	}
	if (indexKeys.length !== value.length) {
		throw new TypeError(
			"Product key arrays must be dense and have no extra properties",
		);
	}
	for (const key of indexKeys) {
		const index = Number(key);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (
			!Number.isSafeInteger(index) ||
			index < 0 ||
			String(index) !== key ||
			index >= value.length ||
			!isEnumerableDataDescriptor(descriptor)
		) {
			throw new TypeError(
				"Product key arrays must be dense data arrays with no extra properties",
			);
		}
	}
}

function dataEntries(value: {
	readonly [key: string]: ProductKey;
}): [string, ProductKey][] {
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key === "symbol")) {
		throw new TypeError("Product key objects must not have symbol properties");
	}
	return keys.map((key) => {
		if (typeof key !== "string") {
			throw new TypeError(
				"Product key objects must not have symbol properties",
			);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!isEnumerableDataDescriptor(descriptor)) {
			throw new TypeError(
				"Product key objects must have only enumerable data properties",
			);
		}
		return [key, descriptor.value as ProductKey];
	});
}

function isEnumerableDataDescriptor(
	descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
	return (
		!!descriptor && descriptor.enumerable === true && "value" in descriptor
	);
}
