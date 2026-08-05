import assert from "node:assert/strict";
import test from "node:test";
import * as compiler from "../dist/index.js";

test("compiler root exposes only direct compile entry points", () => {
	assert.deepEqual(Object.keys(compiler).sort(), [
		"artifactGraphFromAst",
		"buildPlainLiquid",
		"compileArtifact",
		"compileNazareArtifact",
		"compilePlainLiquid",
	]);
});
