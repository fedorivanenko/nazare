#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
// Types only: erased at build, so naming the compiler here costs nothing at
// runtime. Its values are loaded by the commands that need them — see below.
import type {
	compileNazareArtifact,
	ThemeInputFile,
	ThemeMetafieldIdentity,
} from "@nazare/compiler";
import {
	collectThemeInputFiles,
	isMissingFileError,
	readOptionalInspectArtifact,
	validateInspectConfiguration,
} from "./inspect-input.js";
import {
	type CliOptions,
	INSPECT_THEME_QUERIES,
	INSPECT_VIEWS,
	PREVIEW_VERBS,
	parseCliOptions,
	printCommandHelp,
	printHelp,
} from "./options.js";
import { type Output, processOutput } from "./output.js";
import type {
	ShopifyFileImpact,
	ShopifyInspection,
	ShopifyMetafieldImpact,
	ShopifyQuerySession,
} from "./shopify-query-session.js";

/** Heavy modules, loaded only by commands that use them. */
const compiler = () => import("@nazare/compiler");
const registry = () => import("@nazare/registry");
const shopifyQueries = () => import("./shopify-query-session.js");

const THEME_MANIFEST = "nazare.theme.json";

/**
 * Compiler facts: one file in, JSON out. Debugging views rather than daily
 * verbs, so they sit under `inspect` instead of competing for the top level
 * with `build`.
 */
const INSPECT_VIEW_SET = new Set<string>(INSPECT_VIEWS);
const INSPECT_THEME_QUERY_SET = new Set<string>(INSPECT_THEME_QUERIES);

/** Registry verbs common enough to also answer at the top level. */
const REGISTRY_ALIASES = new Set(["add", "update", "publish"]);

const PREVIEW_VERB_SET = new Set<string>(PREVIEW_VERBS);

type MainOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	output?: Output;
	input?: Readable;
};

export async function main(
	args = process.argv.slice(2),
	options: MainOptions = {},
): Promise<number> {
	const output = options.output ?? processOutput;
	const env = options.env ?? process.env;
	const command = args[0];

	if (command === "--version" || command === "version") {
		output.log(readCliVersion());
		return 0;
	}

	if (!command || command === "--help" || command === "-h") {
		printHelp(output);
		return 0;
	}
	if (command === "help") {
		const topic = args[1];
		if (!topic) {
			printHelp(output);
			return 0;
		}
		if (printCommandHelp(topic, output)) return 0;
		output.error(`Unknown help topic ${topic}`);
		return 1;
	}

	try {
		const cliOptions = parseCliOptions(args.slice(1));
		if (cliOptions.help) {
			if (!printCommandHelp(command, output)) printHelp(output);
			return 0;
		}

		// The project root is the working directory: every file the compiler
		// sees is identified by its root-relative POSIX path, and readProjectFile
		// is the compiler's entire filesystem.
		const projectRoot = options.cwd ?? process.cwd();
		if (command === "source") {
			const { runSourceCommand } = await import("./source-command.js");
			return await runSourceCommand(
				projectRoot,
				cliOptions,
				output,
				options.input ?? process.stdin,
			);
		}
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
			const graphRoot = cliOptions.positionals[0] ?? manifest.build?.sourceRoot;
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
			const { serveThemeGraph } = await import("./graph-server.js");
			await serveThemeGraph(canonicalGraphRoot, process.stdin, process.stdout, {
				projectRoot: canonicalProjectRoot,
			});
			return 0;
		}

		if (command === "build" || command === "check") {
			const { runThemeBuild } = await import("./build-command.js");
			return await runThemeBuild(
				projectRoot,
				cliOptions.positionals[0],
				cliOptions,
				output,
				{ checkOnly: command === "check" },
			);
		}

		// The workbench, as three verbs under one namespace. Serving it is a
		// separate matter; these three need no server and no browser.
		if (command === "preview") {
			return await runPreview(projectRoot, cliOptions, output);
		}

		// `init` scaffolds the project's explicit build config so add/build work.
		if (command === "init") {
			return await runInit(projectRoot, cliOptions, output);
		}

		// `inspect theme` reads a whole theme from a directory rather than one
		// entry file, so it dispatches ahead of the per-file views below.
		if (command === "inspect" && cliOptions.positionals[0] === "theme") {
			return await runInspect(projectRoot, cliOptions, output);
		}
		if (
			command === "inspect" &&
			INSPECT_THEME_QUERY_SET.has(cliOptions.positionals[0] ?? "")
		) {
			return await runInspectThemeQuery(projectRoot, cliOptions, output);
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
		if (command !== "inspect") {
			output.error(`Unknown command ${command}`);
			printHelp(output);
			return 1;
		}
		// `inspect` names the view first: `nazare inspect ir <file>`.
		const view = cliOptions.positionals[0];
		const target = cliOptions.positionals[1];
		if (!view || !INSPECT_VIEW_SET.has(view)) {
			output.error(
				`Usage: nazare inspect <${[...INSPECT_VIEWS].join("|")}> <file>, or nazare inspect theme [dir]`,
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
		const { compileNazareArtifact: compileArtifact } = await compiler();
		let compiled: ReturnType<typeof compileNazareArtifact> | undefined;
		const compile = (): ReturnType<typeof compileNazareArtifact> => {
			compiled ??= compileArtifact(source, entryPath, {
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

		if (view === "artifact") {
			const result = compile();
			output.log(JSON.stringify(result, null, 2));
			return hasErrors(result.issues) ? 1 : 0;
		}

		if (view === "schema") {
			const result = compile();
			const schema = (await compiler()).themeSchemaFromIR(result.ir, {
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

if (isCliEntrypoint(process.argv[1])) {
	process.exit(await main());
}

function isCliEntrypoint(argument: string | undefined): boolean {
	if (!argument) return false;
	return (
		realpathSync(fileURLToPath(import.meta.url)) ===
		realpathSync(resolve(argument))
	);
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
	/**
	 * Where `preview build` writes. Asked for once and saved, rather than
	 * defaulted: a command that writes a directory tree should never be guessing
	 * which directory.
	 */
	preview?: { outDir?: string };
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

/**
 * `nazare preview <verb>`.
 *
 * The directory defaults to the project's own source root, because the thing
 * you want to look at is the thing you are building. `scaffold` is the odd one
 * out: it targets a single file, since a story file belongs to one component.
 */
async function runPreview(
	projectRoot: string,
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	const [verb, ...rest] = cliOptions.positionals;
	if (!verb || !PREVIEW_VERB_SET.has(verb)) {
		output.error(
			`Usage: nazare preview <${[...PREVIEW_VERBS].join("|")}>. See nazare help.`,
		);
		return 1;
	}

	// Stand-in data the project owns: copied in, or pulled from a live store.
	if (verb === "fixtures") {
		// The two actions take different arguments, so they are read separately
		// rather than through one expression that has to know which is which.
		const [action, ...args] = rest;
		const manifest = await readProjectManifest(projectRoot);
		const into = (dir: string | undefined) =>
			resolve(projectRoot, dir ?? manifest.build?.sourceRoot ?? ".");

		const { runFixturesInit, runFixturesPull } = await import(
			"./preview-fixtures.js"
		);
		if (action === "init") {
			// nazare preview fixtures init [dir]
			return await runFixturesInit(
				projectRoot,
				into(args[0]),
				cliOptions,
				output,
			);
		}
		if (action === "pull") {
			// nazare preview fixtures pull <handle> [dir]
			const [handle, dir] = args;
			if (!handle) {
				output.error(
					"Usage: nazare preview fixtures pull <handle> [dir] --store <shop>",
				);
				return 1;
			}
			return await runFixturesPull(
				projectRoot,
				into(dir),
				handle,
				cliOptions,
				output,
			);
		}
		output.error("Usage: nazare preview fixtures <init|pull>");
		return 1;
	}

	if (verb === "scaffold") {
		const target = rest[0];
		if (!target) {
			output.error("Usage: nazare preview scaffold <file.liquid>");
			return 1;
		}
		const { runPreviewScaffold } = await import("./preview-command.js");
		return await runPreviewScaffold(projectRoot, target, cliOptions, output);
	}

	const manifest = await readProjectManifest(projectRoot);
	const root = rest[0] ?? manifest.build?.sourceRoot ?? ".";
	const dir = resolve(projectRoot, root);

	if (verb === "check") {
		const { runPreviewCheck } = await import("./preview-command.js");
		return await runPreviewCheck(dir, cliOptions, output);
	}
	// Serving needs no output directory: the pages never touch a disk.
	if (verb === "serve") {
		const { runPreviewServe } = await import("./preview-server.js");
		return await runPreviewServe(dir, root, cliOptions, output);
	}

	// Asked once, then saved: the next `preview build` is a bare command.
	const configured = cliOptions.outDir ?? manifest.preview?.outDir;
	const outDir =
		configured ??
		(await ask("Preview output directory", ".nazare-out/preview", undefined));
	if (!manifest.preview?.outDir && !cliOptions.outDir) {
		await writeProjectManifest(projectRoot, {
			...manifest,
			preview: { ...manifest.preview, outDir },
		});
	}
	// The directory as the caller named it, for the header: "." and an absolute
	// path describe the same place, and only one of them is worth reading.
	const { runPreviewBuild } = await import("./preview-command.js");
	return await runPreviewBuild(dir, resolve(projectRoot, outDir), output, root);
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
	const inspected = await loadThemeInspection(
		projectRoot,
		dirArg,
		cliOptions,
		output,
	);
	output.log(
		format === "text"
			? renderInspectReport(inspected)
			: format === "dot"
				? renderInspectionDot(inspected)
				: JSON.stringify(inspected, null, 2),
	);
	return themeInspectionStatus(inspected);
}

async function runInspectThemeQuery(
	projectRoot: string,
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	const [query, ...arguments_] = cliOptions.positionals;
	switch (query) {
		case "impact":
			return runInspectFileImpact(projectRoot, arguments_, cliOptions, output);
		case "metafield":
			return runInspectMetafieldImpact(
				projectRoot,
				arguments_,
				cliOptions,
				output,
			);
		default:
			throw new Error(`Unhandled theme inspection query: ${String(query)}`);
	}
}

async function runInspectFileImpact(
	projectRoot: string,
	arguments_: string[],
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	const [path, dirArg, ...extra] = arguments_;
	if (!path || extra.length > 0) {
		output.error(
			"Usage: nazare inspect impact <theme-relative-file> [dir] --format text|json",
		);
		return 1;
	}
	const format = inspectQueryFormat("impact", cliOptions);
	const prepared = await prepareThemeInspection(
		projectRoot,
		dirArg,
		cliOptions,
		output,
	);
	const impact = await (await querySessionForInspection(prepared)).fileImpact(
		path,
	);
	if (!impact) {
		output.error(
			`Theme file ${path} was not found under inspected root ${prepared.root}`,
		);
		return 1;
	}
	output.log(
		format === "json"
			? JSON.stringify({ root: prepared.root, ...impact }, null, 2)
			: renderThemeFileImpact(impact),
	);
	return hasErrors(impact.issues) ? 1 : 0;
}

async function runInspectMetafieldImpact(
	projectRoot: string,
	arguments_: string[],
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	const [identifier, dirArg, ...extra] = arguments_;
	if (!identifier || extra.length > 0) {
		output.error(
			"Usage: nazare inspect metafield <owner.namespace.key> [dir] --format text|json",
		);
		return 1;
	}
	const identity = parseMetafieldIdentity(identifier);
	const format = inspectQueryFormat("metafield", cliOptions);
	const prepared = await prepareThemeInspection(
		projectRoot,
		dirArg,
		cliOptions,
		output,
	);
	const impact = await (
		await querySessionForInspection(prepared)
	).metafieldImpact(identity);
	output.log(
		format === "json"
			? JSON.stringify({ root: prepared.root, ...impact }, null, 2)
			: renderMetafieldImpact(impact),
	);
	return hasErrors(impact.issues) ? 1 : 0;
}

function inspectQueryFormat(
	query: "impact" | "metafield",
	cliOptions: CliOptions,
): "json" | "text" {
	const format = cliOptions.format ?? "text";
	if (format !== "json" && format !== "text") {
		throw new Error(
			`Unsupported ${query} format ${format}; expected text or json`,
		);
	}
	return format;
}

function parseMetafieldIdentity(identifier: string): ThemeMetafieldIdentity {
	const parts = identifier.split(".");
	if (
		parts.length !== 3 ||
		parts.some((part) => part.length === 0 || part.trim() !== part)
	) {
		throw new Error(
			`Invalid metafield identifier ${JSON.stringify(identifier)}; expected owner.namespace.key`,
		);
	}
	return { owner: parts[0], namespace: parts[1], key: parts[2] };
}

type PreparedThemeInspection = {
	root: string;
	files: ThemeInputFile[];
	exclude: string[];
	metafields?: { path: string; contents: string };
	themeCheck?: { path: string; contents: string };
};

async function loadThemeInspection(
	projectRoot: string,
	dirArg: string | undefined,
	cliOptions: CliOptions,
	output: Output,
): Promise<ShopifyInspection> {
	const prepared = await prepareThemeInspection(
		projectRoot,
		dirArg,
		cliOptions,
		output,
	);
	const session = await querySessionForInspection(prepared);
	const inspection = await session.inspection();
	const position = { line: 1, column: 1 };
	const compilerModule = await compiler();
	const excludedIssues = prepared.files.flatMap((file) => {
		const pattern = prepared.exclude.find((candidate) =>
			compilerModule.matchesThemeGlob(file.path, candidate),
		);
		return pattern
			? [
					{
						severity: "info" as const,
						phase: "validate" as const,
						code: "THEME_FILE_EXCLUDED",
						message: `Excluded from inspection by pattern "${pattern}"`,
						span: {
							file: file.path,
							start: position,
							end: position,
						},
					},
				]
			: [];
	});
	return {
		...inspection,
		issues: [...inspection.issues, ...excludedIssues],
	};
}

async function prepareThemeInspection(
	projectRoot: string,
	dirArg: string | undefined,
	_cliOptions: CliOptions,
	_output: Output,
): Promise<PreparedThemeInspection> {
	const manifest = await readProjectManifest(projectRoot);
	const exclude = validateInspectConfiguration(manifest.inspect);
	const inspectRoot = dirArg ?? manifest.build?.sourceRoot;
	if (!inspectRoot) {
		throw new Error(
			'Inspect requires a theme directory argument or "build.sourceRoot" in nazare.theme.json',
		);
	}
	const root = resolve(projectRoot, inspectRoot);
	const canonicalProjectRoot = await realpath(projectRoot);
	const canonicalRoot = await realpath(root);
	if (isOutsideRoot(canonicalProjectRoot, canonicalRoot)) {
		throw new Error(`${root} resolves outside the project root ${projectRoot}`);
	}
	const files = await collectThemeInputFiles(
		canonicalRoot,
		canonicalProjectRoot,
	);
	const metafields = await readMetafieldSnapshot(projectRoot);
	const themeCheck = await readThemeCheckPolicy(projectRoot);
	const relativeRoot =
		relative(canonicalProjectRoot, canonicalRoot).split(sep).join("/") || ".";
	return {
		root: relativeRoot,
		files,
		exclude,
		metafields,
		themeCheck,
	};
}

async function querySessionForInspection(
	prepared: PreparedThemeInspection,
): Promise<ShopifyQuerySession> {
	const [compilerModule, queryModule] = await Promise.all([
		compiler(),
		shopifyQueries(),
	]);
	return queryModule.ShopifyQuerySession.create(
		prepared.files.filter(
			(file) =>
				!prepared.exclude.some((pattern) =>
					compilerModule.matchesThemeGlob(file.path, pattern),
				),
		),
		{
			[queryModule.PROJECT_METADATA_KEYS.config]: {
				exclude: prepared.exclude,
			},
			...(prepared.metafields
				? {
						[queryModule.PROJECT_METADATA_KEYS.metafields]:
							prepared.metafields.contents,
					}
				: {}),
			...(prepared.themeCheck
				? {
						[queryModule.PROJECT_METADATA_KEYS.themeCheck]:
							prepared.themeCheck.contents,
					}
				: {}),
		},
	);
}

function themeInspectionStatus(inspected: ShopifyInspection): number {
	return inspected.issues.some((issue) => issue.severity === "error") ? 1 : 0;
}

function renderThemeFileImpact(impact: ShopifyFileImpact): string {
	const lines = [
		`Impact: ${impact.path}`,
		`Kind ${impact.fileKind} · usage ${impact.usage} · certainty ${impact.certainty}`,
	];
	appendInspectList(lines, "Dependencies", impact.dependencies);
	appendInspectList(lines, "Dependents", impact.dependents);
	appendInspectList(lines, "Affected pages", impact.affectedPages);
	appendInspectList(lines, "Uncertainty", impact.uncertainty);
	if (impact.issues.length === 0) {
		lines.push("Issues: none");
	} else {
		lines.push(`Issues (${impact.issues.length}):`);
		for (const issue of impact.issues) {
			lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
		}
	}
	return lines.join("\n");
}

function renderMetafieldImpact(impact: ShopifyMetafieldImpact): string {
	const identifier = `${impact.identity.owner}.${impact.identity.namespace}.${impact.identity.key}`;
	const definition = impact.definition
		? impact.definition.type
			? `${impact.definition.type} (${impact.definition.id})`
			: impact.definition.id
		: "not found";
	const pulledAt = impact.snapshot.pulledAt
		? ` · pulled ${impact.snapshot.pulledAt}`
		: "";
	const lines = [
		`Metafield: ${identifier}`,
		"Scope: checked-out Liquid, Shopify JSON, and local JavaScript network calls; static GraphQL metafield requests included",
		"Opaque: remote app runtime, app-proxy/runtime responses, and server-side app data excluded",
		`Definition: ${definition}`,
		`Snapshot: ${impact.snapshot.state} · ${impact.snapshot.path}${pulledAt}`,
		`Certainty: ${impact.certainty}`,
		`Recognizable local JavaScript network calls indexed: ${impact.localNetworkAccessCount}`,
	];
	const readCountByPath = new Map<string, number>();
	for (const read of impact.reads) {
		readCountByPath.set(
			read.fromPath,
			(readCountByPath.get(read.fromPath) ?? 0) + 1,
		);
	}
	for (const read of impact.apiReads) {
		readCountByPath.set(
			read.fromPath,
			(readCountByPath.get(read.fromPath) ?? 0) + 1,
		);
	}
	const readers = impact.affectedSources.map((path) => {
		const count = readCountByPath.get(path) ?? 0;
		return `${path} (${count} ${count === 1 ? "read" : "reads"})`;
	});
	appendInspectList(lines, "Readers", readers);
	appendInspectList(
		lines,
		"Local API readers",
		impact.apiReads.map(
			(read) =>
				`${read.fromPath} (${read.transport}${read.endpoint ? ` · ${read.endpoint}` : ""})`,
		),
	);
	appendInspectList(lines, "Affected pages", impact.affectedPages);
	appendInspectList(lines, "Uncertainty", impact.uncertainty);
	if (impact.uncertainSources.length === 0) {
		lines.push("Uncertain sources: none");
	} else {
		lines.push(`Uncertain sources (${impact.uncertainSources.length}):`);
		for (const source of impact.uncertainSources) {
			lines.push(`- ${source.path}: ${source.reasons.join("; ")}`);
		}
	}
	return lines.join("\n");
}

function appendInspectList(
	lines: string[],
	label: string,
	values: readonly string[],
): void {
	if (values.length === 0) {
		lines.push(`${label}: none`);
		return;
	}
	lines.push(`${label} (${values.length}):`);
	for (const value of values) lines.push(`- ${value}`);
}

function renderInspectReport(graph: ShopifyInspection): string {
	const countKind = (kind: string): number =>
		graph.nodes.filter((node) => node.kind === kind).length;
	const pageCount = countKind("templateJson") + countKind("templateLiquid");
	const errorCount = graph.issues.filter(
		(issue) => issue.severity === "error",
	).length;
	const warningCount = graph.issues.filter(
		(issue) => issue.severity === "warning",
	).length;
	const lines = [
		`Theme graph: ${graph.nodes.length} files`,
		`Pages ${pageCount} · sections ${countKind("section")} · snippets ${countKind("snippet")} · components ${countKind("nazareComponent")}`,
		`Unresolved ${graph.summary.unresolvedCount} · metafield reads without definitions ${graph.summary.brokenMetafieldReadCount}`,
		`Affected pages ${graph.summary.affectedPageCount}`,
		`Issues ${graph.issues.length} (${errorCount} errors, ${warningCount} warnings)`,
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

function renderInspectionDot(graph: ShopifyInspection): string {
	const quote = (value: string): string => JSON.stringify(value);
	return [
		"digraph theme {",
		...graph.nodes.map(
			(node) => `  ${quote(node.id)} [label=${quote(node.path)}];`,
		),
		...graph.edges.map(
			(edge) =>
				`  ${quote(edge.from)} -> ${quote(edge.to)} [label=${quote(edge.kind)}];`,
		),
		"}",
	].join("\n");
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function writeDumpFiles(
	entryPath: string,
	result: ReturnType<typeof compileNazareArtifact>,
): Promise<string[]> {
	const outputDir = ".nazare-out";
	const base = artifactBaseName(entryPath);
	const schema = (await compiler()).themeSchemaFromIR(result.ir, {
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
	const { installComponent } = await import("./install.js");
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
	const { packComponent } = await import("./publish.js");
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
	const { publishComponent } = await import("./publish.js");
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
	const { installComponent, updateAll } = await import("./install.js");
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
	const { diffComponent } = await import("./install.js");
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
	const { registryFromEnv } = await registry();
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

function readCliVersion(): string {
	for (const url of [
		new URL("../../../VERSION", import.meta.url),
		new URL("../package.json", import.meta.url),
	]) {
		try {
			const value = readFileSync(fileURLToPath(url), "utf8").trim();
			if (url.pathname.endsWith("package.json")) {
				const packageMetadata = JSON.parse(value) as { version?: unknown };
				if (typeof packageMetadata.version === "string") {
					return packageMetadata.version;
				}
				throw new Error("CLI package version must be a string");
			}
			if (value.length > 0) return value;
		} catch (error) {
			if (isMissingFileError(error)) continue;
			throw error;
		}
	}
	throw new Error("Unable to determine Nazare CLI version");
}

function hasErrors(
	issues: readonly { severity: "error" | "warning" | "info" }[],
): boolean {
	return issues.some((issue) => issue.severity === "error");
}
