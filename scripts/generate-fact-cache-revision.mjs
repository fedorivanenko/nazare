#!/usr/bin/env node
// Generates cache identity from every compiler/source adapter and grammar input.
// Build runs this before TypeScript compilation, making stale cache identity
// impossible in emitted packages. Use --check when generation must be read-only.
import {
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	computeRepositoryFactCacheRevision,
	generatedFactCacheRevisionPath,
	renderFactCacheRevisionModule,
} from "./fact-cache-revision.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = generatedFactCacheRevisionPath(repositoryRoot);
const revision = computeRepositoryFactCacheRevision(repositoryRoot);
const expected = renderFactCacheRevisionModule(revision);
const existing = readIfPresent(generatedPath);
const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => argument !== "--check")) {
	const unknown = arguments_.find((argument) => argument !== "--check");
	throw new Error(`Unknown argument ${unknown}`);
}
if (arguments_.filter((argument) => argument === "--check").length > 1) {
	throw new Error("Duplicate --check argument");
}
const checkOnly = arguments_[0] === "--check";

if (existing === expected) {
	if (!checkOnly) console.log(`Fact cache revision up to date (${revision}).`);
} else if (checkOnly) {
	console.error(
		`Fact cache revision is stale. Expected ${revision}.\nRun \`pnpm -s build\` and commit ${relative(repositoryRoot, generatedPath)}.`,
	);
	process.exitCode = 1;
} else {
	writeAtomically(generatedPath, expected);
	console.log(`Fact cache revision updated to ${revision}.`);
}

function writeAtomically(path, contents) {
	const temporaryPath = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(temporaryPath, contents);
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function readIfPresent(path) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error && typeof error === "object" && error.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}
