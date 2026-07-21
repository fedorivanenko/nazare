#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(
	repositoryRoot,
	"notes/theme-graph-production-corpus-golden.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const options = parseArguments(process.argv.slice(2));
const failures = [];

for (const [slug, expected] of Object.entries(manifest.themes)) {
	if (options.only.size > 0 && !options.only.has(slug)) continue;
	try {
		const graph = loadGraph(slug, expected, options);
		checkGraph(slug, graph, expected);
		console.log(
			`PASS ${slug}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.issues.length} issues`,
		);
	} catch (error) {
		failures.push(`${slug}: ${error instanceof Error ? error.message : String(error)}`);
		console.error(`FAIL ${failures.at(-1)}`);
	}
}

if (failures.length > 0) {
	console.error(`\n${failures.length} corpus golden check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nAll production corpus golden queries passed.");
}

function parseArguments(args) {
	const graphPaths = new Map();
	const projectRoots = new Map();
	const only = new Set();
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--graph" || argument === "--project") {
			const value = args[index + 1];
			if (!value?.includes("=")) {
				throw new Error(`${argument} expects theme=path`);
			}
			const separator = value.indexOf("=");
			const target = argument === "--graph" ? graphPaths : projectRoots;
			target.set(value.slice(0, separator), resolve(value.slice(separator + 1)));
			index += 1;
			continue;
		}
		if (argument === "--only") {
			const value = args[index + 1];
			if (!value) throw new Error("--only expects a theme name");
			only.add(value);
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument ${argument}`);
	}
	return { graphPaths, projectRoots, only };
}

function loadGraph(slug, expected, options) {
	const graphPath = options.graphPaths.get(slug);
	if (graphPath) return JSON.parse(readFileSync(graphPath, "utf8"));

	const configuredRoot =
		options.projectRoots.get(slug) ||
		process.env[expected.rootEnv] ||
		expandHome(expected.defaultRoot);
	if (!configuredRoot || !existsSync(configuredRoot)) {
		throw new Error(
			`corpus root missing; set ${expected.rootEnv}, pass --project ${slug}=path, or pass --graph ${slug}=path`,
		);
	}
	const cliPath = join(
		repositoryRoot,
		"packages/cli-client/dist/index.js",
	);
	if (!existsSync(cliPath)) {
		throw new Error("CLI is not built; run pnpm -s build first");
	}
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "nazare-corpus-"));
	const outputPath = join(temporaryDirectory, `${slug}.json`);
	const outputDescriptor = openSync(outputPath, "w");
	try {
		const result = spawnSync(
			process.execPath,
			[cliPath, "inspect", "theme", ".", "--format", "json"],
			{
				cwd: configuredRoot,
				encoding: "utf8",
				stdio: ["ignore", outputDescriptor, "pipe"],
				maxBuffer: 16 * 1024 * 1024,
			},
		);
		closeSync(outputDescriptor);
		const output = readFileSync(outputPath, "utf8");
		if (!output) {
			throw new Error(
				`inspect produced no graph (exit ${result.status}): ${result.stderr.trim()}`,
			);
		}
		return JSON.parse(output);
	} finally {
		try {
			closeSync(outputDescriptor);
		} catch {
			// Descriptor already closed after successful execution.
		}
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function expandHome(path) {
	if (!path) return undefined;
	return path === "~" || path.startsWith("~/")
		? join(homedir(), path.slice(2))
		: resolve(path);
}

function checkGraph(slug, graph, expected) {
	assert(graph.version === 2, `expected graph version 2, got ${graph.version}`);
	for (const collection of ["nodes", "edges", "evidence", "issues"]) {
		assert(Array.isArray(graph[collection]), `missing ${collection} array`);
	}
	for (const [collection, minimum] of Object.entries(expected.minimums)) {
		assert(
			graph[collection].length >= minimum,
			`${collection} count ${graph[collection].length} is below ${minimum}`,
		);
	}

	const nodesById = uniqueIndex(graph.nodes, "node");
	const evidenceById = uniqueIndex(graph.evidence, "evidence");
	uniqueIndex(graph.edges, "edge");
	assertCanonicalOrder(graph.nodes, "nodes");
	assertCanonicalOrder(graph.edges, "edges");

	for (const edge of graph.edges) {
		assert(nodesById.has(edge.from), `edge ${edge.id} has missing source ${edge.from}`);
		assert(nodesById.has(edge.to), `edge ${edge.id} has missing target ${edge.to}`);
	}
	for (const record of [...graph.nodes, ...graph.edges]) {
		for (const evidenceId of record.evidenceIds ?? []) {
			assert(
				evidenceById.has(evidenceId),
				`${record.id} cites missing evidence ${evidenceId}`,
			);
		}
	}
	for (const node of graph.nodes.filter((item) =>
		["classification", "capability"].includes(item.kind),
	)) {
		assert(node.evidenceIds?.length > 0, `${node.id} has no supporting evidence`);
	}

	for (const id of expected.requiredNodeIds) {
		assert(nodesById.has(id), `required node missing: ${id}`);
	}
	for (const matcher of expected.requiredEdges) {
		const edge = graph.edges.find((candidate) => matches(candidate, matcher));
		assert(edge, `required edge missing: ${JSON.stringify(matcher)}`);
		assert(edge.evidenceIds?.length > 0, `required edge ${edge.id} has no evidence`);
	}
	for (const query of expected.impact) {
		if (query.dependency) {
			assertIncludes(
				graph.impact.dependencies[query.artifact],
				query.dependency,
				`${query.artifact} dependency`,
			);
		}
		if (query.dependent) {
			assertIncludes(
				graph.impact.dependents[query.artifact],
				query.dependent,
				`${query.artifact} dependent`,
			);
		}
		if (query.affectedPage) {
			assertIncludes(
				graph.impact.affectedPages[query.artifact],
				query.affectedPage,
				`${query.artifact} affected page`,
			);
		}
	}
	assert(
		Array.isArray(graph.impact.unusedFiles),
		"missing impact.unusedFiles array",
	);
	assertIncludes(
		graph.impact.unusedFiles,
		expected.requiredUnusedFile,
		"unused-file projection",
	);
	for (const [code, maximum] of Object.entries(expected.issueMaximums)) {
		const count = graph.issues.filter((issue) => issue.code === code).length;
		assert(count <= maximum, `${code} count ${count} exceeds ${maximum}`);
	}
	for (const view of [
		"themeStructure",
		"shopifyData",
		"storefrontArchitecture",
		"configuration",
		"changeImpact",
	]) {
		assert(graph.views?.[view], `missing ${view} view`);
	}
	assert(slug.length > 0, "theme slug missing");
}

function uniqueIndex(records, label) {
	const result = new Map();
	for (const record of records) {
		assert(typeof record.id === "string", `${label} has no id`);
		assert(!result.has(record.id), `duplicate ${label} id ${record.id}`);
		result.set(record.id, record);
	}
	return result;
}

function assertCanonicalOrder(records, label) {
	for (let index = 1; index < records.length; index += 1) {
		assert(
			records[index - 1].id.localeCompare(records[index].id) <= 0,
			`${label} are not canonically ordered at ${records[index].id}`,
		);
	}
}

function matches(record, matcher) {
	return Object.entries(matcher).every(([key, value]) => record[key] === value);
}

function assertIncludes(values, expected, label) {
	assert(Array.isArray(values) && values.includes(expected), `${label} missing ${expected}`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
