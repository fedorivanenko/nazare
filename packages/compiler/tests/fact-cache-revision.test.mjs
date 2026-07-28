import assert from "node:assert/strict";
import test from "node:test";
import {
	computeFactCacheRevision,
	renderFactCacheRevisionModule,
} from "../../../scripts/fact-cache-revision.mjs";

const inputs = [
	{ path: "compiler/a.ts", contents: "export const a = 1;" },
	{ path: "source/b.ts", contents: "export const b = 2;" },
];

test("fact-cache revision is canonical and content-addressed", () => {
	const revision = computeFactCacheRevision(inputs);
	assert.equal(computeFactCacheRevision([...inputs].reverse()), revision);
	assert.notEqual(
		computeFactCacheRevision([
			inputs[0],
			{ ...inputs[1], contents: "export const b = 3;" },
		]),
		revision,
	);
	assert.throws(
		() => computeFactCacheRevision([inputs[0], inputs[0]]),
		/Duplicate fact-cache revision input compiler\/a\.ts/,
	);
});

test("generated module accepts only computed revision values", () => {
	const revision = computeFactCacheRevision(inputs);
	assert.match(renderFactCacheRevisionModule(revision), new RegExp(revision));
	assert.throws(
		() => renderFactCacheRevisionModule("manual-cache-version"),
		/Invalid fact-cache revision manual-cache-version/,
	);
});
