#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
	type ContractResolver,
	checkComponentScripts,
	compileNazareArtifact,
	compileNazareArtifactWithResolver,
	emitTheme,
	themeSchemaFromIR,
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
	const manifest = await manifestForEntry(file);
	const packageId = manifest?.id;
	const readAsset = (relativePath: string) => {
		try {
			return readFileSync(join(dirname(file), relativePath), "utf8");
		} catch {
			return undefined;
		}
	};
	const readPackageModule = localPackageModuleReader(file);
	const result = await compileNazareArtifactWithResolver(source, file, {
		resolver: localContractResolver(file),
		packageId,
		kind: manifest?.kind,
		dependencies: manifest
			? Object.keys(manifest.dependencies ?? {})
			: undefined,
		readAsset,
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
		const issues = [
			...result.issues,
			...checkComponentScripts(result.ir, { readAsset, readPackageModule }),
		];
		console.log(JSON.stringify({ issues }, null, 2));
		process.exit(hasErrors(issues) ? 1 : 0);
	}

	if (command === "artifact") {
		console.log(JSON.stringify(result, null, 2));
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "schema") {
		const schema = themeSchemaFromIR(result.ir, {
			name: schemaName(file, packageId),
			kind: manifest?.kind,
			contracts: result.contracts,
		});
		console.log(
			JSON.stringify({ schema, issues: result.issues }, null, 2),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "build") {
		const emitted = emitTheme(source, result, {
			name: schemaName(file, packageId),
			kind: manifest?.kind,
			readAsset,
			readPackageModule,
		});
		const issues = [
			...result.issues,
			...checkComponentScripts(result.ir, { readAsset, readPackageModule }),
			...emitted.issues,
		];
		const outputDir = join(".nazare-out", "theme");
		const written: string[] = [];
		for (const themeFile of emitted.files) {
			const path = join(outputDir, themeFile.path);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, themeFile.contents);
			written.push(path);
		}
		console.log(JSON.stringify({ written, issues }, null, 2));
		process.exit(hasErrors(issues) ? 1 : 0);
	}

	if (command === "dump") {
		const written = await writeDumpFiles(file, result, packageId);
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

/**
 * Resolves function packages (manifest kind "function") from the same
 * roots the contract resolver searches, returning the entry source for
 * bundling and type checking.
 */
function localPackageModuleReader(
	entryFile: string,
): (packageId: string) => string | undefined {
	const searchRoots = [
		resolve(dirname(entryFile), ".."),
		resolve(process.cwd(), "examples", "components"),
	];

	return (packageId) => {
		const componentName = packageId.split("/").at(-1);
		if (!componentName) return undefined;

		for (const root of searchRoots) {
			try {
				const manifestPath = join(root, componentName, "nazare.json");
				const manifest = JSON.parse(
					readFileSync(manifestPath, "utf8"),
				) as NazareManifest;
				if (manifest.kind !== "function") return undefined;
				return readFileSync(
					join(dirname(manifestPath), manifest.entry),
					"utf8",
				);
			} catch {
				// try the next root
			}
		}

		return undefined;
	};
}

async function manifestForEntry(
	entryFile: string,
): Promise<NazareManifest | undefined> {
	const manifestSource = await readOptional(
		join(dirname(entryFile), "nazare.json"),
	);
	if (manifestSource === undefined) return undefined;
	return JSON.parse(manifestSource) as NazareManifest;
}

async function writeDumpFiles(
	entryFile: string,
	result: Awaited<ReturnType<typeof compileNazareArtifactWithResolver>>,
	packageId: string | undefined,
): Promise<string[]> {
	const outputDir = ".nazare-out";
	const base = artifactBaseName(entryFile);
	const schema = themeSchemaFromIR(result.ir, {
		name: schemaName(entryFile, packageId),
		contracts: result.contracts,
	});
	const files = [
		[`${base}.ast.json`, { ast: result.ast, issues: result.issues }],
		[`${base}.ir.json`, { ir: result.ir, issues: result.issues }],
		[`${base}.graph.json`, { graph: result.graph, issues: result.issues }],
		[`${base}.validate.json`, { issues: result.issues }],
		[`${base}.schema.json`, { schema, issues: result.issues }],
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

function schemaName(entryFile: string, packageId: string | undefined): string {
	return packageId?.split("/").at(-1) ?? artifactBaseName(entryFile);
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
  nazare schema <file>
  nazare build <file>
  nazare artifact <file>
  nazare dump <file>`);
}
