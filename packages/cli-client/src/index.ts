#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNazareArtifact } from "@nazare/compiler";
import type { ArtifactContract, NazareManifest } from "@nazare/core";

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
	const initial = compileNazareArtifact(source, file);
	const contracts = await loadContracts(initial.ir.syntax);
	const result = compileNazareArtifact(source, file, { contracts });

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

async function loadContracts(
	syntax: { kind: string; packageId?: string }[],
): Promise<ArtifactContract[]> {
	const packageIds = Array.from(
		new Set(
			syntax
				.filter((node) => node.kind === "import" && node.packageId)
				.map((node) => node.packageId as string),
		),
	);
	const contracts: ArtifactContract[] = [];

	for (const packageId of packageIds) {
		const contract = await loadLocalContract(packageId);
		if (contract) contracts.push(contract);
	}

	return contracts;
}

async function loadLocalContract(
	packageId: string,
): Promise<ArtifactContract | undefined> {
	const componentName = packageId.split("/").at(-1);
	if (!componentName) return undefined;

	const manifestPath = resolveRepoPath(
		"examples",
		"components",
		componentName,
		"nazare.json",
	);

	try {
		const manifest = JSON.parse(
			await readFile(manifestPath, "utf8"),
		) as NazareManifest;
		const componentDir = dirname(manifestPath);
		const entryPath = join(componentDir, manifest.entry);
		const source = await readFile(entryPath, "utf8");
		return compileNazareArtifact(source, entryPath, {
			packageId: manifest.id,
		}).contract;
	} catch {
		return undefined;
	}
}

function resolveRepoPath(...parts: string[]): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, "..", "..", "..", ...parts);
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
