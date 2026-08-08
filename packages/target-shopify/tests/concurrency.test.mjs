import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "../dist/concurrency.js";

test("bounded product mapping preserves order and limits active work", async () => {
	let active = 0;
	let maximumActive = 0;
	const results = await mapWithConcurrency(
		[1, 2, 3, 4, 5],
		2,
		async (value) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return value * 2;
		},
	);

	assert.deepEqual(results, [2, 4, 6, 8, 10]);
	assert.equal(maximumActive, 2);
});
