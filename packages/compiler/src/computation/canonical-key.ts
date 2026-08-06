import { createHash } from "node:crypto";

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
	if (ancestors.has(value)) {
		throw new TypeError("Product keys must not contain cycles");
	}
	ancestors.add(value);

	try {
		if (Array.isArray(value)) {
			return `array:[${value
				.map((item) => serialize(item, ancestors))
				.join(",")}]`;
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new TypeError(
				"Product key objects must be plain objects or null-prototype objects",
			);
		}

		const record = value as { readonly [key: string]: ProductKey };
		return `object:{${Object.keys(record)
			.sort()
			.map(
				(key) => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`,
			)
			.join(",")}}`;
	} finally {
		ancestors.delete(value);
	}
}
