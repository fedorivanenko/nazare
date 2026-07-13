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
	parseNazareLiquid,
} from "@nazare/compiler";
import type { Diagnostic } from "@nazare/core";

const DEFAULT_SOURCE_ROOT = "nazare";
const DEFAULT_OUT_DIR = ".nazare-out/theme";
const THEME_DIRS = new Set([
	"layout",
	"templates",
	"sections",
	"snippets",
	"assets",
	"config",
	"locales",
]);

export type ThemeBuildOptions = {
	projectRoot: string;
	sourceRoot?: string;
	outDir?: string;
	strictness?: "loose" | "strict";
};

export type ThemeBuildResult = {
	compiled: string[];
	copied: string[];
	seeded: string[];
	preserved: string[];
	written: string[];
	issues: Diagnostic[];
	notes: Diagnostic[];
	conflicts: string[];
};

type PlannedFile = { contents: string; from: string };

export async function buildTheme(
	options: ThemeBuildOptions,
): Promise<ThemeBuildResult> {
	const projectRoot = options.projectRoot;
	const sourceRoot = options.sourceRoot ?? DEFAULT_SOURCE_ROOT;
	const outDir = options.outDir ?? DEFAULT_OUT_DIR;
	const rootAbs = resolve(projectRoot, sourceRoot);
	const rootStat = await stat(rootAbs).catch(() => undefined);
	if (!rootStat) throw new Error(`Source path not found: ${sourceRoot}`);

	const sourceFiles = rootStat.isFile()
		? [toRootRelativePosix(projectRoot, rootAbs)]
		: await collectSourceFiles(projectRoot, sourceRoot);

	const readProjectFile = (path: string): string | undefined => {
		try {
			return readFileSync(join(projectRoot, path), "utf8");
		} catch {
			return undefined;
		}
	};

	const planned = new Map<string, PlannedFile>();
	// Merchant-owned data files (settings values, section instances, block
	// values) discovered in the source tree. These are only seeds: they populate
	// the output when the target has no value yet, but an existing target's copy
	// wins so a rebuild never resets live theme state edited in the Shopify admin.
	const seeds = new Map<string, PlannedFile>();
	const conflicts: string[] = [];
	const issues: Diagnostic[] = [];
	const notes: Diagnostic[] = [];
	const compiled: string[] = [];
	const copied: string[] = [];

	for (const file of sourceFiles) {
		const sourceRelative = relativeSourcePath(sourceRoot, file);
		const contents = await readFile(join(projectRoot, file), "utf8");

		if (file.endsWith(".nz.liquid")) {
			compiled.push(file);
			const built = buildNazareTheme(contents, file, {
				name: artifactBaseName(file),
				readFile: readProjectFile,
				strictness: options.strictness,
			});
			issues.push(
				...built.issues,
				...checkComponentScripts(built.ir, { readFile: readProjectFile }),
			);
			notes.push(...built.notes);
			for (const themeFile of built.emitted.files) {
				planFile(planned, conflicts, themeFile.path, themeFile.contents, file);
			}
			continue;
		}

		if (isPlainLiquidThemeFile(sourceRelative)) {
			const parsed = parseNazareLiquid(contents, file);
			issues.push(
				...parsed.diagnostics.map((issue) => ({
					...issue,
					phase: "parse" as const,
				})),
			);
			notes.push(
				...parsed.notes.map((note) => ({ ...note, phase: "parse" as const })),
			);
		}

		if (file.endsWith(".json")) {
			const invalid = validateJson(contents, file);
			if (invalid) issues.push(invalid);
		}

		const outputPath = outputPathForSource(sourceRelative);
		if (outputPath) {
			if (isMerchantDataPath(outputPath)) {
				seeds.set(outputPath, { contents, from: file });
			} else {
				copied.push(file);
				planFile(planned, conflicts, outputPath, contents, file);
			}
		}
	}

	const outputRoot = join(projectRoot, outDir);

	// Snapshot merchant-owned data already in the target before clearing it, so
	// the rebuild carries live theme state forward rather than the source seeds.
	const existingData = await readExistingData(outputRoot);

	await rm(outputRoot, { recursive: true, force: true });

	const seeded: string[] = [];
	const preserved: string[] = [];
	for (const path of new Set([...existingData.keys(), ...seeds.keys()])) {
		const live = existingData.get(path);
		if (live !== undefined) {
			planned.set(path, { contents: live, from: "<target>" });
			preserved.push(path);
			if (seeds.has(path)) {
				notes.push({
					severity: "info",
					phase: "emit",
					code: "THEME_DATA_PRESERVED",
					message: `${path}: kept the target's data; source is only a seed once the theme exists`,
				});
			}
			continue;
		}
		const seed = seeds.get(path);
		if (seed) {
			planned.set(path, seed);
			seeded.push(path);
		}
	}

	const written: string[] = [];
	for (const path of [...planned.keys()].sort()) {
		const full = join(outputRoot, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, planned.get(path)?.contents ?? "");
		written.push(join(outDir, path));
	}

	return {
		compiled: compiled.sort(),
		copied: copied.sort(),
		seeded: seeded.sort(),
		preserved: preserved.sort(),
		written,
		issues,
		notes,
		conflicts,
	};
}

// Files the Shopify theme editor writes back on the merchant's behalf: setting
// values, section instances and their order, block values, and section groups.
// These belong to the live theme, not the source repo — the compiler never
// emits them, so preserving them across a rebuild is safe.
function isMerchantDataPath(path: string): boolean {
	if (path === "config/settings_data.json") return true;
	if (path.startsWith("templates/") && path.endsWith(".json")) return true;
	// Section groups live at the top level of sections/ (e.g. header-group.json);
	// nested paths under sections/ are not a Shopify concept, so require a flat name.
	if (
		path.startsWith("sections/") &&
		path.endsWith(".json") &&
		!path.slice("sections/".length).includes("/")
	) {
		return true;
	}
	return false;
}

// Reads the merchant-owned data files already present in the output directory.
// Returns an empty map when the directory does not exist (a first build).
async function readExistingData(
	outputRoot: string,
): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const walk = async (dir: string, base: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const dirent of entries) {
			const full = join(dir, dirent.name);
			const rel = base ? `${base}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				await walk(full, rel);
			} else if (dirent.isFile() && isMerchantDataPath(rel)) {
				found.set(rel, await readFile(full, "utf8"));
			}
		}
	};
	await walk(outputRoot, "");
	return found;
}

async function collectSourceFiles(
	projectRoot: string,
	sourceRoot: string,
): Promise<string[]> {
	const rootAbs = resolve(projectRoot, sourceRoot);
	const found: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const dirent of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				await walk(full);
			} else if (dirent.isFile()) {
				found.push(toRootRelativePosix(projectRoot, full));
			}
		}
	};
	await walk(rootAbs);
	return found.sort();
}

function outputPathForSource(sourceRelative: string): string | undefined {
	const [top] = sourceRelative.split("/");
	if (!top) return undefined;
	if (THEME_DIRS.has(top)) return sourceRelative;
	return undefined;
}

function isPlainLiquidThemeFile(sourceRelative: string): boolean {
	return (
		sourceRelative.endsWith(".liquid") && !sourceRelative.endsWith(".nz.liquid")
	);
}

function relativeSourcePath(sourceRoot: string, file: string): string {
	const prefix = `${sourceRoot.replace(/\/$/, "")}/`;
	return file.startsWith(prefix) ? file.slice(prefix.length) : basename(file);
}

function planFile(
	planned: Map<string, PlannedFile>,
	conflicts: string[],
	path: string,
	contents: string,
	from: string,
): void {
	const existing = planned.get(path);
	if (existing && existing.contents !== contents) {
		conflicts.push(`${path}: emitted by both ${existing.from} and ${from}`);
		return;
	}
	planned.set(path, { contents, from });
}

function validateJson(contents: string, file: string): Diagnostic | undefined {
	try {
		JSON.parse(contents);
		return undefined;
	} catch (error) {
		return {
			severity: "error",
			phase: "parse",
			code: "THEME_INVALID_JSON",
			message: `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
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
