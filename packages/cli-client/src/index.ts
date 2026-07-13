#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
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
import type { Diagnostic } from "@nazare/core";

const DEFAULT_SOURCE_ROOT = "nazare";

const args = process.argv.slice(2);
const command = args[0];

if (
	!command ||
	command === "help" ||
	command === "--help" ||
	command === "-h"
) {
	printHelp();
	process.exit(0);
}

try {
	const cliOptions = parseCliOptions(args.slice(1));
	const file = cliOptions.positionals[0];

	// The project root is the working directory: every file the compiler
	// sees is identified by its root-relative POSIX path, and readProjectFile
	// is the compiler's entire filesystem.
	const projectRoot = process.cwd();
	const readProjectFile = (path: string): string | undefined => {
		try {
			return readFileSync(join(projectRoot, path), "utf8");
		} catch {
			return undefined;
		}
	};

	// `build` is theme-wide: it walks a source root and compiles every
	// component into one theme output. It runs before the single-file setup
	// below because it may target a directory — or nothing, defaulting to the
	// `nazare/` source root — rather than one entry file.
	if (command === "build") {
		await runThemeBuild(projectRoot, readProjectFile, file, cliOptions);
	}

	// Every other command targets exactly one entry file.
	if (!file) {
		console.error(`Missing file path for command ${command}`);
		printHelp();
		process.exit(1);
	}
	const entryPath = relative(projectRoot, resolve(file)).split(sep).join("/");
	if (entryPath.startsWith("..")) {
		console.error(`${file} is outside the project root ${projectRoot}`);
		process.exit(1);
	}

	// The file declares its own kind ({% component section %}); the CLI no
	// longer reads nazare.json to compile — that stays registry-only.
	const source = await readFile(file, "utf8");
	let compiled: ReturnType<typeof compileNazareArtifact> | undefined;
	const compile = (): ReturnType<typeof compileNazareArtifact> => {
		compiled ??= compileNazareArtifact(source, entryPath, {
			readFile: readProjectFile,
			strictness: cliOptions.strictness,
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
	positionals: string[];
};

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = { positionals: [] };

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
		if (arg.startsWith("--")) {
			throw new Error(`Unknown option ${arg}`);
		}
		options.positionals.push(arg);
	}

	return options;
}

function parseStrictness(value: string | undefined): "loose" | "strict" {
	if (value === "loose" || value === "strict") return value;
	throw new Error(
		`Invalid --strictness ${value ?? "<missing>"}; expected loose or strict`,
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

/**
 * Compiles every `.nz.liquid` component under a source root into one theme
 * output. Discovery is by file extension alone — no nazare.json is read — so a
 * folder whose entry is a plain `.ts` (a function, imported but never emitted)
 * is pulled in as a dependency, not built as a standalone artifact. Always
 * terminates via process.exit.
 */
async function runThemeBuild(
	projectRoot: string,
	readProjectFile: (path: string) => string | undefined,
	target: string | undefined,
	cliOptions: CliOptions,
): Promise<void> {
	const sourceRoot = target ?? DEFAULT_SOURCE_ROOT;
	let entries: string[];
	try {
		entries = await collectComponentEntries(projectRoot, sourceRoot);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
	if (entries.length === 0) {
		console.error(`No .nz.liquid components under ${sourceRoot}`);
		process.exit(1);
	}

	// Each component emits into a shared theme tree; identical files (the shared
	// runtime asset) coalesce, and two components emitting different content to
	// the same path is a naming collision reported as a build conflict.
	const merged = new Map<string, { contents: string; from: string }>();
	const conflicts: string[] = [];
	const issues: Diagnostic[] = [];
	const notes: Diagnostic[] = [];
	const components: string[] = [];

	for (const entryPath of entries) {
		const source = await readFile(join(projectRoot, entryPath), "utf8");
		const built = buildNazareTheme(source, entryPath, {
			name: artifactBaseName(entryPath),
			readFile: readProjectFile,
			strictness: cliOptions.strictness,
		});
		issues.push(
			...built.issues,
			...checkComponentScripts(built.ir, { readFile: readProjectFile }),
		);
		notes.push(...built.notes);
		components.push(entryPath);

		for (const themeFile of built.emitted.files) {
			const existing = merged.get(themeFile.path);
			if (existing && existing.contents !== themeFile.contents) {
				conflicts.push(
					`${themeFile.path}: emitted by both ${existing.from} and ${entryPath}`,
				);
				continue;
			}
			merged.set(themeFile.path, {
				contents: themeFile.contents,
				from: entryPath,
			});
		}
	}

	// The output tree mirrors the source root exactly, so it is rebuilt from
	// scratch — stale files from removed components do not linger.
	const outputDir = join(projectRoot, ".nazare-out", "theme");
	await rm(outputDir, { recursive: true, force: true });
	const written: string[] = [];
	for (const path of [...merged.keys()].sort()) {
		const full = join(outputDir, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, merged.get(path)?.contents ?? "");
		written.push(join(".nazare-out", "theme", path));
	}

	console.log(
		JSON.stringify({ components, written, issues, notes, conflicts }, null, 2),
	);
	process.exit(hasErrors(issues) || conflicts.length > 0 ? 1 : 0);
}

/**
 * Returns the root-relative POSIX paths of every `.nz.liquid` component reached
 * from a source root, sorted for deterministic output. The root may itself be a
 * single component file (build one) or a directory (build the tree under it).
 */
async function collectComponentEntries(
	projectRoot: string,
	sourceRoot: string,
): Promise<string[]> {
	const rootAbs = resolve(projectRoot, sourceRoot);
	const rootStat = await stat(rootAbs).catch(() => undefined);
	if (!rootStat) throw new Error(`Source path not found: ${sourceRoot}`);

	if (rootStat.isFile()) {
		if (!rootAbs.endsWith(".nz.liquid")) {
			throw new Error(`Not a Nazare component: ${sourceRoot}`);
		}
		return [toRootRelativePosix(projectRoot, rootAbs)];
	}

	const found: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const dirent of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				await walk(full);
			} else if (dirent.name.endsWith(".nz.liquid")) {
				found.push(full);
			}
		}
	};
	await walk(rootAbs);

	return found.map((abs) => toRootRelativePosix(projectRoot, abs)).sort();
}

function toRootRelativePosix(projectRoot: string, abs: string): string {
	const rel = relative(projectRoot, abs).split(sep).join("/");
	if (rel.startsWith("..")) {
		throw new Error(`${abs} is outside the project root ${projectRoot}`);
	}
	return rel;
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
  nazare build [source-root|file]   walks nazare/ by default
  nazare artifact <file>
  nazare dump <file>

Options:
  --strictness loose|strict`);
}
