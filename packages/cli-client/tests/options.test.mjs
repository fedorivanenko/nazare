import assert from "node:assert/strict";
import test from "node:test";
import { parseCliOptions } from "../dist/options.js";

test("parses unified watch mode independently from command positionals", () => {
	assert.deepEqual(
		parseCliOptions(["theme", "--watch", "--json", "--experimental-publish"]),
		{
			positionals: ["theme"],
			watch: true,
			json: true,
			enabledExperimentalFeatures: ["theme-publication"],
		},
	);
});

test("parses repeatable generic experimental feature flags", () => {
	assert.deepEqual(
		parseCliOptions([
			"--enable-experimental",
			"inspection-server",
			"--enable-experimental=theme-publication",
			"--enable-experimental",
			"inspection-server",
		]),
		{
			positionals: [],
			enabledExperimentalFeatures: ["inspection-server", "theme-publication"],
		},
	);
});

test("rejects a missing generic experimental feature ID", () => {
	assert.throws(
		() => parseCliOptions(["--enable-experimental"]),
		/requires a feature ID/,
	);
});
