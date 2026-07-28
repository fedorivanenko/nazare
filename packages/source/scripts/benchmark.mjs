import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
	createDefaultSourceParserRegistry,
	SourceFile,
} from "../dist/index.js";

const paths = process.argv.slice(2).filter((path) => path !== "--");
if (paths.length === 0) {
	console.error(
		"usage: node packages/source/scripts/benchmark.mjs <file> [...]",
	);
	process.exitCode = 1;
} else {
	const registry = createDefaultSourceParserRegistry();
	const beforeMemory = process.memoryUsage().heapUsed;
	const coldStart = performance.now();
	const files = paths.map((path) => {
		const source = readFileSync(path, "utf8");
		return new SourceFile(
			registry,
			path,
			path.endsWith(".nz.liquid") ? "nazare-liquid" : "liquid",
			source,
		);
	});
	const coldMs = performance.now() - coldStart;
	const editStart = performance.now();
	for (const file of files) {
		file.update([
			{
				start: file.document.source.length,
				end: file.document.source.length,
				text: " ",
			},
		]);
	}
	const incrementalMs = performance.now() - editStart;
	console.log(
		JSON.stringify(
			{
				files: files.length,
				bytes: files.reduce(
					(total, file) => total + Buffer.byteLength(file.document.source),
					0,
				),
				coldMs,
				incrementalMs,
				heapDeltaBytes: process.memoryUsage().heapUsed - beforeMemory,
			},
			null,
			2,
		),
	);
}
