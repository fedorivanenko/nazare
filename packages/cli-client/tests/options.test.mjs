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
			experimentalPublish: true,
		},
	);
});
