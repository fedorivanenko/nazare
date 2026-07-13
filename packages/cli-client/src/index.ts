#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
	checkComponentScripts,
	compileNazareArtifact,
	themeSchemaFromIR,
} from "@nazare/compiler";
import { registryFromEnv } from "@nazare/registry";
import { buildTheme } from "@nazare/theme";
import { installComponent, updateAll } from "./install.js";
import { packComponent, publishComponent } from "./publish.js";

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

	// `add` / `update` talk to the registry, not a local entry file: they copy
	// component source (and its dependency closure) into the source root.
	if (command === "add") {
		await runAdd(projectRoot, file, cliOptions);
	}
	if (command === "update") {
		await runUpdate(projectRoot, file, cliOptions);
	}

	// Registry authoring commands target a component folder, not a compile entry.
	if (command === "pack") {
		await runPack(file);
	}
	if (command === "publish") {
		await runPublish(file);
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
	version?: string;
	sourceRoot?: string;
	positionals: string[];
};

// A value option is either `--name value` (consuming the next arg) or
// `--name=value`. Returns the value, and how many args it consumed so the
// caller can advance past a consumed `value`.
function readValueOption(
	args: string[],
	index: number,
	name: string,
): { value: string | undefined; consumed: number } | undefined {
	const arg = args[index];
	if (arg === name) return { value: args[index + 1], consumed: 2 };
	if (arg.startsWith(`${name}=`)) {
		return { value: arg.slice(name.length + 1), consumed: 1 };
	}
	return undefined;
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = { positionals: [] };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		const strictness = readValueOption(args, index, "--strictness");
		if (strictness) {
			options.strictness = parseStrictness(strictness.value);
			index += strictness.consumed - 1;
			continue;
		}
		const version = readValueOption(args, index, "--version");
		if (version) {
			options.version = version.value;
			index += version.consumed - 1;
			continue;
		}
		const sourceRoot = readValueOption(args, index, "--source-root");
		if (sourceRoot) {
			options.sourceRoot = sourceRoot.value;
			index += sourceRoot.consumed - 1;
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
	_readProjectFile: (path: string) => string | undefined,
	target: string | undefined,
	cliOptions: CliOptions,
): Promise<void> {
	try {
		const result = await buildTheme({
			projectRoot,
			sourceRoot: target ?? DEFAULT_SOURCE_ROOT,
			strictness: cliOptions.strictness,
		});
		console.log(
			JSON.stringify({ ...result, components: result.compiled }, null, 2),
		);
		process.exit(
			hasErrors(result.issues) || result.conflicts.length > 0 ? 1 : 0,
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

function artifactBaseName(entryFile: string): string {
	let name = basename(entryFile);
	while (extname(name)) name = basename(name, extname(name));
	return name;
}

async function runAdd(
	projectRoot: string,
	id: string | undefined,
	cliOptions: CliOptions,
): Promise<void> {
	if (!id) {
		console.error("Usage: nazare add <@scope/name> [--version x.y.z]");
		process.exit(1);
	}
	const outcome = await installComponent(
		id,
		cliOptions.version ?? "latest",
		"add",
		{
			client: registryFromEnv(),
			projectRoot,
			sourceRoot: cliOptions.sourceRoot ?? DEFAULT_SOURCE_ROOT,
		},
	);
	for (const warning of outcome.warnings) console.error(`warning: ${warning}`);
	console.log(JSON.stringify(outcome, null, 2));
	process.exit(0);
}

async function runPack(dir: string | undefined): Promise<void> {
	const { component, path } = await packComponent(
		dir ?? ".",
		join(".nazare-out", "pack"),
	);
	console.log(
		JSON.stringify(
			{
				packed: { id: component.id, version: component.version },
				path,
				files: Object.keys(component.files).sort(),
			},
			null,
			2,
		),
	);
	process.exit(0);
}

async function runPublish(dir: string | undefined): Promise<void> {
	const { component, result } = await publishComponent(dir ?? ".", {
		client: registryFromEnv(),
		token: process.env.NAZARE_TOKEN ?? "",
	});
	if (result.ok) {
		console.log(
			JSON.stringify(
				{
					published: { id: result.id, version: result.version },
					files: Object.keys(component.files).sort(),
				},
				null,
				2,
			),
		);
		process.exit(0);
	}
	console.error(`publish failed (${result.code}): ${result.message}`);
	if (result.code === "VERSION_EXISTS") {
		console.error('Bump "version" in nazare.json and publish again.');
	}
	process.exit(1);
}

async function runUpdate(
	projectRoot: string,
	id: string | undefined,
	cliOptions: CliOptions,
): Promise<void> {
	const options = {
		client: registryFromEnv(),
		projectRoot,
		sourceRoot: cliOptions.sourceRoot ?? DEFAULT_SOURCE_ROOT,
	};
	const outcome = id
		? await installComponent(
				id,
				cliOptions.version ?? "latest",
				"update",
				options,
			)
		: await updateAll(options);
	for (const warning of outcome.warnings) console.error(`warning: ${warning}`);
	console.log(JSON.stringify(outcome, null, 2));
	process.exit(0);
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
  nazare add <@scope/name>          copy a component + deps into the source root
  nazare update [@scope/name]       re-fetch latest; all installed if omitted
  nazare pack [dir]                 write publishable payload to .nazare-out/pack
  nazare publish [dir]              publish component folder (default .)
  nazare artifact <file>
  nazare dump <file>

Options:
  --strictness loose|strict
  --version x.y.z                   add/update: exact version (default latest)
  --source-root <dir>               add/update/build: default nazare/

Env:
  NAZARE_REGISTRY                   registry base URL, or file:<dir> for a local one
  NAZARE_TOKEN                      bearer token for publish (file: registries ignore it)`);
}
