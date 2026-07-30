#!/usr/bin/env node
/**
 * Wall-and-CPU benchmark for `nazare inspect theme`, cold and warm.
 *
 * Two things make a number here trustworthy, and both are the point of this
 * script existing:
 *
 * - CPU time, not just wall time. A loaded developer machine inflates wall
 *   time several fold while CPU time stays comparable, so a regression hunt
 *   that reads wall time alone chases ghosts.
 * - Interleaved A/B. Passing --baseline-cli runs both builds back to back per
 *   cell and diffs their JSON, so drift in the machine hits both and any
 *   behavior change shows up as a diff rather than as a mystery speedup.
 *
 * Themes are always benchmarked in a copy under a temporary directory: cold
 * runs delete `.nazare-out`, which must never happen inside somebody's theme.
 */
import { spawnSync } from "node:child_process";
import {
	closeSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { cpus, homedir, loadavg, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scaleCorpus } from "../packages/compiler/scripts/benchmark-incremental.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_CORPUS_PATH = "fixtures/theme-corpus";
const CORPUS_MANIFEST_PATH = "fixtures/theme-graph-corpus.json";
const DEFAULT_SCALES = [1, 4, 16];
const DEFAULT_RUNS = 3;
/**
 * Below this, a cell is mostly process startup and grammar init rather than
 * analysis, so its percentage swings on noise and cannot gate anything.
 */
const MIN_GATED_SECONDS = 1;
const COPY_EXCLUDED = new Set([
	".git",
	".nazare-out",
	"node_modules",
	".DS_Store",
]);
/** Only these are timed as content; assets are copied but never parsed. */
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
	const workspace = mkdtempSync(join(tmpdir(), "nazare-benchmark-"));
	try {
		const report = runBenchmark(options, workspace);
		if (options.json) {
			console.log(JSON.stringify(report, null, 2));
		} else {
			console.log(renderReport(report));
		}
		const failures = [
			// Across releases the graph is meant to change, so a comparison that
			// spans one reports differences without failing on them.
			...(options.allowOutputChange
				? []
				: report.outputMismatches.map(
						(mismatch) =>
							`${mismatch.theme}: graph output differs from baseline at byte ${mismatch.offset}`,
					)),
			...report.coldRegressions.map(
				(regression) =>
					`${regression.theme}: cold ${regression.metric} regressed ${regression.percent.toFixed(1)}% (${regression.baseline.toFixed(2)}s -> ${regression.candidate.toFixed(2)}s), over the ${regression.allowedPercent}% budget`,
			),
		];
		for (const failure of failures) console.error(failure);
		if (failures.length > 0) process.exitCode = 1;
	} finally {
		if (options.keep) {
			console.error(`Kept benchmark workspace ${workspace}`);
		} else {
			rmSync(workspace, { recursive: true, force: true });
		}
	}
}

export function parseArguments(
	argumentsList,
	repositoryRoot = REPOSITORY_ROOT,
) {
	const options = {
		repositoryRoot,
		theme: "fixture",
		scales: [...DEFAULT_SCALES],
		runs: DEFAULT_RUNS,
		cli: join(repositoryRoot, "packages/cli-client/dist/index.js"),
		baselineCli: undefined,
		maxColdRegression: undefined,
		allowOutputChange: false,
		json: false,
		keep: false,
	};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		if (argument === "--json") {
			options.json = true;
			continue;
		}
		if (argument === "--keep") {
			options.keep = true;
			continue;
		}
		if (argument === "--allow-output-change") {
			options.allowOutputChange = true;
			continue;
		}
		const value = argumentsList[index + 1];
		if (argument === "--theme") {
			options.theme = requiredValue(argument, value);
		} else if (argument === "--scales") {
			options.scales = requiredValue(argument, value)
				.split(",")
				.map((item) => positiveInteger("--scales", item));
		} else if (argument === "--runs") {
			options.runs = positiveInteger(argument, value);
		} else if (argument === "--cli") {
			options.cli = resolve(requiredValue(argument, value));
		} else if (argument === "--baseline-cli") {
			options.baselineCli = resolve(requiredValue(argument, value));
		} else if (argument === "--max-cold-regression") {
			options.maxColdRegression = nonNegativeNumber(argument, value);
		} else {
			throw new Error(`Unknown argument ${argument}`);
		}
		index += 1;
	}
	for (const cli of [options.cli, options.baselineCli]) {
		if (cli && !existsSync(cli)) {
			throw new Error(`CLI is not built: ${cli}`);
		}
	}
	if (options.maxColdRegression !== undefined && !options.baselineCli) {
		throw new Error(
			"--max-cold-regression needs --baseline-cli to compare against",
		);
	}
	return options;
}

function runBenchmark(options, workspace) {
	const builds = [
		{ name: "candidate", cli: options.cli },
		...(options.baselineCli
			? [{ name: "baseline", cli: options.baselineCli }]
			: []),
	];
	const themes = prepareThemes(options, workspace);
	const loadBefore = loadavg();
	const cells = [];
	const outputMismatches = [];
	for (const theme of themes) {
		const outputs = Object.fromEntries(
			builds.map((build) => [
				build.name,
				join(workspace, `${fileSafe(theme.label)}.${build.name}.json`),
			]),
		);
		const samples = Object.fromEntries(
			builds.map((build) => [
				build.name,
				{ cold: { wall: [], cpu: [] }, warm: { wall: [], cpu: [] } },
			]),
		);
		// Interleaved per run, and the order flips each run. Measuring one build
		// to completion before starting the other hands whichever went first
		// every bit of drift on a machine that is warming up or quieting down.
		for (let run = 0; run < options.runs; run += 1) {
			const order = run % 2 === 0 ? builds : [...builds].reverse();
			for (const build of order) {
				for (const phase of ["cold", "warm"]) {
					const sample = runPhase(build.cli, theme.directory, {
						cold: phase === "cold",
						outputPath: outputs[build.name],
					});
					samples[build.name][phase].wall.push(sample.wall);
					if (sample.cpu !== undefined) {
						samples[build.name][phase].cpu.push(sample.cpu);
					}
				}
			}
		}
		const measurements = Object.fromEntries(
			builds.map((build) => [
				build.name,
				{
					cold: summarizePhase(samples[build.name].cold, options.runs),
					warm: summarizePhase(samples[build.name].warm, options.runs),
				},
			]),
		);
		if (builds.length === 2) {
			const difference = firstDifference(outputs.baseline, outputs.candidate);
			if (difference) {
				outputMismatches.push({ theme: theme.label, ...difference });
			}
		}
		cells.push({
			theme: theme.label,
			fileCount: theme.fileCount,
			contentFileCount: theme.contentFileCount,
			outputBytes: statSync(outputs.candidate).size,
			measurements,
		});
	}
	return {
		coldRegressions: coldRegressions(cells, options.maxColdRegression),
		environment: {
			node: process.version,
			platform: process.platform,
			architecture: process.arch,
			cores: cpus().length,
			loadAverageBefore: loadBefore,
			loadAverageAfter: loadavg(),
			cpuTimeSource: cpuTimeCommand() ? "/usr/bin/time" : "unavailable",
		},
		methodology: {
			theme: options.theme,
			scales: options.theme === "fixture" ? options.scales : undefined,
			runs: options.runs,
			outputChangeAllowed: options.allowOutputChange,
			builds: builds.map((build) => ({
				name: build.name,
				cli: relative(options.repositoryRoot, build.cli),
			})),
		},
		cells,
		outputMismatches,
	};
}

/** Theme copies to benchmark, each already staged under the workspace. */
function prepareThemes(options, workspace) {
	if (options.theme === "fixture") {
		const baseFiles = readThemeFiles(
			join(options.repositoryRoot, FIXTURE_CORPUS_PATH),
		);
		return options.scales.map((scale) => {
			const directory = join(workspace, `fixture-x${scale}`);
			const files = scaleCorpus(baseFiles, scale);
			for (const file of files) {
				const target = join(directory, ...file.path.split("/"));
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, file.contents);
			}
			return {
				label: `fixture-x${scale}`,
				directory,
				fileCount: files.length,
				contentFileCount: files.filter((file) => isContentPath(file.path))
					.length,
			};
		});
	}
	const root = resolveThemeRoot(options);
	// A path argument names the theme by its directory; the whole path would
	// travel into output file names.
	const label = options.theme.includes(sep)
		? (root.split(sep).at(-1) ?? "theme")
		: options.theme;
	const directory = join(workspace, "theme");
	cpSync(root, directory, {
		recursive: true,
		filter: (source) => !COPY_EXCLUDED.has(source.split(sep).at(-1)),
	});
	const files = readThemeFiles(directory);
	return [
		{
			label,
			directory,
			fileCount: files.length,
			contentFileCount: files.filter((file) => isContentPath(file.path)).length,
		},
	];
}

/**
 * A theme argument is either a path or a slug from the corpus manifest, whose
 * roots live on individual machines rather than in this repository.
 */
function resolveThemeRoot(options) {
	const candidate = resolve(options.theme);
	if (existsSync(candidate)) return candidate;
	const manifest = JSON.parse(
		readFileSync(join(options.repositoryRoot, CORPUS_MANIFEST_PATH), "utf8"),
	);
	const expected = manifest.themes?.[options.theme];
	if (!expected) {
		throw new Error(
			`Unknown theme ${options.theme}; pass a path, "fixture", or one of: ${Object.keys(manifest.themes ?? {}).join(", ")}`,
		);
	}
	const root = expected.repositoryRoot
		? join(options.repositoryRoot, expected.repositoryRoot)
		: process.env[expected.rootEnv] || expandHome(expected.defaultRoot);
	if (!root || !existsSync(root)) {
		throw new Error(
			`Corpus root for ${options.theme} is missing; set ${expected.rootEnv} or pass a path`,
		);
	}
	return root;
}

/**
 * One timed invocation. A cold phase drops the cache first; the warm phase
 * that follows it reuses what the cold run just wrote.
 */
function runPhase(cli, directory, { cold, outputPath }) {
	if (cold) {
		rmSync(join(directory, ".nazare-out"), { recursive: true, force: true });
	}
	return runInspect(cli, directory, outputPath);
}

function summarizePhase(sample, runs) {
	return {
		wallSeconds: summarize(sample.wall),
		cpuSeconds: sample.cpu.length === runs ? summarize(sample.cpu) : undefined,
	};
}

/**
 * `inspect` exits 1 when the theme has findings, which every real theme does,
 * so only a missing graph counts as a failure.
 */
function runInspect(cli, directory, outputPath) {
	const timeCommand = cpuTimeCommand();
	const command = timeCommand ?? process.execPath;
	const commandArguments = timeCommand
		? ["-p", process.execPath, cli, "inspect", "theme", ".", "--format", "json"]
		: [cli, "inspect", "theme", ".", "--format", "json"];
	const outputDescriptor = openSync(outputPath, "w");
	const startedAt = process.hrtime.bigint();
	let result;
	try {
		result = spawnSync(command, commandArguments, {
			cwd: directory,
			encoding: "utf8",
			stdio: ["ignore", outputDescriptor, "pipe"],
		});
	} finally {
		closeSync(outputDescriptor);
	}
	const wall = Number(process.hrtime.bigint() - startedAt) / 1e9;
	if (result.error) throw result.error;
	if (statSync(outputPath).size === 0) {
		throw new Error(
			`inspect produced no graph in ${directory} (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
		);
	}
	return { wall, cpu: parseCpuSeconds(result.stderr) };
}

let cachedTimeCommand;

function cpuTimeCommand() {
	if (cachedTimeCommand === undefined) {
		cachedTimeCommand =
			process.platform !== "win32" && existsSync("/usr/bin/time")
				? "/usr/bin/time"
				: null;
	}
	return cachedTimeCommand;
}

function parseCpuSeconds(stderr) {
	if (!stderr) return undefined;
	const user = /^user\s+([\d.]+)$/m.exec(stderr);
	const system = /^sys\s+([\d.]+)$/m.exec(stderr);
	if (!user || !system) return undefined;
	return Number(user[1]) + Number(system[1]);
}

function firstDifference(baselinePath, candidatePath) {
	const baseline = readFileSync(baselinePath);
	const candidate = readFileSync(candidatePath);
	if (baseline.equals(candidate)) return undefined;
	const limit = Math.min(baseline.length, candidate.length);
	let offset = 0;
	while (offset < limit && baseline[offset] === candidate[offset]) offset += 1;
	const context = 120;
	const from = Math.max(0, offset - context);
	return {
		offset,
		baselineBytes: baseline.length,
		candidateBytes: candidate.length,
		baselineContext: baseline.subarray(from, offset + context).toString("utf8"),
		candidateContext: candidate
			.subarray(from, offset + context)
			.toString("utf8"),
	};
}

function readThemeFiles(root) {
	const files = [];
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (COPY_EXCLUDED.has(entry.name)) continue;
			const absolutePath = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolutePath);
				continue;
			}
			if (!entry.isFile()) continue;
			files.push({
				path: relative(root, absolutePath).split(sep).join("/"),
				contents: readFileSync(absolutePath, "utf8"),
			});
		}
	};
	visit(root);
	if (files.length === 0) throw new Error(`No theme files found in ${root}`);
	return files.sort((left, right) => (left.path < right.path ? -1 : 1));
}

/**
 * Cold-time regressions worth failing a build over.
 *
 * Shared CI runners are noisy, so the budget is a percentage rather than an
 * absolute, the comparison uses the minimum of the runs rather than the median
 * (a contended run inflates the median far more than the floor), CPU time is
 * preferred over wall time whenever the platform reports it, and cells too
 * small to be doing real work are skipped.
 */
function coldRegressions(cells, allowedPercent) {
	if (allowedPercent === undefined) return [];
	const regressions = [];
	for (const cell of cells) {
		const candidate = cell.measurements.candidate?.cold;
		const baseline = cell.measurements.baseline?.cold;
		if (!candidate || !baseline) continue;
		const metric = candidate.cpuSeconds && baseline.cpuSeconds ? "cpu" : "wall";
		const candidateSeconds = (
			metric === "cpu" ? candidate.cpuSeconds : candidate.wallSeconds
		).min;
		const baselineSeconds = (
			metric === "cpu" ? baseline.cpuSeconds : baseline.wallSeconds
		).min;
		if (baselineSeconds < MIN_GATED_SECONDS) continue;
		const percent =
			((candidateSeconds - baselineSeconds) / baselineSeconds) * 100;
		if (percent > allowedPercent) {
			regressions.push({
				theme: cell.theme,
				metric,
				baseline: baselineSeconds,
				candidate: candidateSeconds,
				percent,
				allowedPercent,
			});
		}
	}
	return regressions;
}

/** Labels reach file names, and a path argument carries separators. */
function fileSafe(label) {
	return label.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function isContentPath(path) {
	return CONTENT_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

function summarize(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return {
		min: sorted[0],
		median:
			sorted.length % 2 === 0
				? (sorted[middle - 1] + sorted[middle]) / 2
				: sorted[middle],
		max: sorted[sorted.length - 1],
	};
}

function renderReport(report) {
	const lines = [
		`Node ${report.environment.node} · ${report.environment.platform}/${report.environment.architecture} · ${report.environment.cores} cores`,
		`Load average ${formatLoad(report.environment.loadAverageBefore)} before, ${formatLoad(report.environment.loadAverageAfter)} after · ${report.methodology.runs} runs per cell`,
	];
	if (report.environment.cpuTimeSource === "unavailable") {
		lines.push(
			"CPU time unavailable on this platform; wall time only, so treat small differences as noise.",
		);
	}
	lines.push("");
	const names = report.methodology.builds.map((build) => build.name);
	const comparing = names.includes("baseline");
	const header = ["theme", "files", "output"];
	for (const name of names) header.push(`${name} cold`, `${name} warm`);
	if (comparing) header.push("cold delta", "warm delta");
	const rows = [header];
	for (const cell of report.cells) {
		const row = [
			cell.theme,
			`${cell.fileCount} (${cell.contentFileCount} parsed)`,
			formatBytes(cell.outputBytes),
		];
		for (const name of names) {
			row.push(
				formatTiming(cell.measurements[name].cold),
				formatTiming(cell.measurements[name].warm),
			);
		}
		if (comparing) {
			row.push(
				formatDelta(cell.measurements, "cold"),
				formatDelta(cell.measurements, "warm"),
			);
		}
		rows.push(row);
	}
	lines.push(renderTable(rows));
	const scaling = renderScaling(report, names);
	if (scaling) lines.push("", scaling);
	if (report.outputMismatches.length > 0) {
		lines.push("", "Graph output differs between builds:");
		for (const mismatch of report.outputMismatches) {
			lines.push(
				`- ${mismatch.theme}: first difference at byte ${mismatch.offset} (${mismatch.baselineBytes} vs ${mismatch.candidateBytes} bytes)`,
				`    baseline:  ...${mismatch.baselineContext.replaceAll("\n", "\\n")}`,
				`    candidate: ...${mismatch.candidateContext.replaceAll("\n", "\\n")}`,
			);
		}
	} else if (names.length === 2) {
		lines.push("", "Graph output is byte-identical between builds.");
	}
	return lines.join("\n");
}

/**
 * Cold cost per parsed file across scales. Superlinear analysis is the failure
 * mode this benchmark exists to catch, and a rising per-file cost names it.
 */
function renderScaling(report, names) {
	if (report.cells.length < 2) return undefined;
	const lines = ["Cold cost per parsed file:"];
	for (const name of names) {
		const points = report.cells.map((cell) => {
			const timing = cell.measurements[name].cold;
			const seconds = (timing.cpuSeconds ?? timing.wallSeconds).median;
			return `${cell.theme} ${((seconds / cell.contentFileCount) * 1000).toFixed(1)}ms`;
		});
		lines.push(`  ${name}: ${points.join(" · ")}`);
	}
	return lines.join("\n");
}

/**
 * Minimums, matching the gate: on a contended machine the median moves with
 * the neighbours while the floor stays put.
 */
function formatDelta(measurements, phase) {
	const candidate = measurements.candidate[phase];
	const baseline = measurements.baseline[phase];
	const metric =
		candidate.cpuSeconds && baseline.cpuSeconds ? "cpuSeconds" : "wallSeconds";
	const candidateSeconds = candidate[metric].min;
	const baselineSeconds = baseline[metric].min;
	if (baselineSeconds === 0) return "n/a";
	const percent =
		((candidateSeconds - baselineSeconds) / baselineSeconds) * 100;
	const sign = percent > 0 ? "+" : "";
	return `${sign}${percent.toFixed(1)}%`;
}

function formatTiming(timing) {
	const cpu = timing.cpuSeconds;
	return cpu
		? `${cpu.median.toFixed(2)}s cpu (${timing.wallSeconds.median.toFixed(2)}s wall)`
		: `${timing.wallSeconds.median.toFixed(2)}s wall`;
}

function formatBytes(bytes) {
	return bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
		: `${(bytes / 1024).toFixed(0)}KB`;
}

function formatLoad(values) {
	return values.map((value) => value.toFixed(2)).join("/");
}

function renderTable(rows) {
	const widths = rows[0].map((_, column) =>
		Math.max(...rows.map((row) => row[column].length)),
	);
	return rows
		.map((row, index) => {
			const line = row
				.map((cell, column) => cell.padEnd(widths[column]))
				.join("  ")
				.trimEnd();
			return index === 0
				? `${line}\n${widths.map((width) => "-".repeat(width)).join("  ")}`
				: line;
		})
		.join("\n");
}

function expandHome(path) {
	if (!path) return undefined;
	return path === "~" || path.startsWith("~/")
		? join(homedir(), path.slice(2))
		: resolve(path);
}

function requiredValue(argument, value) {
	if (value === undefined) throw new Error(`${argument} expects a value`);
	return value;
}

function nonNegativeNumber(argument, value) {
	const parsed = Number(requiredValue(argument, value));
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`${argument} expects a non-negative number`);
	}
	return parsed;
}

function positiveInteger(argument, value) {
	const parsed = Number(requiredValue(argument, value));
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${argument} expects a positive integer`);
	}
	return parsed;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
