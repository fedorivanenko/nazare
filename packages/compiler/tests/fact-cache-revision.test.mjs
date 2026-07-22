import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const generator = resolve("scripts/generate-fact-cache-revision.mjs");
const probeFile = resolve("packages/compiler/src/theme-source-facts.ts");
const generatedFile = resolve("packages/compiler/src/fact-cache-revision.ts");
const workspaceFile = resolve("packages/compiler/src/theme-workspace.ts");

const runGenerator = (...args) =>
	execFileSync(process.execPath, [generator, ...args], { encoding: "utf8" });

test("the committed fact cache revision matches the compiler source", () => {
	// A stale revision never fails on its own: the cache serves facts derived by
	// a previous compiler, so a real fix silently looks like a no-op.
	runGenerator("--check");
});

test("editing fact derivation makes the committed revision stale", () => {
	const original = readFileSync(probeFile, "utf8");
	const before = readFileSync(generatedFile, "utf8");
	try {
		writeFileSync(probeFile, `${original}\n// probe\n`);
		assert.throws(
			() => runGenerator("--check"),
			"--check must fail once derivation source has changed",
		);
		runGenerator();
		assert.notEqual(
			readFileSync(generatedFile, "utf8"),
			before,
			"regenerating after a source change must produce a new revision",
		);
	} finally {
		writeFileSync(probeFile, original);
		runGenerator();
	}
	assert.equal(
		readFileSync(generatedFile, "utf8"),
		before,
		"the revision must be a deterministic function of the source",
	);
});

test("the workspace uses the generated revision rather than a literal", () => {
	const source = readFileSync(workspaceFile, "utf8");

	assert.match(
		source,
		/import \{ THEME_FACT_CACHE_REVISION \} from "\.\/fact-cache-revision\.js"/,
	);
	// The hand-maintained constant is what went stale twice; it must not return.
	assert.equal(
		/THEME_FACT_CACHE_REVISION\s*=\s*"/.test(source),
		false,
		"the revision must not be redefined by hand in theme-workspace",
	);
});
