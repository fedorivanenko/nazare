#!/usr/bin/env node
// Scores requiredness inference against the contracts theme authors declared in
// {% doc %} blocks. Declarations override inference in the graph, which means
// inference quality stops being visible in the output the moment a file is
// documented — this is what keeps it measurable, and what makes an inference
// regression fail rather than pass silently.
//
// Usage:
//   node scripts/check-doc-contract-agreement.mjs [--graph theme=path] [--update]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const baselinePath = join(
	repositoryRoot,
	"notes/doc-contract-agreement.json",
);

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
	main(process.argv.slice(2));
}

function main(args) {
	const options = parseArguments(args);
	const baseline = readBaseline();
	const results = {};
	const failures = [];
	for (const [theme, graphPath] of Object.entries(options.graphs)) {
		const graph = JSON.parse(readFileSync(graphPath, "utf8"));
		const score = scoreGraph(graph);
		results[theme] = score;
		report(theme, score);
		if (options.update) continue;
		failures.push(...compareToBaseline(theme, score, baseline));
	}
	if (options.update) {
		writeBaseline(results);
		console.log(`\nBaseline written to ${baselinePath}`);
		return;
	}
	if (failures.length > 0) {
		console.error(`\n${failures.length} agreement regression(s):`);
		for (const failure of failures) console.error(`  ${failure}`);
		process.exitCode = 1;
		return;
	}
	console.log("\nNo declared-vs-inferred agreement regressions.");
}

export function writeBaseline(themes) {
	writeFileSync(
		baselinePath,
		`${JSON.stringify({ version: 1, themes }, null, "\t")}\n`,
	);
}

/**
 * Agreement may not fall and the harmful disagreement class — the graph calling
 * an input optional that its author declared required — may not grow. Both are
 * ratchets rather than thresholds, so improving inference tightens them.
 */
export function compareToBaseline(theme, score, baseline = readBaseline()) {
	const previous = baseline.themes?.[theme];
	if (!previous) return [];
	const failures = [];
	if (score.agree < previous.agree) {
		failures.push(
			`${theme}: agreement fell from ${previous.agree} to ${score.agree} of ${score.compared}`,
		);
	}
	if (
		score.declaredRequiredButInferredOptional >
		previous.declaredRequiredButInferredOptional
	) {
		failures.push(
			`${theme}: declared-required-but-inferred-optional rose from ${previous.declaredRequiredButInferredOptional} to ${score.declaredRequiredButInferredOptional}`,
		);
	}
	return failures;
}

/**
 * Compares each declared input's requirement against what inference concluded
 * for the same input. Inputs with no declaration are skipped: they have no
 * ground truth to score against.
 */
export function scoreGraph(graph) {
	const score = {
		declared: 0,
		compared: 0,
		agree: 0,
		declaredOptionalButInferredRequired: 0,
		declaredRequiredButInferredOptional: 0,
		declaredRequiredButInferredUnknown: 0,
		other: 0,
	};
	for (const node of graph.nodes) {
		if (node.kind !== "expectedInput" || node.provenance !== "declared") continue;
		score.declared += 1;
		const declared = node.requirement;
		const inferred = node.inferredRequirement;
		if (inferred === undefined) continue;
		score.compared += 1;
		if (declared === inferred) {
			score.agree += 1;
			continue;
		}
		if (declared === "optional" && inferred === "required") {
			score.declaredOptionalButInferredRequired += 1;
		} else if (declared === "required" && inferred === "optional") {
			score.declaredRequiredButInferredOptional += 1;
		} else if (declared === "required" && inferred === "unknown") {
			score.declaredRequiredButInferredUnknown += 1;
		} else {
			score.other += 1;
		}
	}
	return score;
}

export function report(theme, score) {
	const percent =
		score.compared === 0
			? "n/a"
			: `${((100 * score.agree) / score.compared).toFixed(1)}%`;
	console.log(
		`${theme}: ${score.agree}/${score.compared} agree (${percent}) from ${score.declared} declared params`,
	);
	console.log(
		`  declared optional, inferred required: ${score.declaredOptionalButInferredRequired}`,
	);
	console.log(
		`  declared required, inferred optional: ${score.declaredRequiredButInferredOptional}`,
	);
	console.log(
		`  declared required, inferred unknown:  ${score.declaredRequiredButInferredUnknown}`,
	);
	if (score.other > 0) console.log(`  other disagreements: ${score.other}`);
}

export function readBaseline() {
	let raw;
	try {
		raw = readFileSync(baselinePath, "utf8");
	} catch (error) {
		throw new Error(`Unable to read agreement baseline ${baselinePath}`, {
			cause: error,
		});
	}
	return parseBaseline(raw, baselinePath);
}

export function parseBaseline(raw, path = "agreement baseline") {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Invalid JSON in ${path}`, { cause: error });
	}
	if (
		!parsed ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		parsed.version !== 1 ||
		!parsed.themes ||
		typeof parsed.themes !== "object" ||
		Array.isArray(parsed.themes)
	) {
		throw new Error(`${path} must contain version 1 and a themes object`);
	}
	const scoreFields = [
		"declared",
		"compared",
		"agree",
		"declaredOptionalButInferredRequired",
		"declaredRequiredButInferredOptional",
		"declaredRequiredButInferredUnknown",
		"other",
	];
	for (const [theme, score] of Object.entries(parsed.themes)) {
		if (!score || typeof score !== "object" || Array.isArray(score)) {
			throw new Error(`${path} theme ${theme} must contain a score object`);
		}
		for (const field of scoreFields) {
			if (!Number.isSafeInteger(score[field]) || score[field] < 0) {
				throw new Error(
					`${path} theme ${theme} field ${field} must be a non-negative integer`,
				);
			}
		}
	}
	return parsed;
}

function parseArguments(args) {
	const graphs = {};
	let update = false;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--update") {
			update = true;
			continue;
		}
		if (args[index] === "--graph") {
			const value = args[index + 1];
			if (!value?.includes("=")) throw new Error("--graph expects theme=path");
			const separator = value.indexOf("=");
			graphs[value.slice(0, separator)] = resolve(value.slice(separator + 1));
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument ${args[index]}`);
	}
	if (Object.keys(graphs).length === 0) {
		throw new Error(
			"Pass at least one --graph theme=path (produced by `nazare inspect theme . --format json`)",
		);
	}
	return { graphs, update };
}
