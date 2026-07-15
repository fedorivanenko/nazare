import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { NazareExtensionRegistration } from "@nazare/compiler";
import { buildTheme } from "@nazare/theme";
import type { CliOptions } from "./options.js";
import type { Output } from "./output.js";

const THEME_MANIFEST = "nazare.theme.json";
const EXTENSIONS_DIR = "nazare.extensions";

/** Project config, read from nazare.theme.json. */
type ThemeBuildConfig = { outDir?: string; sourceRoot?: string };
type ThemeExtensionConfig = string | { module?: string; options?: unknown };
type ThemeProjectConfig = {
	build?: ThemeBuildConfig;
	extensions?: ThemeExtensionConfig[];
};

async function readProjectConfig(
	projectRoot: string,
): Promise<ThemeProjectConfig> {
	const raw = await readFile(join(projectRoot, THEME_MANIFEST), "utf8").catch(
		() => undefined,
	);
	if (raw === undefined) return {};
	try {
		const parsed = JSON.parse(raw) as ThemeProjectConfig;
		validateProjectConfig(parsed);
		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`nazare.theme.json is not valid JSON: ${error.message}`);
		}
		throw error;
	}
}

function validateProjectConfig(config: ThemeProjectConfig): void {
	if (config.build !== undefined) {
		if (!config.build || typeof config.build !== "object") {
			throw new Error("nazare.theme.json build must be an object");
		}
		if (
			config.build.sourceRoot !== undefined &&
			typeof config.build.sourceRoot !== "string"
		) {
			throw new Error("nazare.theme.json build.sourceRoot must be a string");
		}
		if (
			config.build.outDir !== undefined &&
			typeof config.build.outDir !== "string"
		) {
			throw new Error("nazare.theme.json build.outDir must be a string");
		}
	}
	if (config.extensions !== undefined && !Array.isArray(config.extensions)) {
		throw new Error("nazare.theme.json extensions must be an array");
	}
}

// Merchant-owned data the Shopify theme editor writes back. `nazare build
// --pull` fetches only these into the output dir so buildTheme can carry the
// live theme's settings, section instances, and block values forward. Code is
// regenerated from source, so there is no reason to pull it.
const MERCHANT_DATA_PATTERNS = [
	"config/settings_data.json",
	"templates/*.json",
	"templates/**/*.json",
	"sections/*.json",
];

/**
 * Compiles every `.nz.liquid` component under a source root into one theme
 * output. Discovery is by file extension alone — no nazare.json is read — so a
 * folder whose entry is a plain `.ts` (a function, imported but never emitted)
 * is pulled in as a dependency, not built as a standalone artifact. Always
 * returns a process-style exit code.
 */
export async function runThemeBuild(
	projectRoot: string,
	target: string | undefined,
	cliOptions: CliOptions,
	output: Output = console,
): Promise<number> {
	try {
		// Both paths are explicit: an explicit CLI flag/positional wins, else the
		// nazare.theme.json `build` config. There is no hardcoded default — an
		// unset path is an error, not a silent `.nazare-out/theme`.
		const config = await readProjectConfig(projectRoot);
		const sourceRoot =
			target ?? cliOptions.sourceRoot ?? config.build?.sourceRoot;
		const outDir = cliOptions.outDir ?? config.build?.outDir;
		if (!sourceRoot) {
			throw new Error(
				'No source root. Pass it as `nazare build <source-root>` or --source-root, or set "build": { "sourceRoot": "…" } in nazare.theme.json.',
			);
		}
		if (!outDir) {
			throw new Error(
				'No output directory. Pass --out-dir, or set "build": { "outDir": "…" } in nazare.theme.json.',
			);
		}
		// Reconcile against a live theme: pull its merchant-owned data into the
		// output dir first, so buildTheme snapshots and preserves it instead of
		// resetting it to the source seeds.
		if (cliOptions.pull) {
			const outDirAbs = join(projectRoot, outDir);
			await mkdir(outDirAbs, { recursive: true });
			pullThemeData(
				outDirAbs,
				{
					store: cliOptions.store,
					theme: cliOptions.theme,
				},
				output,
			);
		}
		const result = await buildTheme({
			projectRoot,
			sourceRoot,
			outDir,
			strictness: cliOptions.strictness,
			extensions: await loadExtensions(projectRoot, config.extensions ?? []),
			// Key the run-once migrations ledger by the pulled store/theme so each
			// target tracks its own applied history; falls back to the output dir.
			targetId:
				[cliOptions.store, cliOptions.theme].filter(Boolean).join("#") ||
				undefined,
		});
		if (cliOptions.json) {
			output.log(
				JSON.stringify({ ...result, components: result.compiled }, null, 2),
			);
		} else {
			printBuildSummary(result, outDir, output);
		}
		return hasErrors(result.issues) || result.conflicts.length > 0 ? 1 : 0;
	} catch (error) {
		output.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function loadExtensions(
	projectRoot: string,
	configs: ThemeExtensionConfig[],
): Promise<NazareExtensionRegistration[]> {
	const loaded: NazareExtensionRegistration[] = [];
	for (const config of configs) {
		if (typeof config !== "string" && (!config || typeof config !== "object")) {
			throw new Error("Extension config must be a module path or object");
		}
		const modulePath = typeof config === "string" ? config : config.module;
		if (!modulePath || typeof modulePath !== "string") {
			throw new Error("Extension config needs a module path");
		}
		assertAllowedExtensionModule(projectRoot, modulePath);
		const moduleUrl = pathToFileURL(resolve(projectRoot, modulePath)).href;
		// Fine for a one-shot build. Node caches modules by URL, so a future
		// watch/dev mode that reloads an edited extension will need a cache-busting
		// URL (e.g. a `?v=<mtime>` query) to pick up changes.
		const imported = (await import(moduleUrl)) as { default?: unknown };
		const extension = imported.default;
		if (!extension || typeof extension !== "object") {
			throw new Error(`${modulePath} must default-export a Nazare extension`);
		}
		const name = (extension as { name?: unknown }).name;
		if (typeof name !== "string" || name.length === 0) {
			throw new Error(`${modulePath} extension needs a non-empty name`);
		}
		const emit = (extension as { emit?: unknown }).emit;
		if (emit !== undefined && typeof emit !== "function") {
			throw new Error(`${modulePath} extension emit must be a function`);
		}
		loaded.push({
			extension: extension as NazareExtensionRegistration["extension"],
			options: typeof config === "string" ? undefined : config.options,
		});
	}
	return loaded;
}

function assertAllowedExtensionModule(
	projectRoot: string,
	modulePath: string,
): void {
	const extensionPrefix = `./${EXTENSIONS_DIR}/`;
	if (!modulePath.startsWith(extensionPrefix)) {
		throw new Error(
			`Extension modules must live under ${extensionPrefix}: ${modulePath}`,
		);
	}
	if (extname(modulePath) !== ".mjs") {
		throw new Error(`Extension modules must be .mjs files: ${modulePath}`);
	}
	const resolved = resolve(projectRoot, modulePath);
	const allowedRoot = resolve(projectRoot, EXTENSIONS_DIR);
	const relativePath = relative(allowedRoot, resolved);
	if (
		relativePath === "" ||
		relativePath.startsWith("..") ||
		relativePath.startsWith(sep)
	) {
		throw new Error(
			`Extension modules must stay under ./${EXTENSIONS_DIR}/: ${modulePath}`,
		);
	}
}

// Human-readable build summary. Leads with what was produced, then the
// reconciliation outcomes (what was kept from the live theme, migrated, or
// merged), then warnings and errors. `--json` prints the raw result instead.
function printBuildSummary(
	result: Awaited<ReturnType<typeof buildTheme>>,
	outDir: string,
	output: Output,
): void {
	const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
	const errors = result.issues.filter((i) => i.severity === "error");
	const warnings = result.issues.filter((i) => i.severity === "warning");

	const lines: string[] = [
		`Built ${count(result.compiled.length, "component")} → ${count(result.written.length, "file")} in ${outDir}`,
	];

	const recon: string[] = [];
	if (result.preserved.length || result.seeded.length)
		recon.push(
			`data: ${result.preserved.length} preserved, ${result.seeded.length} seeded`,
		);
	if (result.applied.length)
		recon.push(`migrations applied: ${result.applied.join(", ")}`);
	if (result.mergedLocales.length)
		recon.push(`locales: ${count(result.mergedLocales.length, "file")} merged`);
	if (recon.length) lines.push(`  ${recon.join("  ·  ")}`);

	for (const conflict of result.conflicts)
		lines.push(`  ✖ conflict: ${conflict}`);
	for (const warning of warnings) lines.push(`  ⚠ ${warning.message}`);
	for (const error of errors) lines.push(`  ✖ ${error.message}`);

	if (errors.length || result.conflicts.length)
		lines.push(
			`Build failed: ${count(errors.length, "error")}, ${count(result.conflicts.length, "conflict")}`,
		);
	else if (warnings.length)
		lines.push(`Build OK with ${count(warnings.length, "warning")}`);
	else lines.push("Build OK");

	output.log(lines.join("\n"));
}

/**
 * Pulls a live theme's merchant-owned data into `outDir` via the Shopify CLI so
 * the following build preserves it. Only data files are fetched (`--only`);
 * generated code is regenerated from source. Throws with an actionable message
 * when the CLI is missing or the pull fails.
 */
function pullThemeData(
	outDir: string,
	options: { store?: string; theme?: string },
	output: Output,
): void {
	const args = ["theme", "pull", "--path", outDir];
	if (options.store) args.push("--store", options.store);
	if (options.theme) args.push("--theme", options.theme);
	for (const pattern of MERCHANT_DATA_PATTERNS) args.push("--only", pattern);

	output.error(`Pulling live theme data: shopify ${args.join(" ")}`);
	const result = spawnSync("shopify", args, { stdio: "inherit" });
	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			throw new Error(
				"--pull needs the Shopify CLI. Install it (https://shopify.dev/docs/api/shopify-cli) or drop --pull to build without reconciling.",
			);
		}
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`shopify theme pull failed (exit ${result.status ?? "unknown"}). Check --store/--theme and your Shopify auth.`,
		);
	}
}

function hasErrors(
	issues: { severity: "error" | "warning" | "info" }[],
): boolean {
	return issues.some((issue) => issue.severity === "error");
}
