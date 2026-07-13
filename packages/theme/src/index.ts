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
			copied.push(file);
			planFile(planned, conflicts, outputPath, contents, file);
		}
	}

	const outputRoot = join(projectRoot, outDir);
	await rm(outputRoot, { recursive: true, force: true });
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
		written,
		issues,
		notes,
		conflicts,
	};
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
