import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

const DEFAULT_FILE_TIMEOUT_MS = 5_000;
const DEFAULT_BATCH_TIMEOUT_MS = 900_000;
const DEFAULT_ROUNDS = 3;
const DEFAULT_WARMUPS = 0;
const DEFAULT_LANGUAGE = "nazare-liquid";
const require = createRequire(import.meta.url);
const shopifyParserVersion =
	require("@shopify/liquid-html-parser/package.json").version;
const treeSitterVersion = require("tree-sitter/package.json").version;

async function main() {
	const options = parseArguments(process.argv.slice(2));
	if (options.files.length === 0) {
		console.error(
			"usage: pnpm benchmark:shopify-parser -- [options] <file> [...]\n" +
				"options: --file-timeout-ms N --batch-timeout-ms N --rounds N --warmups N --language liquid|nazare-liquid",
		);
		process.exitCode = 1;
		return;
	}
	const result = await benchmark(options);
	console.log(JSON.stringify(result, null, 2));
}

async function benchmark({
	files,
	fileTimeoutMs,
	batchTimeoutMs,
	rounds,
	warmups,
	language,
}) {
	const uniqueFiles = [...new Set(files)].sort();
	const corpusHash = createHash("sha256");
	let bytes = 0;
	for (const file of uniqueFiles) {
		const source = readFileSync(file);
		bytes += source.byteLength;
		corpusHash.update(String(source.byteLength));
		corpusHash.update("\0");
		corpusHash.update(source);
	}

	const probe = await probeShopify(uniqueFiles, fileTimeoutMs, language);
	const timedOut = new Set(probe.timeouts.map(({ file }) => file));
	const benchmarkFiles = uniqueFiles.filter((file) => !timedOut.has(file));
	if (benchmarkFiles.length === 0) {
		throw new Error("Every Shopify parser probe timed out");
	}

	const samples = { "tree-sitter": [], shopify: [] };
	for (let round = 0; round < rounds; round += 1) {
		const order =
			round % 2 === 0 ? ["tree-sitter", "shopify"] : ["shopify", "tree-sitter"];
		for (const parser of order) {
			const sample = await runIsolatedSample({
				parser,
				language,
				files: benchmarkFiles,
				warmups,
				timeoutMs: batchTimeoutMs,
			});
			samples[parser].push(sample);
			console.error(
				`${parser} round ${round + 1}/${rounds}: ${sample.ms.toFixed(2)} ms`,
			);
		}
	}

	const treeMedianMs = median(samples["tree-sitter"].map(({ ms }) => ms));
	const shopifyMedianMs = median(samples.shopify.map(({ ms }) => ms));
	const benchmarkBytes = benchmarkFiles.reduce(
		(total, file) => total + Buffer.byteLength(readFileSync(file)),
		0,
	);
	return {
		schemaVersion: 1,
		environment: {
			node: process.version,
			platform: process.platform,
			architecture: process.arch,
		},
		methodology: {
			treeSitter: "parseSourceDocument with CST issues and embedded regions",
			treeSitterVersion,
			shopify:
				'toLiquidHtmlAST with mode "tolerant" and allowUnclosedDocumentNode true',
			shopifyParserVersion,
			inputIoTimed: false,
			isolatedWorkerPerSample: true,
			language,
			rounds,
			warmupsPerSample: warmups,
			fileTimeoutMs,
			batchTimeoutMs,
		},
		corpus: {
			files: uniqueFiles.length,
			bytes,
			contentSha256: corpusHash.digest("hex"),
			benchmarkedFiles: benchmarkFiles.length,
			benchmarkedBytes: benchmarkBytes,
		},
		results: {
			treeSitter: summarize(
				samples["tree-sitter"],
				treeMedianMs,
				benchmarkBytes,
			),
			shopify: summarize(samples.shopify, shopifyMedianMs, benchmarkBytes),
			speedup: shopifyMedianMs / treeMedianMs,
		},
		shopifyProbe: probe,
	};
}

async function runIsolatedSample({
	parser,
	language,
	files,
	warmups,
	timeoutMs,
}) {
	const worker = await BenchmarkWorker.create(parser, language);
	try {
		await worker.request({ action: "prepare", files }, timeoutMs);
		return await worker.request({ action: "run", warmups }, timeoutMs);
	} finally {
		await worker.terminate();
	}
}

async function probeShopify(files, timeoutMs, language) {
	let worker = await BenchmarkWorker.create("shopify", language);
	const completed = [];
	const timeouts = [];
	try {
		for (const [index, file] of files.entries()) {
			try {
				const result = await worker.request(
					{ action: "probe", file },
					timeoutMs,
				);
				completed.push({ file, ...result });
			} catch (error) {
				if (!(error instanceof BenchmarkTimeoutError)) throw error;
				timeouts.push({ file, timeoutMs });
				await worker.terminate();
				worker = await BenchmarkWorker.create("shopify", language);
			}
			if ((index + 1) % 100 === 0 || index + 1 === files.length) {
				console.error(
					`Shopify probe: ${index + 1}/${files.length}, ${timeouts.length} timeout(s)`,
				);
			}
		}
	} finally {
		await worker.terminate();
	}
	return {
		completed: completed.length,
		rejected: completed
			.filter(({ rejected }) => rejected)
			.map(({ file, error }) => ({ file, error })),
		timeouts,
		slowestCompleted: [...completed]
			.sort((left, right) => right.ms - left.ms)
			.slice(0, 10)
			.map(({ file, ms, rejected }) => ({ file, ms, rejected })),
	};
}

class BenchmarkTimeoutError extends Error {}

class BenchmarkWorker {
	static async create(parserKind, language) {
		const instance = new BenchmarkWorker(parserKind, language);
		await instance.ready;
		return instance;
	}

	constructor(parserKind, language) {
		this.nextId = 1;
		this.worker = new Worker(
			new URL("./benchmark-shopify-worker.mjs", import.meta.url),
			{ workerData: { parserKind, language } },
		);
		this.ready = new Promise((resolve, reject) => {
			const onMessage = (message) => {
				if (!message.ready) return;
				this.worker.off("error", reject);
				this.worker.off("message", onMessage);
				resolve();
			};
			this.worker.on("message", onMessage);
			this.worker.once("error", reject);
		});
	}

	request(message, timeoutMs) {
		const id = this.nextId;
		this.nextId += 1;
		return new Promise((resolve, reject) => {
			const onMessage = (response) => {
				if (response.id !== id) return;
				cleanup();
				resolve(response);
			};
			const onError = (error) => {
				cleanup();
				reject(error);
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(
					new BenchmarkTimeoutError(
						`Benchmark operation exceeded ${timeoutMs} ms`,
					),
				);
			}, timeoutMs);
			const cleanup = () => {
				clearTimeout(timer);
				this.worker.off("message", onMessage);
				this.worker.off("error", onError);
			};
			this.worker.on("message", onMessage);
			this.worker.once("error", onError);
			this.worker.postMessage({ ...message, id });
		});
	}

	terminate() {
		return this.worker.terminate();
	}
}

function summarize(samples, medianMs, bytes) {
	return {
		medianMs,
		throughputMegabytesPerSecond: bytes / 1_000_000 / (medianMs / 1_000),
		rejected: samples[0]?.rejected ?? 0,
		samples,
	};
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function parseArguments(arguments_) {
	const parsed = {
		files: [],
		fileTimeoutMs: DEFAULT_FILE_TIMEOUT_MS,
		batchTimeoutMs: DEFAULT_BATCH_TIMEOUT_MS,
		rounds: DEFAULT_ROUNDS,
		warmups: DEFAULT_WARMUPS,
		language: DEFAULT_LANGUAGE,
	};
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--") continue;
		if (!argument?.startsWith("--")) {
			parsed.files.push(argument);
			continue;
		}
		const value = arguments_[index + 1];
		if (value === undefined) throw new Error(`Missing value for ${argument}`);
		index += 1;
		if (argument === "--language") {
			if (value !== "liquid" && value !== "nazare-liquid") {
				throw new Error(`Unsupported source language: ${value}`);
			}
			parsed.language = value;
			continue;
		}
		const number = Number(value);
		if (!Number.isInteger(number) || number < 0) {
			throw new Error(
				`Expected a non-negative integer for ${argument}, received ${value}`,
			);
		}
		if (argument === "--file-timeout-ms") parsed.fileTimeoutMs = number;
		else if (argument === "--batch-timeout-ms") parsed.batchTimeoutMs = number;
		else if (argument === "--rounds") parsed.rounds = number;
		else if (argument === "--warmups") parsed.warmups = number;
		else throw new Error(`Unknown benchmark option: ${argument}`);
	}
	if (
		parsed.fileTimeoutMs === 0 ||
		parsed.batchTimeoutMs === 0 ||
		parsed.rounds === 0
	) {
		throw new Error("Timeouts and measured rounds must be greater than zero");
	}
	return parsed;
}

await main();
