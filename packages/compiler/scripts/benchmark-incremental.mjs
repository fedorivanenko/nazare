#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const BENCHMARK_SCHEMA_VERSION = 1;
const EDIT_VARIANT_COUNT = 2;
const EMPTY_ASSET_CONTENTS = "";
const DEFAULT_CORPUS_PATH = "fixtures/canonical-theme";
const DEFAULT_EDIT_PATH = "snippets/price.liquid";
const DEFAULT_ITERATIONS = 10;
const DEFAULT_WARMUPS = 3;
const DEFAULT_SCALE_FACTORS = [1, 2, 4];
const DEFAULT_MAX_GROWTH_RATIO = 6;
const DEFAULT_GRAPH_PROJECTION = "lazy";
const CLONED_DIRECTORIES = new Set(["blocks", "sections", "snippets"]);
const CONTENT_FILE_PATTERNS = [
	/\.nz\.liquid$/,
	/^sections\/[^/]+\.(json|liquid)$/,
	/^snippets\/[^/]+\.liquid$/,
	/^blocks\/[^/]+\.liquid$/,
	/^templates\/.+\.(json|liquid)$/,
	/^layout\/[^/]+\.liquid$/,
	/^locales\/[^/]+\.json$/,
	/^config\/settings_(schema|data)\.json$/,
];

export async function main(argumentsList = process.argv.slice(2)) {
	const options = parseArguments(argumentsList);
	const compilerUrl = pathToFileURL(
		resolve(options.repositoryRoot, "packages/compiler/dist/index.js"),
	).href;
	const { ThemeProgram } = await import(compilerUrl);
	if (typeof ThemeProgram !== "function") {
		throw new Error(
			`Compiler module ${compilerUrl} does not export ThemeProgram`,
		);
	}
	const result = benchmarkIncrementalUpdates(ThemeProgram, options);
	console.log(JSON.stringify(result, null, 2));
	if (result.results.growthRatio > options.maxGrowthRatio) {
		throw new Error(
			`Incremental edit growth ratio ${result.results.growthRatio.toFixed(2)} exceeds limit ${options.maxGrowthRatio.toFixed(2)}`,
		);
	}
}

export function parseArguments(
	argumentsList,
	repositoryRoot = REPOSITORY_ROOT,
) {
	const options = {
		repositoryRoot,
		corpusPath: DEFAULT_CORPUS_PATH,
		editPath: DEFAULT_EDIT_PATH,
		iterations: DEFAULT_ITERATIONS,
		warmups: DEFAULT_WARMUPS,
		scaleFactors: [...DEFAULT_SCALE_FACTORS],
		maxGrowthRatio: DEFAULT_MAX_GROWTH_RATIO,
		graphProjection: DEFAULT_GRAPH_PROJECTION,
	};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		const value = argumentsList[index + 1];
		if (argument === "--corpus") {
			options.corpusPath = requiredValue(argument, value);
		} else if (argument === "--edit-path") {
			options.editPath = requiredValue(argument, value);
		} else if (argument === "--iterations") {
			options.iterations = positiveInteger(argument, value);
		} else if (argument === "--warmups") {
			options.warmups = nonNegativeInteger(argument, value);
		} else if (argument === "--scales") {
			options.scaleFactors = parseScaleFactors(requiredValue(argument, value));
		} else if (argument === "--max-growth-ratio") {
			options.maxGrowthRatio = positiveNumber(argument, value);
		} else if (argument === "--graph-projection") {
			options.graphProjection = graphProjection(argument, value);
		} else {
			throw new Error(`Unknown argument ${argument}`);
		}
		index += 1;
	}
	return options;
}

function benchmarkIncrementalUpdates(ThemeProgram, options) {
	const corpusRoot = resolve(options.repositoryRoot, options.corpusPath);
	const baseFiles = readCorpusFiles(corpusRoot);
	const editFile = baseFiles.find(({ path }) => path === options.editPath);
	if (!editFile) {
		throw new Error(`Edit target ${options.editPath} is not in ${corpusRoot}`);
	}
	const samples = options.scaleFactors.map((scaleFactor) => {
		const files = scaleCorpus(baseFiles, scaleFactor);
		const coldStart = performance.now();
		const program = new ThemeProgram(files, {
			graphProjection: options.graphProjection,
		});
		const coldMs = performance.now() - coldStart;
		for (let index = 0; index < options.warmups; index += 1) {
			program.updateFile(editVariant(editFile, index));
		}
		const edits = [];
		const telemetry = [];
		for (let index = 0; index < options.iterations; index += 1) {
			const startedAt = performance.now();
			const update = program.updateFile(
				editVariant(editFile, options.warmups + index),
			);
			edits.push(performance.now() - startedAt);
			assertSingleFileEditTelemetry(update.telemetry, options.editPath);
			telemetry.push(update.telemetry);
		}
		return {
			scaleFactor,
			files: files.length,
			coldMs,
			editMs: summarizeNumbers(edits),
			work: summarizeTelemetry(telemetry),
		};
	});
	const smallest = samples[0];
	const largest = samples.at(-1);
	if (!smallest || !largest)
		throw new Error("Benchmark requires scale samples");
	if (smallest.editMs.median === 0) {
		throw new Error("Smallest-scale median is zero; growth ratio is undefined");
	}
	return {
		schemaVersion: BENCHMARK_SCHEMA_VERSION,
		environment: {
			node: process.version,
			platform: process.platform,
			architecture: process.arch,
		},
		methodology: {
			corpusPath: options.corpusPath,
			editPath: options.editPath,
			iterations: options.iterations,
			warmups: options.warmups,
			scaleFactors: options.scaleFactors,
			maxGrowthRatio: options.maxGrowthRatio,
			graphProjection: options.graphProjection,
			inputIoTimed: false,
			assetContentsLoaded: false,
			scaledDirectories: [...CLONED_DIRECTORIES].sort(compareAscii),
		},
		results: {
			samples,
			growthRatio: largest.editMs.median / smallest.editMs.median,
		},
	};
}

export function scaleCorpus(files, scaleFactor) {
	if (!Number.isSafeInteger(scaleFactor) || scaleFactor < 1) {
		throw new Error(`Scale factor must be a positive integer: ${scaleFactor}`);
	}
	const result = files.map((file) => ({ ...file }));
	const paths = new Set(result.map(({ path }) => path));
	if (paths.size !== result.length) {
		throw new Error("Cannot scale a corpus containing duplicate paths");
	}
	const cloneCandidates = files.filter(({ path }) =>
		CLONED_DIRECTORIES.has(path.split("/", 1)[0]),
	);
	for (let copy = 1; copy < scaleFactor; copy += 1) {
		for (const file of cloneCandidates) {
			const path = clonedPath(file.path, copy);
			if (paths.has(path)) {
				throw new Error(`Scaled corpus path collision: ${path}`);
			}
			paths.add(path);
			result.push({ ...file, path });
		}
	}
	return result.sort((left, right) => compareAscii(left.path, right.path));
}

export function summarizeNumbers(values) {
	if (values.length === 0) throw new Error("Cannot summarize an empty sample");
	if (values.some((value) => !Number.isFinite(value) || value < 0)) {
		throw new Error("Samples must contain only finite non-negative numbers");
	}
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 0
			? (sorted[middle - 1] + sorted[middle]) / 2
			: sorted[middle];
	return {
		min: sorted[0],
		median,
		max: sorted[sorted.length - 1],
	};
}

function readCorpusFiles(corpusRoot) {
	const files = [];
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath);
				continue;
			}
			if (!entry.isFile()) continue;
			const path = relative(corpusRoot, absolutePath).split(sep).join("/");
			if (CONTENT_FILE_PATTERNS.some((pattern) => pattern.test(path))) {
				files.push({ path, contents: readFileSync(absolutePath, "utf8") });
			} else if (path.startsWith("assets/")) {
				files.push({ path, contents: EMPTY_ASSET_CONTENTS });
			}
		}
	};
	visit(corpusRoot);
	if (files.length === 0)
		throw new Error(`No theme files found in ${corpusRoot}`);
	return files.sort((left, right) => compareAscii(left.path, right.path));
}

function editVariant(file, sequence) {
	return {
		...file,
		contents: `${file.contents}\n{% comment %} incremental benchmark ${sequence % EDIT_VARIANT_COUNT} {% endcomment %}`,
	};
}

function clonedPath(path, copy) {
	const extension = path.endsWith(".nz.liquid") ? ".nz.liquid" : extname(path);
	const stem = path.slice(0, -extension.length);
	return `${stem}-benchmark-copy-${copy}${extension}`;
}

function assertSingleFileEditTelemetry(telemetry, editPath) {
	if (telemetry.filesParsed !== 1) {
		throw new Error(
			`Single-file edit of ${editPath} parsed ${telemetry.filesParsed} files; expected exactly 1`,
		);
	}
}

function summarizeTelemetry(samples) {
	const keys = [
		"filesParsed",
		"passKeysProcessed",
		"semanticRecordsReplaced",
		"graphRecordsReplaced",
	];
	return Object.fromEntries(
		keys.map((key) => [
			key,
			summarizeNumbers(samples.map((item) => item[key])),
		]),
	);
}

function parseScaleFactors(value) {
	const factors = value
		.split(",")
		.map((item) => positiveInteger("--scales", item));
	if (factors.length < 2)
		throw new Error("--scales expects at least two values");
	if (factors[0] !== 1) throw new Error("--scales must start with 1");
	for (let index = 1; index < factors.length; index += 1) {
		if (factors[index] <= factors[index - 1]) {
			throw new Error("--scales values must be strictly increasing");
		}
	}
	return factors;
}

function requiredValue(argument, value) {
	if (!value || value.startsWith("--"))
		throw new Error(`${argument} expects a value`);
	return value;
}

function positiveInteger(argument, value) {
	const parsed = Number(requiredValue(argument, value));
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${argument} expects a positive integer`);
	}
	return parsed;
}

function nonNegativeInteger(argument, value) {
	const parsed = Number(requiredValue(argument, value));
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`${argument} expects a non-negative integer`);
	}
	return parsed;
}

function graphProjection(argument, value) {
	const parsed = requiredValue(argument, value);
	if (parsed !== "lazy" && parsed !== "eager") {
		throw new Error(`${argument} expects lazy or eager`);
	}
	return parsed;
}

function positiveNumber(argument, value) {
	const parsed = Number(requiredValue(argument, value));
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${argument} expects a positive number`);
	}
	return parsed;
}

function compareAscii(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
