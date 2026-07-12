#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
	basename,
	dirname,
	extname,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	buildNazareTheme,
	checkComponentScripts,
	compileNazareArtifact,
	themeSchemaFromIR,
} from "@nazare/compiler";

const args = process.argv.slice(2);
const command = args[0];
const file = args[1];

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
	const cliOptions = parseCliOptions(args.slice(2));

	// The project root is the working directory: every file the compiler
	// sees is identified by its root-relative POSIX path, and readProjectFile
	// is the compiler's entire filesystem.
	const projectRoot = process.cwd();
	const entryPath = relative(projectRoot, resolve(file)).split(sep).join("/");
	if (entryPath.startsWith("..")) {
		console.error(`${file} is outside the project root ${projectRoot}`);
		process.exit(1);
	}
	const readProjectFile = (path: string): string | undefined => {
		try {
			return readFileSync(join(projectRoot, path), "utf8");
		} catch {
			return undefined;
		}
	};

	// The file declares its own kind ({% component section %}); the CLI no
	// longer reads nazare.json to compile — that stays registry-only.
	const source = await readFile(file, "utf8");
	let compiled: ReturnType<typeof compileNazareArtifact> | undefined;
	const compile = (): ReturnType<typeof compileNazareArtifact> => {
		compiled ??= compileNazareArtifact(source, entryPath, {
			readFile: readProjectFile,
			strictness: cliOptions.strictness,
			dependencyDiagnostics: cliOptions.dependencyDiagnostics,
		});
		return compiled;
	};

	if (command === "ast") {
		const result = compile();
		console.log(
			JSON.stringify(
				{ ast: result.ast, issues: result.issues, notes: result.notes },
				null,
				2,
			),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "ir") {
		const result = compile();
		console.log(
			JSON.stringify(
				{ ir: result.ir, issues: result.issues, notes: result.notes },
				null,
				2,
			),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "graph") {
		const result = compile();
		console.log(
			JSON.stringify(
				{ graph: result.graph, issues: result.issues, notes: result.notes },
				null,
				2,
			),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "validate") {
		const result = compile();
		const issues = [
			...result.issues,
			...checkComponentScripts(result.ir, { readFile: readProjectFile }),
		];
		console.log(JSON.stringify({ issues, notes: result.notes }, null, 2));
		process.exit(hasErrors(issues) ? 1 : 0);
	}

	if (command === "artifact") {
		const result = compile();
		console.log(JSON.stringify(result, null, 2));
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "schema") {
		const result = compile();
		const schema = themeSchemaFromIR(result.ir, {
			name: artifactBaseName(entryPath),
			contracts: result.contracts,
		});
		console.log(
			JSON.stringify(
				{ schema, issues: result.issues, notes: result.notes },
				null,
				2,
			),
		);
		process.exit(hasErrors(result.issues) ? 1 : 0);
	}

	if (command === "build") {
		const built = buildNazareTheme(source, entryPath, {
			name: artifactBaseName(entryPath),
			readFile: readProjectFile,
			strictness: cliOptions.strictness,
			dependencyDiagnostics: cliOptions.dependencyDiagnostics,
		});
		const issues = [
			...built.issues,
			...checkComponentScripts(built.ir, { readFile: readProjectFile }),
		];
		const outputDir = join(".nazare-out", "theme");
		const written: string[] = [];
		for (const themeFile of built.emitted.files) {
			const path = join(outputDir, themeFile.path);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, themeFile.contents);
			written.push(path);
		}
		console.log(
			JSON.stringify({ written, issues, notes: built.notes }, null, 2),
		);
		process.exit(hasErrors(issues) ? 1 : 0);
	}

	if (command === "dump") {
		const result = compile();
		const written = await writeDumpFiles(entryPath, result);
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

type CliOptions = {
	strictness?: "loose" | "strict";
	dependencyDiagnostics?: "hidden" | "surface";
};

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--strictness") {
			options.strictness = parseStrictness(args[index + 1]);
			index += 1;
			continue;
		}
		if (arg.startsWith("--strictness=")) {
			options.strictness = parseStrictness(arg.slice("--strictness=".length));
			continue;
		}
		if (arg === "--dependency-diagnostics") {
			options.dependencyDiagnostics = parseDependencyDiagnostics(
				args[index + 1],
			);
			index += 1;
			continue;
		}
		if (arg.startsWith("--dependency-diagnostics=")) {
			options.dependencyDiagnostics = parseDependencyDiagnostics(
				arg.slice("--dependency-diagnostics=".length),
			);
			continue;
		}
		throw new Error(`Unknown option ${arg}`);
	}

	return options;
}

function parseStrictness(value: string | undefined): "loose" | "strict" {
	if (value === "loose" || value === "strict") return value;
	throw new Error(
		`Invalid --strictness ${value ?? "<missing>"}; expected loose or strict`,
	);
}

function parseDependencyDiagnostics(
	value: string | undefined,
): "hidden" | "surface" {
	if (value === "hidden" || value === "surface") return value;
	throw new Error(
		`Invalid --dependency-diagnostics ${value ?? "<missing>"}; expected hidden or surface`,
	);
}

async function writeDumpFiles(
	entryPath: string,
	result: ReturnType<typeof compileNazareArtifact>,
): Promise<string[]> {
	const outputDir = ".nazare-out";
	const base = artifactBaseName(entryPath);
	const schema = themeSchemaFromIR(result.ir, {
		name: base,
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

function artifactBaseName(entryFile: string): string {
	let name = basename(entryFile);
	while (extname(name)) name = basename(name, extname(name));
	return name;
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
  nazare dump <file>

Options:
  --strictness loose|strict
  --dependency-diagnostics hidden|surface`);
}
