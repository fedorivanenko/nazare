import assert from "node:assert/strict";
import test from "node:test";
import {
	parseArguments,
	scaleCorpus,
	summarizeNumbers,
} from "../scripts/benchmark-incremental.mjs";

test("incremental benchmark arguments expose every default", () => {
	assert.deepEqual(parseArguments([], "/repository"), {
		repositoryRoot: "/repository",
		corpusPath: "fixtures/canonical-theme",
		editPath: "snippets/price.liquid",
		iterations: 10,
		warmups: 3,
		scaleFactors: [1, 2, 4],
		maxGrowthRatio: 6,
	});
});

test("incremental benchmark rejects ambiguous and invalid arguments", () => {
	assert.throws(() => parseArguments(["--iterations"]), /expects a value/);
	assert.throws(
		() => parseArguments(["--iterations", "0"]),
		/positive integer/,
	);
	assert.throws(() => parseArguments(["--warmups", "-1"]), /non-negative/);
	assert.throws(() => parseArguments(["--scales", "2,4"]), /must start with 1/);
	assert.throws(
		() => parseArguments(["--scales", "1,4,2"]),
		/strictly increasing/,
	);
	assert.throws(() => parseArguments(["--unknown", "1"]), /Unknown argument/);
});

test("incremental benchmark scales only graph-bearing theme directories", () => {
	const source = [
		{ path: "snippets/card.liquid", contents: "snippet" },
		{ path: "sections/main.liquid", contents: "section" },
		{ path: "blocks/text.liquid", contents: "block" },
		{ path: "components/card.nz.liquid", contents: "component" },
		{ path: "templates/index.json", contents: "{}" },
	];
	assert.deepEqual(
		scaleCorpus(source, 2).map(({ path }) => path),
		[
			"blocks/text-benchmark-copy-1.liquid",
			"blocks/text.liquid",
			"components/card.nz.liquid",
			"sections/main-benchmark-copy-1.liquid",
			"sections/main.liquid",
			"snippets/card-benchmark-copy-1.liquid",
			"snippets/card.liquid",
			"templates/index.json",
		],
	);
});

test("incremental benchmark rejects generated path collisions", () => {
	assert.throws(
		() =>
			scaleCorpus(
				[
					{ path: "snippets/card.liquid", contents: "original" },
					{
						path: "snippets/card-benchmark-copy-1.liquid",
						contents: "collision",
					},
				],
				2,
			),
		/Scaled corpus path collision/,
	);
});

test("incremental benchmark reports an even-sample median", () => {
	assert.deepEqual(summarizeNumbers([8, 2, 6, 4]), {
		min: 2,
		median: 5,
		max: 8,
	});
	assert.throws(() => summarizeNumbers([]), /empty sample/);
	assert.throws(() => summarizeNumbers([1, Number.NaN]), /finite non-negative/);
	assert.throws(() => summarizeNumbers([-1]), /finite non-negative/);
});
