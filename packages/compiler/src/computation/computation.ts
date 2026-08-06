import type { Diagnostic, SourceSpan } from "@nazare/core";
import { canonicalProductKey, type ProductKey } from "./canonical-key.js";
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

export type ComputationCodec<Result> = {
	encode(result: Result): ProductKey;
	decode(value: ProductKey): Result;
};

export type Computation<Key extends ProductKey, Result> = ProductDefinition<
	Key,
	Result
> & {
	compute(context: ComputationContext, key: Key): Promise<Result>;
	cache?: ComputationCodec<Result>;
	diagnostics?(result: Result): readonly Diagnostic[];
	uncertainty?(result: Result): readonly ComputationUncertainty[];
};

export function defineComputation<Key extends ProductKey, Result>(
	definition: ProductDefinition<Key, Result>,
	compute: Computation<Key, Result>["compute"],
	options: {
		cache?: ComputationCodec<Result>;
		diagnostics?(result: Result): readonly Diagnostic[];
		uncertainty?(result: Result): readonly ComputationUncertainty[];
	} = {},
): Computation<Key, Result> {
	return Object.freeze({ ...definition, compute, ...options });
}

/**
 * Cache results whose concrete runtime value is a {@link ProductKey}, even when
 * the result's TypeScript contract cannot express ProductKey structurally.
 *
 * This intentionally does not JSON-round-trip values: every supported value
 * keeps its exact shape and unsupported values fail before cache writes.
 */
export function productKeyValueCodec<Result>(): ComputationCodec<Result> {
	return {
		encode(result) {
			return assertProductKey(result);
		},
		decode(value) {
			return value as Result;
		},
	};
}

/** Cache an optional ProductKey with an explicit, lossless undefined tag. */
export function optionalProductKeyCodec<
	Result extends ProductKey,
>(): ComputationCodec<Result | undefined> {
	return {
		encode(result): ProductKey {
			if (result === undefined) return { kind: "undefined" };
			return { kind: "value", value: assertProductKey(result) };
		},
		decode(value) {
			if (!isOptionalProductKeyEncoding(value)) {
				throw new TypeError("Invalid optional ProductKey cache value");
			}
			return value.kind === "undefined" ? undefined : (value.value as Result);
		},
	};
}

export function productKeyCodec<
	Result extends ProductKey,
>(): ComputationCodec<Result> {
	return productKeyValueCodec<Result>();
}

function assertProductKey(value: unknown): ProductKey {
	canonicalProductKey(value as ProductKey);
	return value as ProductKey;
}

function isOptionalProductKeyEncoding(
	value: ProductKey,
): value is { kind: "undefined" } | { kind: "value"; value: ProductKey } {
	if (!isRecord(value) || typeof value.kind !== "string") return false;
	if (value.kind === "undefined") return Object.keys(value).length === 1;
	return (
		value.kind === "value" &&
		Object.keys(value).length === 2 &&
		"value" in value
	);
}

function isRecord(
	value: ProductKey,
): value is { readonly [key: string]: ProductKey } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
