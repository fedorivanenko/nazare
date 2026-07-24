import assert from "node:assert/strict";
import test from "node:test";
import { parseBaseline } from "./check-doc-contract-agreement.mjs";

const validScore = {
	declared: 1,
	compared: 1,
	agree: 1,
	declaredOptionalButInferredRequired: 0,
	declaredRequiredButInferredOptional: 0,
	declaredRequiredButInferredUnknown: 0,
	other: 0,
};

test("agreement baseline parser accepts complete versioned scores", () => {
	const baseline = parseBaseline(
		JSON.stringify({ version: 1, themes: { example: validScore } }),
		"test baseline",
	);
	assert.deepEqual(baseline.themes.example, validScore);
});

test("agreement baseline parser rejects malformed JSON", () => {
	assert.throws(
		() => parseBaseline("{", "test baseline"),
		/Invalid JSON in test baseline/,
	);
});

test("agreement baseline parser rejects missing score fields", () => {
	assert.throws(
		() =>
			parseBaseline(
				JSON.stringify({
					version: 1,
					themes: { example: { ...validScore, agree: undefined } },
				}),
				"test baseline",
			),
		/test baseline theme example field agree/,
	);
});
