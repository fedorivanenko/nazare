import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";
import { toLiquidHtmlAST } from "@shopify/liquid-html-parser";
import {
	createDefaultSourceParserRegistry,
	parseSourceDocument,
} from "../dist/index.js";

if (!parentPort) throw new Error("Benchmark worker requires a parent port");

const parserKind = workerData.parserKind;
if (parserKind !== "tree-sitter" && parserKind !== "shopify") {
	throw new Error(`Unsupported benchmark parser: ${parserKind}`);
}

const registry = createDefaultSourceParserRegistry();
let preparedInputs;

function parse(file, source) {
	if (parserKind === "shopify") {
		toLiquidHtmlAST(source, {
			mode: "tolerant",
			allowUnclosedDocumentNode: true,
		});
		return false;
	}
	const document = parseSourceDocument(
		registry,
		file,
		workerData.language,
		source,
	);
	return document.issues.length > 0;
}

function parseWithOutcome(file, source) {
	try {
		return { rejected: parse(file, source), error: undefined };
	} catch (error) {
		return {
			rejected: true,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function executePreparedInputs() {
	if (!preparedInputs)
		throw new Error("Benchmark worker has not been prepared");
	let rejected = 0;
	for (const { file, source } of preparedInputs) {
		if (parseWithOutcome(file, source).rejected) rejected += 1;
	}
	return rejected;
}

parentPort.on("message", (message) => {
	if (message.action === "probe") {
		global.gc?.();
		const source = readFileSync(message.file, "utf8");
		const startedAt = performance.now();
		const outcome = parseWithOutcome(message.file, source);
		parentPort.postMessage({
			id: message.id,
			ms: performance.now() - startedAt,
			...outcome,
		});
		return;
	}
	if (message.action === "prepare") {
		preparedInputs = message.files.map((file) => ({
			file,
			source: readFileSync(file, "utf8"),
		}));
		parentPort.postMessage({ id: message.id });
		return;
	}
	if (message.action === "run") {
		for (let index = 0; index < message.warmups; index += 1) {
			executePreparedInputs();
		}
		global.gc?.();
		const heapBefore = process.memoryUsage().heapUsed;
		const startedAt = performance.now();
		const rejected = executePreparedInputs();
		parentPort.postMessage({
			id: message.id,
			ms: performance.now() - startedAt,
			rejected,
			heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
		});
		return;
	}
	throw new Error(`Unsupported benchmark worker action: ${message.action}`);
});

parentPort.postMessage({ ready: true });
