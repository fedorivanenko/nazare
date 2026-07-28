import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { main } from "../dist/index.js";

async function run(cwd, ...args) {
	let stdout = "";
	let stderr = "";
	const status = await main(args, {
		cwd,
		output: {
			log: (...values) => {
				stdout += `${values.join(" ")}\n`;
			},
			error: (...values) => {
				stderr += `${values.join(" ")}\n`;
			},
		},
	});
	return { status, stdout, stderr };
}

for (const fixture of [
	{ name: "liquid", file: "input.liquid", args: [], status: 0 },
	{
		name: "nazare",
		file: "input.nz.liquid",
		args: ["--language", "nazare-liquid"],
		status: 0,
	},
	{ name: "malformed", file: "input.liquid", args: [], status: 1 },
]) {
	test(`parser-only CLI preserves the ${fixture.name} JSON contract`, async () => {
		const fixtureRoot = resolve(
			"packages/cli-client/tests/fixtures/source-analysis",
			fixture.name,
		);
		const expected = JSON.parse(
			readFileSync(resolve(fixtureRoot, "expected.json"), "utf8"),
		);
		const result = await run(
			fixtureRoot,
			"analyze",
			fixture.file,
			...fixture.args,
		);
		assert.equal(result.status, fixture.status, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), expected);
	});
}

test("parser-only CLI rejects unsupported options explicitly", async () => {
	const result = await run(process.cwd(), "analyze", "--format", "text", "x");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Unsupported format text/);
});
