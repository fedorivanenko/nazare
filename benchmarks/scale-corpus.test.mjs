import assert from "node:assert/strict";
import test from "node:test";
import { scaleCorpus } from "./scale-corpus.mjs";

test("scales only independently addressable theme entities deterministically", () => {
	const files = [
		{ path: "templates/index.liquid", contents: "template" },
		{ path: "snippets/card.liquid", contents: "snippet" },
		{ path: "sections/main.nz.liquid", contents: "section" },
		{ path: "assets/theme.css", contents: "asset" },
	];

	assert.deepEqual(
		scaleCorpus(files, 2).map((file) => file.path),
		[
			"assets/theme.css",
			"sections/main-benchmark-copy-1.nz.liquid",
			"sections/main.nz.liquid",
			"snippets/card-benchmark-copy-1.liquid",
			"snippets/card.liquid",
			"templates/index.liquid",
		],
	);
	assert.deepEqual(
		files.map((file) => file.path),
		[
			"templates/index.liquid",
			"snippets/card.liquid",
			"sections/main.nz.liquid",
			"assets/theme.css",
		],
	);
});

test("rejects unsafe scale requests and path collisions", () => {
	assert.throws(() => scaleCorpus([], 0), /positive integer/);
	assert.throws(
		() =>
			scaleCorpus(
				[
					{ path: "snippets/card.liquid", contents: "one" },
					{ path: "snippets/card.liquid", contents: "two" },
				],
				2,
			),
		/duplicate paths/,
	);
});
