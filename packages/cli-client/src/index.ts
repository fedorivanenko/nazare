#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
	type ContractResolver,
	compileNazareArtifact,
	compileNazareArtifactWithResolver,
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
	const packageId = await packageIdForEntry(file);
	const result = await compileNazareArtifactWithResolver(source, file, {
		resolver: localContractResolver(file),
		packageId,
	});

	if (command === "ast") {
		console.log(
			JSON.stringify({ ast: result.ast, issues: result.issues }, null, 2),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

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

	if (command === "artifact") {
		console.log(JSON.stringify(result, null, 2));
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "dump") {
		const written = await writeDumpFiles(file, result);
		console.log(JSON.stringify({ written, issues: result.issues }, null, 2));
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

async function packageIdForEntry(
	entryFile: string,
): Promise<string | undefined> {
	const manifestSource = await readOptional(
		join(dirname(entryFile), "nazare.json"),
	);
	if (manifestSource === undefined) return undefined;

	const manifest = JSON.parse(manifestSource) as NazareManifest;
	return manifest.id;
}

async function writeDumpFiles(
	entryFile: string,
	result: Awaited<ReturnType<typeof compileNazareArtifactWithResolver>>,
): Promise<string[]> {
	const outputDir = ".nazare-out";
	const base = artifactBaseName(entryFile);
	const files = [
		[`${base}.ast.json`, { ast: result.ast, issues: result.issues }],
		[`${base}.ir.json`, { ir: result.ir, issues: result.issues }],
		[`${base}.graph.json`, { graph: result.graph, issues: result.issues }],
		[`${base}.validate.json`, { issues: result.issues }],
		[`${base}.artifact.json`, result],
	] as const;

	await mkdir(outputDir, { recursive: true });

	const written: string[] = [];
	for (const [name, payload] of files) {
		const path = join(outputDir, name);
		await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
		written.push(path);
	}

	return written;
}

function artifactBaseName(entryFile: string): string {
	let name = basename(entryFile);
	while (extname(name)) name = basename(name, extname(name));
	return name;
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
  nazare ast <file>
  nazare ir <file>
  nazare graph <file>
  nazare validate <file>
  nazare artifact <file>
  nazare dump <file>`);
}
