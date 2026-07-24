#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	checkComponentScripts,
	compileNazareArtifact,
	themeSchemaFromIR,
} from "@nazare/compiler";
import { registryFromEnv } from "@nazare/registry";
import { runThemeBuild } from "./build-command.js";
import { diffComponent, installComponent, updateAll } from "./install.js";
import { type CliOptions, parseCliOptions, printHelp } from "./options.js";
import type { Output } from "./output.js";
import { packComponent, publishComponent } from "./publish.js";

const THEME_MANIFEST = "nazare.theme.json";

/**
 * Compiler facts: one file in, JSON out. Debugging views rather than daily
 * verbs, so they sit under `inspect` instead of competing for the top level
 * with `build`.
 */
const INSPECT_VIEWS = new Set([
	"ast",
	"ir",
	"graph",
	"schema",
	"artifact",
	"dump",
]);

/** Registry verbs common enough to also answer at the top level. */
const REGISTRY_ALIASES = new Set(["add", "update", "publish"]);

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

		// The project root is the working directory: every file the compiler
		// sees is identified by its root-relative POSIX path, and readProjectFile
		// is the compiler's entire filesystem.
		const projectRoot = options.cwd ?? process.cwd();
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
			return await runThemeBuild(
				projectRoot,
				cliOptions.positionals[0],
				cliOptions,
				output,
			);
		}

		// `init` scaffolds the project's explicit build config so add/build work.
		if (command === "init") {
			return await runInit(projectRoot, cliOptions, output);
		}

		// Everything registry-shaped lives under one namespace. `add`, `update`,
		// and `publish` are the daily verbs, so they are also reachable at the top
		// level — aliases, not commands of their own.
		if (command === "registry") {
			const [subcommand, ...rest] = cliOptions.positionals;
			return await runRegistry(
				subcommand,
				{ ...cliOptions, positionals: rest },
				projectRoot,
				output,
				env,
			);
		}
		if (REGISTRY_ALIASES.has(command)) {
			return await runRegistry(command, cliOptions, projectRoot, output, env);
		}

		// Every other command targets exactly one entry file.
		if (command !== "check" && command !== "inspect") {
			output.error(`Unknown command ${command}`);
			printHelp(output);
			return 1;
		}
		// `inspect` names the view first: `nazare inspect ir <file>`.
		const view = command === "inspect" ? cliOptions.positionals[0] : "check";
		const target =
			command === "inspect"
				? cliOptions.positionals[1]
				: cliOptions.positionals[0];
		if (command === "inspect" && (!view || !INSPECT_VIEWS.has(view))) {
			output.error(
				`Usage: nazare inspect <${[...INSPECT_VIEWS].join("|")}> <file>`,
			);
			return 1;
		}
		if (!target) {
			output.error(`Missing file path for command ${command}`);
			printHelp(output);
			return 1;
		}
		const file = target;
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

		if (view === "ast") {
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

		if (view === "ir") {
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

		if (view === "graph") {
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

		if (view === "check") {
			const result = compile();
			const issues = [
				...result.issues,
				...checkComponentScripts(result.ir, { readFile: readProjectFile }),
			];
			output.log(JSON.stringify({ issues, notes: result.notes }, null, 2));
			return hasErrors(issues) ? 1 : 0;
		}

		if (view === "artifact") {
			const result = compile();
			output.log(JSON.stringify(result, null, 2));
			return hasErrors(result.issues) ? 1 : 0;
		}

		if (view === "schema") {
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

		if (view === "dump") {
			const result = compile();
			const written = await writeDumpFiles(entryPath, result);
			output.log(JSON.stringify({ written, issues: result.issues }, null, 2));
			return hasErrors(result.issues) ? 1 : 0;
		}

		output.error(`Unknown inspect view ${view}`);
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

/**
 * The registry namespace: installing components, authoring them, and choosing
 * which registry to talk to. `connect` registers a source; `add` installs a
 * component — two verbs that were both called `add` before, one nested in the
 * other.
 */
async function runRegistry(
	subcommand: string | undefined,
	cliOptions: CliOptions,
	projectRoot: string,
	output: Output,
	env: NodeJS.ProcessEnv,
): Promise<number> {
	const [name, url] = cliOptions.positionals;

	if (subcommand === "add") {
		return await runAdd(projectRoot, name, cliOptions, output, env);
	}
	if (subcommand === "update") {
		return await runUpdate(projectRoot, name, cliOptions, output, env);
	}
	if (subcommand === "diff") {
		return await runDiff(projectRoot, name, cliOptions, output, env);
	}
	if (subcommand === "publish") {
		// One operation, one name: --pack writes the payload locally instead of
		// uploading it. The output is registry-shaped, so it doubles as a
		// `file:` registry to install from.
		return cliOptions.pack
			? await runPack(name, output, projectRoot)
			: await runPublish(name, output, env, projectRoot);
	}

	if (subcommand === "connect") {
		if (!name || !url) {
			output.error("Usage: nazare registry connect <name> <url>");
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

	output.error(`Unknown registry command ${subcommand ?? ""}`.trim());
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
			"No registry configured. Run `nazare registry connect <name> <url>` and `nazare registry use <name>`, or set NAZARE_REGISTRY.",
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
