// Fixture-driven compiler smoke test. `fixtures/valid` holds small, single-
// feature components that must compile with no error diagnostics; `fixtures/
// invalid` holds components that must produce at least one error. Add a file to
// either folder to extend coverage — no test wiring needed. For exact emitted
// output see emit.test.mjs; this only guards compile/check verdicts.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileNazareArtifact } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "fixtures");

const readFixture = (path) => {
	try {
		return readFileSync(join(fixturesRoot, path), "utf8");
	} catch {
		return undefined;
	}
};

function compileFixture(relPath) {
	const source = readFixture(relPath);
	const result = compileNazareArtifact(source, relPath, {
		readFile: readFixture,
	});
	return result.issues.filter((issue) => issue.severity === "error");
}

const nzLiquid = (dir) =>
	readdirSync(join(fixturesRoot, dir)).filter((name) =>
		name.endsWith(".nz.liquid"),
	);

for (const name of nzLiquid("valid")) {
	test(`fixture valid: ${name} compiles with no errors`, () => {
		const errors = compileFixture(`valid/${name}`);
		assert.deepEqual(
			errors,
			[],
			`unexpected errors:\n${JSON.stringify(errors, null, 2)}`,
		);
	});
}

for (const name of nzLiquid("invalid")) {
	test(`fixture invalid: ${name} reports an error`, () => {
		const errors = compileFixture(`invalid/${name}`);
		assert.ok(errors.length > 0, `expected at least one error for ${name}`);
	});
}
