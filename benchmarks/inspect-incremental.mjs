#!/usr/bin/env node
import process from "node:process";
import { loadThemeFixture } from "../fixtures/theme-fixture.mjs";
import { ShopifyQuerySession } from "../packages/cli-client/dist/shopify-query-session.js";
import { scaleCorpus } from "./scale-corpus.mjs";

const DEFAULT_SCALE = 64;
const DEFAULT_RUNS = 20;
const DEFAULT_MAX_INITIAL_MS = 10_000;
const DEFAULT_MAX_INCREMENTAL_MS = 500;
const EDIT_PATH = "snippets/product-card.liquid";

export async function main(argumentsList = process.argv.slice(2)) {
	const options = parseArguments(argumentsList);
	const files = scaleCorpus(loadThemeFixture(), options.scale);
	const editable = files.find((file) => file.path === EDIT_PATH);
	if (!editable)
		throw new Error(`Incremental benchmark input missing ${EDIT_PATH}`);

	let session;
	let initialInspection;
	const initial = await measure(async () => {
		session = await ShopifyQuerySession.create(files);
		initialInspection = await session.inspection();
	});
	const initialBrokenMetafields =
		initialInspection.summary.brokenMetafieldReadCount;
	const incremental = [];
	for (let run = 0; run < options.runs; run += 1) {
		const metafieldKey = `benchmark_${run}`;
		const hasMetafield = run % 2 === 0;
		const contents = `${editable.contents}\n{% comment %}benchmark-${run}{% endcomment %}${
			hasMetafield
				? `{{ product.metafields.custom.${metafieldKey}.value }}`
				: ""
		}`;
		let inspection;
		incremental.push(
			await measure(async () => {
				await session.updateFile({ path: EDIT_PATH, contents });
				inspection = await session.inspection();
			}),
		);
		const expectedBrokenMetafields =
			initialBrokenMetafields + (hasMetafield ? 1 : 0);
		if (
			inspection.summary.brokenMetafieldReadCount !== expectedBrokenMetafields
		) {
			throw new Error(
				`Incremental inspection returned stale metafield count at run ${run}`,
			);
		}
		const metafields = await session.metafieldIndex({
			ownerType: null,
			namespace: "custom",
		});
		const benchmarkKeys = metafields.records
			.map((record) => record.key)
			.filter((key) => key?.startsWith("benchmark_"));
		if (
			(hasMetafield && !benchmarkKeys.includes(metafieldKey)) ||
			(!hasMetafield && benchmarkKeys.length > 0)
		) {
			throw new Error(
				`Incremental inspection returned stale records at run ${run}`,
			);
		}
	}

	const report = {
		methodology: {
			scale: options.scale,
			runs: options.runs,
			fileCount: files.length,
			editPath: EDIT_PATH,
			initialMeasurement:
				"query-session creation plus complete inspection query",
			incrementalMeasurement:
				"ProjectSession updateFile plus complete inspection query",
		},
		budgets: {
			initialWallMilliseconds: options.maxInitialMs,
			incrementalMedianWallMilliseconds: options.maxIncrementalMs,
		},
		initial,
		incremental: summarize(incremental),
	};

	console.log(
		options.json ? JSON.stringify(report, null, 2) : renderReport(report),
	);
	const failures = [];
	if (initial.wallMilliseconds > options.maxInitialMs) {
		failures.push(
			`initial wall time ${format(initial.wallMilliseconds)}ms exceeds ${options.maxInitialMs}ms`,
		);
	}
	if (report.incremental.wallMilliseconds.median > options.maxIncrementalMs) {
		failures.push(
			`incremental median wall time ${format(report.incremental.wallMilliseconds.median)}ms exceeds ${options.maxIncrementalMs}ms`,
		);
	}
	for (const failure of failures) console.error(failure);
	if (failures.length > 0) process.exitCode = 1;
}

function parseArguments(argumentsList) {
	const options = {
		scale: DEFAULT_SCALE,
		runs: DEFAULT_RUNS,
		maxInitialMs: DEFAULT_MAX_INITIAL_MS,
		maxIncrementalMs: DEFAULT_MAX_INCREMENTAL_MS,
		json: false,
	};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		if (argument === "--json") {
			options.json = true;
			continue;
		}
		const value = argumentsList[index + 1];
		if (value === undefined) throw new Error(`${argument} needs a value`);
		if (argument === "--scale")
			options.scale = positiveInteger(argument, value);
		else if (argument === "--runs")
			options.runs = positiveInteger(argument, value);
		else if (argument === "--max-initial-ms") {
			options.maxInitialMs = positiveNumber(argument, value);
		} else if (argument === "--max-incremental-ms") {
			options.maxIncrementalMs = positiveNumber(argument, value);
		} else throw new Error(`Unknown argument ${argument}`);
		index += 1;
	}
	return options;
}

async function measure(operation) {
	const cpuBefore = process.cpuUsage();
	const wallBefore = process.hrtime.bigint();
	await operation();
	const cpu = process.cpuUsage(cpuBefore);
	return {
		wallMilliseconds: Number(process.hrtime.bigint() - wallBefore) / 1e6,
		cpuMilliseconds: (cpu.user + cpu.system) / 1_000,
	};
}

function summarize(samples) {
	return {
		wallMilliseconds: distribution(
			samples.map((sample) => sample.wallMilliseconds),
		),
		cpuMilliseconds: distribution(
			samples.map((sample) => sample.cpuMilliseconds),
		),
	};
}

function distribution(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return {
		minimum: sorted[0],
		median:
			sorted.length % 2 === 0
				? (sorted[middle - 1] + sorted[middle]) / 2
				: sorted[middle],
		p95: percentile(sorted, 0.95),
		maximum: sorted.at(-1),
	};
}

function percentile(sorted, percentileValue) {
	return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)];
}

function renderReport(report) {
	return [
		`Persistent inspect benchmark: ${report.methodology.fileCount} files (scale ${report.methodology.scale})`,
		`Initial: ${format(report.initial.wallMilliseconds)}ms wall, ${format(report.initial.cpuMilliseconds)}ms CPU (budget ${report.budgets.initialWallMilliseconds}ms)`,
		`Incremental: ${format(report.incremental.wallMilliseconds.median)}ms median, ${format(report.incremental.wallMilliseconds.p95)}ms p95, ${format(report.incremental.wallMilliseconds.maximum)}ms max wall (median budget ${report.budgets.incrementalMedianWallMilliseconds}ms)`,
	].join("\n");
}

function format(value) {
	return value.toFixed(1);
}

function positiveInteger(option, value) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${option} must be a positive integer`);
	}
	return parsed;
}

function positiveNumber(option, value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${option} must be a positive number`);
	}
	return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
