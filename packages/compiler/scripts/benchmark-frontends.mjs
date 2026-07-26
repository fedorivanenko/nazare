import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
	createDefaultSourceParserRegistry,
	nazareSyntaxFacts,
	parseSourceDocument,
	SourceFile,
} from "../../source/dist/index.js";
import {
	parseNazareLiquid,
	projectTreeSitterNazareAst,
} from "../dist/index.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const requested = process.argv.slice(2).filter((argument) => argument !== "--");
const paths =
	requested.length > 0
		? requested
		: [
				...filesUnder(join(repository, "packages/compiler/tests/fixtures")),
				...filesUnder(join(repository, "fixtures")),
				...filesUnder(join(repository, "examples")),
			];
const files = paths.map((path) => ({
	path,
	source: readFileSync(path, "utf8"),
}));
if (files.length === 0) throw new Error("No .nz.liquid benchmark files found");

const rounds = Number.parseInt(process.env.NAZARE_BENCH_ITERATIONS ?? "20", 10);
const warmups = Number.parseInt(process.env.NAZARE_BENCH_WARMUPS ?? "5", 10);
const registry = createDefaultSourceParserRegistry();
const cases = {
	legacy: () => {
		for (const file of files) parseNazareLiquid(file.source, file.path);
	},
	treeSitterRaw: () => {
		for (const file of files) {
			const document = parseSourceDocument(
				registry,
				file.path,
				"nazare-liquid",
				file.source,
			);
			nazareSyntaxFacts(document);
		}
	},
	treeSitterHybrid: () => {
		for (const file of files) {
			projectTreeSitterNazareAst(file.source, file.path);
		}
	},
};

for (let round = 0; round < warmups; round += 1) {
	for (const benchmark of Object.values(cases)) benchmark();
}

const totals = Object.fromEntries(Object.keys(cases).map((name) => [name, 0]));
const names = Object.keys(cases);
for (let round = 0; round < rounds; round += 1) {
	// Rotate order so JIT/GC effects do not consistently favor one frontend.
	for (let index = 0; index < names.length; index += 1) {
		const name = names[(index + round) % names.length];
		const started = performance.now();
		cases[name]();
		totals[name] += performance.now() - started;
	}
}

const sourceFiles = files.map(
	(file) => new SourceFile(registry, file.path, "nazare-liquid", file.source),
);
const incrementalStarted = performance.now();
for (let round = 0; round < rounds; round += 1) {
	for (const file of sourceFiles) {
		const end = file.document.source.length;
		file.update(
			round % 2 === 0
				? [{ start: end, end, text: " " }]
				: [{ start: end - 1, end, text: "" }],
		);
		nazareSyntaxFacts(file.document);
	}
}
const incrementalMsPerFile =
	(performance.now() - incrementalStarted) / (rounds * files.length);
const perFile = Object.fromEntries(
	Object.entries(totals).map(([name, total]) => [
		name,
		total / (rounds * files.length),
	]),
);

console.log(
	JSON.stringify(
		{
			environment: {
				node: process.version,
				platform: process.platform,
				architecture: process.arch,
			},
			corpus: {
				files: files.length,
				bytes: files.reduce(
					(total, file) => total + Buffer.byteLength(file.source),
					0,
				),
				rounds,
				warmups,
			},
			millisecondsPerFile: {
				legacy: perFile.legacy,
				treeSitterRaw: perFile.treeSitterRaw,
				treeSitterHybrid: perFile.treeSitterHybrid,
				treeSitterIncremental: incrementalMsPerFile,
			},
			ratios: {
				rawTreeSitterSpeedup: perFile.legacy / perFile.treeSitterRaw,
				incrementalTreeSitterSpeedup: perFile.legacy / incrementalMsPerFile,
				hybridOverhead: perFile.treeSitterHybrid / perFile.legacy,
			},
		},
		null,
		2,
	),
);

function filesUnder(directory) {
	const paths = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) paths.push(...filesUnder(path));
		else if (path.endsWith(".nz.liquid")) paths.push(path);
	}
	return paths;
}
