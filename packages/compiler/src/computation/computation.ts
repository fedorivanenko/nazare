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

export function productKeyCodec<
	Result extends ProductKey,
>(): ComputationCodec<Result> {
	return {
		encode(result) {
			return result;
		},
		decode(value) {
			return value as Result;
		},
	};
}
