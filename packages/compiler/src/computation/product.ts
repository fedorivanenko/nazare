import { canonicalProductKey, type ProductKey } from "./canonical-key.js";

const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
declare const PRODUCT_RESULT: unique symbol;

export type ProductIdentity = {
	namespace: string;
	id: string;
	version: number;
};

export type Product<Key extends ProductKey, Result> = ProductIdentity & {
	key: Key;
	cacheKey: string;
	readonly [PRODUCT_RESULT]?: (result: Result) => Result;
};

export type ProductDefinition<
	Key extends ProductKey,
	Result,
> = ProductIdentity & {
	product(key: Key): Product<Key, Result>;
};

export function defineProduct<Key extends ProductKey, Result>(
	identity: ProductIdentity,
): ProductDefinition<Key, Result> {
	validateIdentity(identity);
	const stableIdentity = Object.freeze({ ...identity });

	return Object.freeze({
		...stableIdentity,
		product(key: Key): Product<Key, Result> {
			const serializedKey = canonicalProductKey(key);
			return Object.freeze({
				...stableIdentity,
				key,
				cacheKey: `${stableIdentity.namespace}:${stableIdentity.id}@${stableIdentity.version}:${serializedKey}`,
			});
		},
	});
}

function validateIdentity(identity: ProductIdentity): void {
	validateName("namespace", identity.namespace);
	validateName("id", identity.id);
	if (!Number.isSafeInteger(identity.version) || identity.version < 1) {
		throw new TypeError("Product version must be a positive safe integer");
	}
}

function validateName(field: "namespace" | "id", value: string): void {
	if (!PRODUCT_ID_PATTERN.test(value)) {
		throw new TypeError(
			`Product ${field} must match ${PRODUCT_ID_PATTERN.source}`,
		);
	}
}
