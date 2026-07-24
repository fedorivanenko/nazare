#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import {
	basename,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	checkComponentScripts,
	compileNazareArtifact,
	inspectNazareTheme,
	parsePersistedInspectFactCache,
	serializePersistedInspectFactCache,
	summarizeThemeGraph,
	type ThemeAnalysisCache,
	themeGraphToDot,
	themeSchemaFromIR,
} from "@nazare/compiler";
import { registryFromEnv } from "@nazare/registry";
import { runThemeBuild } from "./build-command.js";
import { serveThemeGraph } from "./graph-server.js";
import {
	collectThemeInputFiles,
	isMissingFileError,
	readOptionalInspectArtifact,
	validateInspectConfiguration,
} from "./inspect-input.js";
import { diffComponent, installComponent, updateAll } from "./install.js";
import { type CliOptions, parseCliOptions, printHelp } from "./options.js";
import type { Output } from "./output.js";
import { packComponent, publishComponent } from "./publish.js";

const THEME_MANIFEST = "nazare.theme.json";

type MainOptions = { cwd?: string; env?: NodeJS.ProcessEnv; output?: Output };

export async function main(
	args = process.argv.slice(2),
	options: MainOptions = {},
): Promise<number> {
	const output = options.output ?? console;
	const env = options.env ?? process.env;
	const command = args[0];

	if (
		!command ||
		command === "help" ||
		command === "--help" ||
		command === "-h"
	) {
		printHelp(output);
		return 0;
	}

	try {
		const cliOptions = parseCliOptions(args.slice(1));
		const file = cliOptions.positionals[0];

		// The project root is the working directory: every file the compiler
		// sees is identified by its root-relative POSIX path, and readProjectFile
		// is the compiler's entire filesystem.
		const projectRoot = options.cwd ?? process.cwd();
		const readProjectFile = (path: string): string | undefined => {
			try {
				return readFileSync(join(projectRoot, path), "utf8");
			} catch (error) {
				if (isMissingFileError(error)) return undefined;
				throw new Error(
					`Unable to read project file ${path}: ${errorMessage(error)}`,
				);
			}
		};

		// `build` is theme-wide: it walks a source root and compiles every
		// component into one theme output. It runs before the single-file setup
		// below because it targets a directory (from the arg or nazare.theme.json
		// build.sourceRoot) rather than one entry file.
		if (command === "graph-server") {
			const manifest = await readProjectManifest(projectRoot);
			const graphRoot = file ?? manifest.build?.sourceRoot;
			if (!graphRoot) {
				throw new Error(
					'Graph server requires a directory argument or "build.sourceRoot" in nazare.theme.json',
				);
			}
			const resolvedGraphRoot = resolve(projectRoot, graphRoot);
			const canonicalProjectRoot = await realpath(projectRoot);
			const canonicalGraphRoot = await realpath(resolvedGraphRoot);
			if (isOutsideRoot(canonicalProjectRoot, canonicalGraphRoot)) {
				throw new Error(
					`${resolvedGraphRoot} resolves outside the project root ${projectRoot}`,
				);
			}
			await serveThemeGraph(canonicalGraphRoot, process.stdin, process.stdout, {
				projectRoot: canonicalProjectRoot,
			});
			return 0;
		}

		if (command === "build") {
			return await runThemeBuild(projectRoot, file, cliOptions, output);
		}

		// `init` scaffolds the project's explicit build config so add/build work.
		if (command === "init") {
			return await runInit(projectRoot, cliOptions, output);
		}

		// Whole-theme read-only inspection.
		if (command === "inspect") {
			return await runInspect(projectRoot, cliOptions, output);
		}

		// Registry config commands update project-level nazare.theme.json.
		if (command === "registry") {
			return await runRegistry(projectRoot, cliOptions, output, env);
		}

		// `add` / `update` talk to the registry, not a local entry file: they copy
		// component source (and its dependency closure) into the source root.
		if (command === "add") {
			return await runAdd(projectRoot, file, cliOptions, output, env);
		}
		if (command === "update") {
			return await runUpdate(projectRoot, file, cliOptions, output, env);
		}
		if (command === "diff") {
			return await runDiff(projectRoot, file, cliOptions, output, env);
		}

		// Registry authoring commands target a component folder, not a compile entry.
		if (command === "pack") {
			return await runPack(file, output, projectRoot);
		}
		if (command === "publish") {
			return await runPublish(file, output, env, projectRoot);
		}

		// Every other command targets exactly one entry file.
		if (!file) {
			output.error(`Missing file path for command ${command}`);
			printHelp(output);
			return 1;
		}
		const resolvedFile = resolve(projectRoot, file);
		const entryPath = relative(projectRoot, resolvedFile).split(sep).join("/");
		if (entryPath.startsWith("..")) {
			output.error(`${file} is outside the project root ${projectRoot}`);
			return 1;
		}

		// The file declares its own kind ({% component section %}); the CLI no
		// longer reads nazare.json to compile — that stays registry-only.
		const source = await readFile(resolvedFile, "utf8");
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
			output.log(
				JSON.stringify(
					{ ast: result.ast, issues: result.issues, notes: result.notes },
					null,
					2,
				),
			);
			return hasErrors(result.issues) ? 1 : 0;
		}

		if (command === "ir") {
			const result = compile();
			output.log(
				JSON.stringify(
					{ ir: result.ir, issues: result.issues, notes: result.notes },
					null,
					2,
				),
			);
			return hasErrors(result.issues) ? 1 : 0;
		}

		if (command === "graph") {
			const result = compile();
			output.log(
				JSON.stringify(
					{ graph: result.graph, issues: result.issues, notes: result.notes },
					null,
					2,
				),
			);
			return hasErrors(result.issues) ? 1 : 0;
		}

		if (command === "validate") {
			const result = compile();
			const issues = [
				...result.issues,
				...checkComponentScripts(result.ir, { readFile: readProjectFile }),
			];
			output.log(JSON.stringify({ issues, notes: result.notes }, null, 2));
			return hasErrors(issues) ? 1 : 0;
		}

		if (command === "artifact") {
			const result = compile();
			output.log(JSON.stringify(result, null, 2));
			return hasErrors(result.issues) ? 1 : 0;
		}

		if (command === "schema") {
			const result = compile();
			const schema = themeSchemaFromIR(result.ir, {
				name: artifactBaseName(entryPath),
				contracts: result.contracts,
			});
			output.log(
				JSON.stringify(
					{ schema, issues: result.issues, notes: result.notes },
					null,
					2,
				),
			);
			return hasErrors(result.issues) ? 1 : 0;
		}

		if (command === "dump") {
			const result = compile();
			const written = await writeDumpFiles(entryPath, result);
			output.log(JSON.stringify({ written, issues: result.issues }, null, 2));
			return hasErrors(result.issues) ? 1 : 0;
		}

		output.error(`Unknown command ${command}`);
		printHelp(output);
		return 1;
	} catch (error) {
		output.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
	process.exit(await main());
}

type ProjectManifest = {
	dependencies?: Record<string, string>;
	installed?: Record<string, string>;
	registry?: string;
	registries?: Record<string, string>;
	/** Explicit build paths. No hardcoded defaults; unset is an error. */
	build?: { outDir?: string; sourceRoot?: string };
	/**
	 * Inspect policy. `exclude` holds theme-relative globs — typically generated
	 * page-builder chunks — that are skipped entirely and reported as excluded.
	 */
	inspect?: { exclude?: string[] };
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
	output: Output,
): Promise<number> {
	const existing = await readProjectManifest(projectRoot);
	if (existing.build && !cliOptions.force) {
		output.error(
			"nazare.theme.json already has a build config. Re-run with --force to overwrite.",
		);
		return 1;
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

	output.log(
		JSON.stringify(
			{ initialized: THEME_MANIFEST, build: { sourceRoot, outDir } },
			null,
			2,
		),
	);
	return 0;
}

async function runInspect(
	projectRoot: string,
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	const [target, dirArg] = cliOptions.positionals;
	if (target !== "theme") {
		output.error("Usage: nazare inspect theme [dir] --format json");
		return 1;
	}
	const format = cliOptions.format ?? "json";
	if (format !== "json" && format !== "text" && format !== "dot") {
		output.error(
			`Unsupported inspect format ${format}; expected json, text, or dot`,
		);
		return 1;
	}
	const manifest = await readProjectManifest(projectRoot);
	const exclude = validateInspectConfiguration(manifest.inspect);
	const inspectRoot = dirArg ?? manifest.build?.sourceRoot;
	if (!inspectRoot) {
		output.error(
			'Usage: nazare inspect theme [dir] --format json (or set "build.sourceRoot" in nazare.theme.json)',
		);
		return 1;
	}
	const root = resolve(projectRoot, inspectRoot);
	const canonicalProjectRoot = await realpath(projectRoot);
	const canonicalRoot = await realpath(root);
	if (isOutsideRoot(canonicalProjectRoot, canonicalRoot)) {
		output.error(`${root} resolves outside the project root ${projectRoot}`);
		return 1;
	}
	const files = await collectThemeInputFiles(
		canonicalRoot,
		canonicalProjectRoot,
	);
	const metafields = await readMetafieldSnapshot(projectRoot);
	const themeCheck = await readThemeCheckPolicy(projectRoot);
	const cachePath = join(projectRoot, ".nazare-out", "inspect-cache-v2.json");
	const cache = await readThemeAnalysisCache(cachePath);
	const inspected = inspectNazareTheme(files, {
		root:
			relative(canonicalProjectRoot, canonicalRoot).split(sep).join("/") || ".",
		strictness: cliOptions.strictness,
		cache,
		exclude,
		metafields,
		themeCheck,
	});
	await mkdir(join(projectRoot, ".nazare-out"), { recursive: true });
	await writeThemeAnalysisCache(cachePath, cache);
	output.log(
		format === "text"
			? renderInspectReport(inspected)
			: format === "dot"
				? themeGraphToDot(inspected)
				: JSON.stringify(inspected, null, 2),
	);
	return hasErrors(
		inspected.issues.filter((issue) => issue.severity === "error"),
	)
		? 1
		: 0;
}

function renderInspectReport(
	graph: ReturnType<typeof inspectNazareTheme>,
): string {
	const summary = summarizeThemeGraph(graph);
	const lines = [
		`Theme graph: ${summary.fileCount} files`,
		`Pages ${summary.pageCount} · sections ${summary.sectionCount} · snippets ${summary.snippetCount} · components ${summary.componentCount}`,
		`Unresolved ${summary.unresolvedCount} · metafield reads without definitions ${summary.brokenMetafieldReadCount}`,
		`Affected pages ${summary.affectedPageCount}`,
		`Issues ${summary.issueCount} (${summary.errorCount} errors, ${summary.warningCount} warnings)`,
	];
	if (graph.issues.length > 0) {
		lines.push("", "Issues:");
		for (const issue of graph.issues.slice(0, 10)) {
			lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
		}
		if (graph.issues.length > 10) {
			lines.push(`- ... ${graph.issues.length - 10} more`);
		}
	}
	return lines.join("\n");
}

async function readThemeCheckPolicy(
	projectRoot: string,
): Promise<{ path: string; contents: string } | undefined> {
	return readOptionalInspectArtifact(projectRoot, ".theme-check.yml");
}

async function readMetafieldSnapshot(
	projectRoot: string,
): Promise<{ path: string; contents: string } | undefined> {
	return readOptionalInspectArtifact(projectRoot, ".shopify/metafields.json");
}

function isOutsideRoot(root: string, path: string): boolean {
	const relativePath = relative(root, path);
	return (
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	);
}

async function readThemeAnalysisCache(
	path: string,
): Promise<ThemeAnalysisCache> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return { version: 1, entries: {} };
		throw new Error(
			`Unable to read theme analysis cache ${path}: ${errorMessage(error)}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Invalid JSON in theme analysis cache ${path}: ${errorMessage(error)}`,
		);
	}
	try {
		return parsePersistedInspectFactCache(parsed);
	} catch (error) {
		throw new Error(
			`Invalid theme analysis cache ${path}: ${errorMessage(error)}`,
		);
	}
}

async function writeThemeAnalysisCache(
	path: string,
	cache: ThemeAnalysisCache,
): Promise<void> {
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, serializePersistedInspectFactCache(cache));
		await rename(temporaryPath, path);
	} catch (error) {
		try {
			await rm(temporaryPath, { force: true });
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				`Unable to write theme analysis cache ${path} and remove temporary file ${temporaryPath}`,
			);
		}
		throw new Error(
			`Unable to write theme analysis cache ${path}: ${errorMessage(error)}`,
		);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
	output: Output,
	env: NodeJS.ProcessEnv,
): Promise<number> {
	if (!id) {
		output.error("Usage: nazare add <@scope/name> [--version x.y.z]");
		return 1;
	}
	const outcome = await installComponent(
		id,
		cliOptions.version ?? "latest",
		"add",
		{
			client: await registryClientForProject(projectRoot, env),
			projectRoot,
			sourceRoot: await resolveSourceRoot(projectRoot, cliOptions),
		},
	);
	for (const warning of outcome.warnings) output.error(`warning: ${warning}`);
	output.log(JSON.stringify(outcome, null, 2));
	return 0;
}

async function runPack(
	dir: string | undefined,
	output: Output,
	projectRoot: string,
): Promise<number> {
	const { component, path } = await packComponent(
		resolve(projectRoot, dir ?? "."),
		join(projectRoot, ".nazare-out", "pack"),
	);
	output.log(
		JSON.stringify(
			{
				packed: { id: component.id, version: component.version },
				path: relative(projectRoot, path).split(sep).join("/"),
				files: Object.keys(component.files).sort(),
			},
			null,
			2,
		),
	);
	return 0;
}

async function runPublish(
	dir: string | undefined,
	output: Output,
	env: NodeJS.ProcessEnv,
	projectRoot: string,
): Promise<number> {
	const { component, result } = await publishComponent(
		resolve(projectRoot, dir ?? "."),
		{
			client: await registryClientForProject(projectRoot, env),
			token: env.NAZARE_TOKEN ?? "",
		},
	);
	if (result.ok) {
		output.log(
			JSON.stringify(
				{
					published: { id: result.id, version: result.version },
					files: Object.keys(component.files).sort(),
				},
				null,
				2,
			),
		);
		return 0;
	}
	output.error(`publish failed (${result.code}): ${result.message}`);
	if (result.code === "VERSION_EXISTS") {
		output.error('Bump "version" in nazare.json and publish again.');
	}
	return 1;
}

async function runUpdate(
	projectRoot: string,
	id: string | undefined,
	cliOptions: CliOptions,
	output: Output,
	env: NodeJS.ProcessEnv,
): Promise<number> {
	const options = {
		client: await registryClientForProject(projectRoot, env),
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
	for (const warning of outcome.warnings) output.error(`warning: ${warning}`);
	output.log(JSON.stringify(outcome, null, 2));
	return 0;
}

async function runDiff(
	projectRoot: string,
	id: string | undefined,
	cliOptions: CliOptions,
	output: Output,
	env: NodeJS.ProcessEnv,
): Promise<number> {
	if (!id) {
		output.error("Usage: nazare diff <@scope/name> [--version x.y.z]");
		return 1;
	}
	const diff = await diffComponent(id, cliOptions.version ?? "latest", {
		client: await registryClientForProject(projectRoot, env),
		projectRoot,
		sourceRoot: await resolveSourceRoot(projectRoot, cliOptions),
	});
	output.log(JSON.stringify(diff, null, 2));
	return 0;
}

async function runRegistry(
	projectRoot: string,
	cliOptions: CliOptions,
	output: Output,
	env: NodeJS.ProcessEnv,
): Promise<number> {
	const [subcommand, name, url] = cliOptions.positionals;
	if (subcommand === "add") {
		if (!name || !url) {
			output.error("Usage: nazare registry add <name> <url>");
			return 1;
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
		output.log(
			JSON.stringify(
				{ added: { name, url }, current: next.registry, registries },
				null,
				2,
			),
		);
		return 0;
	}

	if (subcommand === "use") {
		if (!name) {
			output.error("Usage: nazare registry use <name>");
			return 1;
		}
		const manifest = await readProjectManifest(projectRoot);
		const registries = manifest.registries ?? {};
		const selected = registries[name];
		if (!selected) {
			output.error(`Unknown registry ${name}`);
			return 1;
		}
		await writeProjectManifest(projectRoot, { ...manifest, registry: name });
		output.log(JSON.stringify({ current: name, url: selected }, null, 2));
		return 0;
	}

	if (subcommand === "list" || !subcommand) {
		const manifest = await readProjectManifest(projectRoot);
		output.log(
			JSON.stringify(
				{
					current: env.NAZARE_REGISTRY
						? "<env:NAZARE_REGISTRY>"
						: (manifest.registry ?? null),
					registries: manifest.registries ?? {},
				},
				null,
				2,
			),
		);
		return 0;
	}

	output.error(`Unknown registry command ${subcommand}`);
	printHelp(output);
	return 1;
}

async function registryClientForProject(
	projectRoot: string,
	env: NodeJS.ProcessEnv,
) {
	if (env.NAZARE_REGISTRY) {
		return registryFromEnv({
			...env,
			NAZARE_REGISTRY: resolveRegistryUrl(env.NAZARE_REGISTRY, projectRoot),
		});
	}
	const manifest = await readProjectManifest(projectRoot);
	const current = manifest.registry;
	const registries = manifest.registries ?? {};
	const url = current ? registries[current] : undefined;
	if (!current || !url) {
		throw new Error(
			"No registry configured. Run `nazare registry add <name> <url>` and `nazare registry use <name>`, or set NAZARE_REGISTRY.",
		);
	}
	return registryFromEnv({
		NAZARE_REGISTRY: resolveRegistryUrl(url, projectRoot),
	});
}

function resolveRegistryUrl(url: string, projectRoot: string): string {
	if (!url.startsWith("file:") || url.startsWith("file:/")) return url;
	return `file:${join(projectRoot, url.slice("file:".length))}`;
}

async function readProjectManifest(
	projectRoot: string,
): Promise<ProjectManifest> {
	const path = join(projectRoot, THEME_MANIFEST);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return {};
		throw new Error(`Unable to read ${path}: ${errorMessage(error)}`);
	}
	try {
		return JSON.parse(raw) as ProjectManifest;
	} catch (error) {
		throw new Error(`Invalid JSON in ${path}: ${errorMessage(error)}`);
	}
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
