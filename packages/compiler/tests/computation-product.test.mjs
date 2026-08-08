import assert from "node:assert/strict";
import test from "node:test";
import {
	canonicalProductKey,
	defineComputation,
	defineProduct,
} from "../dist/testing.js";

test("canonical product keys ignore object insertion order", () => {
	const left = canonicalProductKey({
		path: "sections/card.liquid",
		options: { strict: true, version: 2 },
	});
	const right = canonicalProductKey({
		options: { version: 2, strict: true },
		path: "sections/card.liquid",
	});

	assert.equal(left, right);
});

test("canonical product keys preserve value types", () => {
	assert.notEqual(canonicalProductKey("1"), canonicalProductKey(1));
	assert.notEqual(canonicalProductKey(0), canonicalProductKey(-0));
	assert.notEqual(canonicalProductKey(["a"]), canonicalProductKey({ 0: "a" }));
});

test("canonical product keys reject unsafe values", () => {
	assert.throws(() => canonicalProductKey(Number.NaN), /must be finite/);
	assert.throws(() => canonicalProductKey(Number.POSITIVE_INFINITY), /finite/);
	assert.throws(() => canonicalProductKey(new Date()), /plain objects/);

	const cyclic = {};
	cyclic.self = cyclic;
	assert.throws(() => canonicalProductKey(cyclic), /must not contain cycles/);
});

test("product identity includes namespace, version, and canonical key", () => {
	const versionOne = defineProduct({
		namespace: "nazare.source",
		id: "parsed-file",
		version: 1,
	});
	const versionTwo = defineProduct({
		namespace: "nazare.source",
		id: "parsed-file",
		version: 2,
	});

	const first = versionOne.product({ package: "theme", path: "card.liquid" });
	const reordered = versionOne.product({
		path: "card.liquid",
		package: "theme",
	});
	const upgraded = versionTwo.product({
		package: "theme",
		path: "card.liquid",
	});

	assert.equal(first.cacheKey, reordered.cacheKey);
	assert.notEqual(first.cacheKey, upgraded.cacheKey);
	assert.ok(Object.isFrozen(first));
});

test("product definitions validate stable identities", () => {
	assert.throws(
		() => defineProduct({ namespace: "Nazare", id: "file", version: 1 }),
		/must match/,
	);
	assert.throws(
		() => defineProduct({ namespace: "nazare", id: "file", version: 0 }),
		/positive safe integer/,
	);
});

test("computation keeps product construction and compute together", async () => {
	const parsedFile = defineProduct({
		namespace: "nazare.source",
		id: "parsed-file",
		version: 1,
	});
	const computation = defineComputation(parsedFile, async (_context, key) => ({
		path: key.path,
	}));
	const product = computation.product({ path: "snippets/card.liquid" });
	const result = await computation.compute(
		{
			priority: "interactive",
			signal: new AbortController().signal,
			get() {
				throw new Error("unexpected dependency");
			},
			input() {
				throw new Error("unexpected input");
			},
		},
		product.key,
	);

	assert.deepEqual(result, { path: "snippets/card.liquid" });
});
