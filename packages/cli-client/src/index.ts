#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import {
	checkComponentScripts,
	compileNazareArtifact,
	themeSchemaFromIR,
} from "@nazare/compiler";
import { registryFromEnv } from "@nazare/registry";
import { runThemeBuild } from "./build-command.js";
import { diffComponent, installComponent, updateAll } from "./install.js";
import { type CliOptions, parseCliOptions, printHelp } from "./options.js";
import { packComponent, publishComponent } from "./publish.js";

const THEME_MANIFEST = "nazare.theme.json";

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
	// below because it targets a directory (from the arg or nazare.theme.json
	// build.sourceRoot) rather than one entry file.
	if (command === "build") {
		await runThemeBuild(projectRoot, file, cliOptions);
	}

	// `init` scaffolds the project's explicit build config so add/build work.
	if (command === "init") {
		await runInit(projectRoot, cliOptions);
	}

	// Registry config commands update project-level nazare.theme.json.
	if (command === "registry") {
		await runRegistry(projectRoot, cliOptions);
	}

	// `add` / `update` talk to the registry, not a local entry file: they copy
	// component source (and its dependency closure) into the source root.
	if (command === "add") {
		await runAdd(projectRoot, file, cliOptions);
	}
	if (command === "update") {
		await runUpdate(projectRoot, file, cliOptions);
	}
	if (command === "diff") {
		await runDiff(projectRoot, file, cliOptions);
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

type ProjectManifest = {
	dependencies?: Record<string, string>;
	installed?: Record<string, string>;
	registry?: string;
	registries?: Record<string, string>;
	/** Explicit build paths. No hardcoded defaults; unset is an error. */
	build?: { outDir?: string; sourceRoot?: string };
};

/**
 * The source root a project installs into: an explicit --source-root flag wins,
 * else nazare.theme.json `build.sourceRoot`. There is no default — an unset
 * source root is an error, so where components land is always explicit.
 */
async function resolveSourceRoot(
	projectRoot: string,
	cliOptions: CliOptions,
): Promise<string> {
	if (cliOptions.sourceRoot) return cliOptions.sourceRoot;
	const manifest = await readProjectManifest(projectRoot);
	const sourceRoot = manifest.build?.sourceRoot;
	if (!sourceRoot) {
		throw new Error(
			'No source root. Pass --source-root, or set "build": { "sourceRoot": "…" } in nazare.theme.json.',
		);
	}
	return sourceRoot;
}

/**
 * Asks for a value with a shown default. A flag skips the question; a
 * non-interactive stdin (CI, pipes) takes the default silently, so `init` never
 * blocks a script. The answer is written to nazare.theme.json — explicit, not a
 * resolution default.
 */
async function ask(
	label: string,
	fallback: string,
	flagValue: string | undefined,
): Promise<string> {
	if (flagValue) return flagValue;
	if (!process.stdin.isTTY) return fallback;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await rl.question(`${label} (${fallback}): `)).trim();
		return answer || fallback;
	} finally {
		rl.close();
	}
}

/**
 * Scaffolds the project's explicit build config into nazare.theme.json (merging
 * with any existing registry config) and creates the source directory, so the
 * next `nazare add` / `nazare build` has somewhere to read from and write to.
 */
async function runInit(
	projectRoot: string,
	cliOptions: CliOptions,
): Promise<void> {
	const existing = await readProjectManifest(projectRoot);
	if (existing.build && !cliOptions.force) {
		console.error(
			"nazare.theme.json already has a build config. Re-run with --force to overwrite.",
		);
		process.exit(1);
	}

	const sourceRoot = await ask(
		"Source directory",
		"src",
		cliOptions.sourceRoot,
	);
	const outDir = await ask("Output directory", "theme", cliOptions.outDir);

	await writeProjectManifest(projectRoot, {
		...existing,
		build: { sourceRoot, outDir },
	});
	await mkdir(join(projectRoot, sourceRoot), { recursive: true });

	console.log(
		JSON.stringify(
			{ initialized: THEME_MANIFEST, build: { sourceRoot, outDir } },
			null,
			2,
		),
	);
	process.exit(0);
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
			client: await registryClientForProject(projectRoot),
			projectRoot,
			sourceRoot: await resolveSourceRoot(projectRoot, cliOptions),
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
		client: await registryClientForProject(process.cwd()),
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
		client: await registryClientForProject(projectRoot),
		projectRoot,
		sourceRoot: await resolveSourceRoot(projectRoot, cliOptions),
		force: cliOptions.force,
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

async function runDiff(
	projectRoot: string,
	id: string | undefined,
	cliOptions: CliOptions,
): Promise<void> {
	if (!id) {
		console.error("Usage: nazare diff <@scope/name> [--version x.y.z]");
		process.exit(1);
	}
	const diff = await diffComponent(id, cliOptions.version ?? "latest", {
		client: await registryClientForProject(projectRoot),
		projectRoot,
		sourceRoot: await resolveSourceRoot(projectRoot, cliOptions),
	});
	console.log(JSON.stringify(diff, null, 2));
	process.exit(0);
}

async function runRegistry(
	projectRoot: string,
	cliOptions: CliOptions,
): Promise<void> {
	const [subcommand, name, url] = cliOptions.positionals;
	if (subcommand === "add") {
		if (!name || !url) {
			console.error("Usage: nazare registry add <name> <url>");
			process.exit(1);
		}
		assertRegistryName(name);
		const manifest = await readProjectManifest(projectRoot);
		const registries = { ...(manifest.registries ?? {}), [name]: url };
		const next = {
			...manifest,
			registries,
			registry: manifest.registry ?? name,
		};
		await writeProjectManifest(projectRoot, next);
		console.log(
			JSON.stringify(
				{ added: { name, url }, current: next.registry, registries },
				null,
				2,
			),
		);
		process.exit(0);
	}

	if (subcommand === "use") {
		if (!name) {
			console.error("Usage: nazare registry use <name>");
			process.exit(1);
		}
		const manifest = await readProjectManifest(projectRoot);
		const registries = manifest.registries ?? {};
		const selected = registries[name];
		if (!selected) {
			console.error(`Unknown registry ${name}`);
			process.exit(1);
		}
		await writeProjectManifest(projectRoot, { ...manifest, registry: name });
		console.log(JSON.stringify({ current: name, url: selected }, null, 2));
		process.exit(0);
	}

	if (subcommand === "list" || !subcommand) {
		const manifest = await readProjectManifest(projectRoot);
		console.log(
			JSON.stringify(
				{
					current: process.env.NAZARE_REGISTRY
						? "<env:NAZARE_REGISTRY>"
						: (manifest.registry ?? null),
					registries: manifest.registries ?? {},
				},
				null,
				2,
			),
		);
		process.exit(0);
	}

	console.error(`Unknown registry command ${subcommand}`);
	printHelp();
	process.exit(1);
}

async function registryClientForProject(projectRoot: string) {
	if (process.env.NAZARE_REGISTRY) return registryFromEnv();
	const manifest = await readProjectManifest(projectRoot);
	const current = manifest.registry;
	const registries = manifest.registries ?? {};
	const url = current ? registries[current] : undefined;
	if (!current || !url) {
		throw new Error(
			"No registry configured. Run `nazare registry add <name> <url>` and `nazare registry use <name>`, or set NAZARE_REGISTRY.",
		);
	}
	return registryFromEnv({ NAZARE_REGISTRY: url });
}

async function readProjectManifest(
	projectRoot: string,
): Promise<ProjectManifest> {
	const raw = await readFile(join(projectRoot, THEME_MANIFEST), "utf8").catch(
		() => undefined,
	);
	if (raw === undefined) return {};
	return JSON.parse(raw) as ProjectManifest;
}

async function writeProjectManifest(
	projectRoot: string,
	manifest: ProjectManifest,
): Promise<void> {
	await writeFile(
		join(projectRoot, THEME_MANIFEST),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
}

function assertRegistryName(name: string): void {
	if (/^[A-Za-z0-9._-]+$/.test(name)) return;
	throw new Error(
		`Invalid registry name ${name}; use only letters, numbers, dot, underscore, and dash`,
	);
}

function hasErrors(
	issues: { severity: "error" | "warning" | "info" }[],
): boolean {
	return issues.some((issue) => issue.severity === "error");
}
