import assert from "node:assert/strict";
import test from "node:test";
import { compareCanonicalStrings } from "../dist/canonical-order.js";

test("canonical string ordering is locale-independent UTF-16 code-unit order", () => {
	const values = ["é", "z", "a", "A", "ä", "a/2", "a/10"];
	assert.deepEqual(values.sort(compareCanonicalStrings), [
		"A",
		"a",
		"a/10",
		"a/2",
		"z",
		"ä",
		"é",
	]);
});
