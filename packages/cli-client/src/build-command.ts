import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTheme } from "@nazare/theme";
import type { CliOptions } from "./options.js";

const THEME_MANIFEST = "nazare.theme.json";

/** The build paths are project config, read from nazare.theme.json `build`. */
type ThemeBuildConfig = { outDir?: string; sourceRoot?: string };

async function readBuildConfig(projectRoot: string): Promise<ThemeBuildConfig> {
	const raw = await readFile(join(projectRoot, THEME_MANIFEST), "utf8").catch(
		() => undefined,
	);
	if (raw === undefined) return {};
	try {
		const parsed = JSON.parse(raw) as { build?: ThemeBuildConfig };
		return parsed.build ?? {};
	} catch {
		return {};
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
 * terminates via process.exit.
 */
export async function runThemeBuild(
	projectRoot: string,
	target: string | undefined,
	cliOptions: CliOptions,
): Promise<void> {
	try {
		// Both paths are explicit: an explicit CLI flag/positional wins, else the
		// nazare.theme.json `build` config. There is no hardcoded default — an
		// unset path is an error, not a silent `.nazare-out/theme`.
		const config = await readBuildConfig(projectRoot);
		const sourceRoot = target ?? cliOptions.sourceRoot ?? config.sourceRoot;
		const outDir = cliOptions.outDir ?? config.outDir;
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
			pullThemeData(outDirAbs, {
				store: cliOptions.store,
				theme: cliOptions.theme,
			});
		}
		const result = await buildTheme({
			projectRoot,
			sourceRoot,
			outDir,
			strictness: cliOptions.strictness,
			// Key the run-once migrations ledger by the pulled store/theme so each
			// target tracks its own applied history; falls back to the output dir.
			targetId:
				[cliOptions.store, cliOptions.theme].filter(Boolean).join("#") ||
				undefined,
		});
		if (cliOptions.json) {
			console.log(
				JSON.stringify({ ...result, components: result.compiled }, null, 2),
			);
		} else {
			printBuildSummary(result, outDir);
		}
		process.exit(
			hasErrors(result.issues) || result.conflicts.length > 0 ? 1 : 0,
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

// Human-readable build summary. Leads with what was produced, then the
// reconciliation outcomes (what was kept from the live theme, migrated, or
// merged), then warnings and errors. `--json` prints the raw result instead.
function printBuildSummary(
	result: Awaited<ReturnType<typeof buildTheme>>,
	outDir: string,
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

	console.log(lines.join("\n"));
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
): void {
	const args = ["theme", "pull", "--path", outDir];
	if (options.store) args.push("--store", options.store);
	if (options.theme) args.push("--theme", options.theme);
	for (const pattern of MERCHANT_DATA_PATTERNS) args.push("--only", pattern);

	console.error(`Pulling live theme data: shopify ${args.join(" ")}`);
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
