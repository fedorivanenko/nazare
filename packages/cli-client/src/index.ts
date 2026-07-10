#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	compileNazareArtifact,
	compileNazareArtifactWithResolver,
	type ContractResolver,
} from "@nazare/compiler";
import type { NazareManifest } from "@nazare/core";

const [, , command, file] = process.argv;

if (
	!command ||
	command === "help" ||
	command === "--help" ||
	command === "-h"
) {
	printHelp();
	process.exit(0);
}

if (!file) {
	console.error(`Missing file path for command ${command}`);
	printHelp();
	process.exit(1);
}

try {
	const source = await readFile(file, "utf8");
	const result = await compileNazareArtifactWithResolver(source, file, {
		resolver: localContractResolver(file),
	});

	if (command === "ir") {
		console.log(
			JSON.stringify({ ir: result.ir, issues: result.issues }, null, 2),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "graph") {
		console.log(
			JSON.stringify({ graph: result.graph, issues: result.issues }, null, 2),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "validate") {
		console.log(JSON.stringify({ issues: result.issues }, null, 2));
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	console.error(`Unknown command ${command}`);
	printHelp();
	process.exit(1);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

/**
 * Resolves package contracts from the local filesystem by searching, in
 * order: sibling component directories of the compiled file, then
 * examples/components under the current working directory.
 */
function localContractResolver(entryFile: string): ContractResolver {
	const searchRoots = [
		resolve(dirname(entryFile), ".."),
		resolve(process.cwd(), "examples", "components"),
	];

	return async (packageId) => {
		const componentName = packageId.split("/").at(-1);
		if (!componentName) return undefined;

		for (const root of searchRoots) {
			const manifestPath = join(root, componentName, "nazare.json");
			const manifestSource = await readOptional(manifestPath);
			if (manifestSource === undefined) continue;

			const manifest = JSON.parse(manifestSource) as NazareManifest;
			const entryPath = join(dirname(manifestPath), manifest.entry);
			const entrySource = await readFile(entryPath, "utf8");
			return compileNazareArtifact(entrySource, entryPath, {
				packageId: manifest.id,
			}).contract;
		}

		return undefined;
	};
}

async function readOptional(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error.code === "ENOENT" || error.code === "ENOTDIR")
		) {
			return undefined;
		}
		throw error;
	}
}

function hasErrors(
	issues: { severity: "error" | "warning" | "info" }[],
): boolean {
	return issues.some((issue) => issue.severity === "error");
}

function printHelp(): void {
	console.error(`Usage:
  nazare ir <file>
  nazare graph <file>
  nazare validate <file>`);
}
