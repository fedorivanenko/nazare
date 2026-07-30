import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	parseArguments,
	scaffoldTheme,
} from "../../../benchmarks/scaffold-theme.mjs";
import { themeInputPaths } from "../../../fixtures/theme-fixture.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const seed = join(repositoryRoot, "fixtures/canonical-theme");

test("theme scaffold arguments require a safe explicit output", () => {
	assert.throws(() => parseArguments([], repositoryRoot), /--out is required/);
	assert.throws(
		() =>
			parseArguments(["--files", "0", "--out", "/tmp/theme"], repositoryRoot),
		/positive integer/,
	);
	assert.deepEqual(
		parseArguments(["--files", "400", "--out", "/tmp/theme"], repositoryRoot),
		{
			repositoryRoot,
			seed,
			files: 400,
			out: "/tmp/theme",
			force: false,
		},
	);
});

test("theme scaffold creates an exact deterministic compiler input count", () => {
	const workspace = mkdtempSync(join(tmpdir(), "nazare-theme-scaffold-test-"));
	const first = join(workspace, "first");
	const second = join(workspace, "second");
	try {
		const options = { repositoryRoot, seed, files: 80, force: false };
		const firstResult = scaffoldTheme({ ...options, out: first });
		const secondResult = scaffoldTheme({ ...options, out: second });
		assert.equal(firstResult.fileCount, 80);
		assert.deepEqual(firstResult.paths, secondResult.paths);
		assert.equal(themeInputPaths(first).length, 80);
		assert.ok(existsSync(join(first, "snippets/perf-snippet-0000.liquid")));
		assert.ok(existsSync(join(first, "assets/perf-style-0003.css")));
		assert.deepEqual(
			JSON.parse(readFileSync(join(first, "nazare.benchmark.json"), "utf8")),
			{
				version: 1,
				seed: "fixtures/canonical-theme",
				files: 80,
				generatedFiles: 80 - firstResult.seedCount,
			},
		);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
});

test("theme scaffold refuses seed destruction and accidental replacement", () => {
	const workspace = mkdtempSync(
		join(tmpdir(), "nazare-theme-scaffold-safety-"),
	);
	const out = join(workspace, "theme");
	try {
		assert.throws(
			() =>
				scaffoldTheme({
					repositoryRoot,
					seed,
					out: seed,
					files: 80,
					force: true,
				}),
			/must not be the seed theme/,
		);
		scaffoldTheme({ repositoryRoot, seed, out, files: 80, force: false });
		assert.throws(
			() =>
				scaffoldTheme({ repositoryRoot, seed, out, files: 80, force: false }),
			/Output already exists/,
		);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
});
