import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export function validateInspectConfiguration(configured: unknown): string[] {
	if (configured === undefined) return [];
	if (
		!configured ||
		typeof configured !== "object" ||
		Array.isArray(configured)
	) {
		throw new Error('"inspect" in nazare.theme.json must be an object');
	}
	const exclude = (configured as Record<string, unknown>).exclude;
	if (exclude === undefined) return [];
	if (
		!Array.isArray(exclude) ||
		exclude.some((pattern) => typeof pattern !== "string" || !pattern)
	) {
		throw new Error(
			'"inspect.exclude" in nazare.theme.json must be an array of non-empty theme-relative glob strings',
		);
	}
	return exclude;
}

export async function readInspectExcludePatterns(
	projectRoot: string,
): Promise<string[]> {
	const manifestPath = join(projectRoot, "nazare.theme.json");
	let raw: string;
	try {
		raw = await readFile(manifestPath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw new Error(
			`Unable to read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Invalid JSON in ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${manifestPath} must contain a JSON object`);
	}
	return validateInspectConfiguration(
		(parsed as Record<string, unknown>).inspect,
	);
}

export async function readOptionalInspectArtifact(
	projectRoot: string,
	path: string,
): Promise<{ path: string; contents: string } | undefined> {
	try {
		return { path, contents: await readFile(join(projectRoot, path), "utf8") };
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw new Error(
			`Unable to read inspect artifact ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function isMissingFileError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

const MAX_CONCURRENT_INSPECT_FILE_READS = 32;

export async function collectThemeInputFiles(
	root: string,
	projectRoot: string,
): Promise<{ path: string; contents: string }[]> {
	const ignoredDirectories = new Set([
		"node_modules",
		".git",
		"dist",
		".nazare-out",
	]);
	const candidates: { path: string; absolutePath: string }[] = [];
	async function walk(directory: string): Promise<void> {
		const entries = await readdir(directory, { withFileTypes: true });
		await Promise.all(
			entries.map(async (entry) => {
				if (ignoredDirectories.has(entry.name)) return;
				const absolutePath = join(directory, entry.name);
				if (entry.isDirectory()) {
					await walk(absolutePath);
					return;
				}
				if (!entry.isFile()) return;
				const path = relative(root, absolutePath).split(sep).join("/");
				if (isInspectThemeFile(path)) candidates.push({ path, absolutePath });
			}),
		);
	}
	const rootStat = await stat(root);
	if (rootStat.isFile()) {
		const path = relative(projectRoot, root).split(sep).join("/");
		if (isInspectThemeFile(path)) candidates.push({ path, absolutePath: root });
	} else if (rootStat.isDirectory()) {
		await walk(root);
	} else {
		throw new Error(`Inspect root is neither a file nor a directory: ${root}`);
	}
	candidates.sort((a, b) => a.path.localeCompare(b.path));
	return mapConcurrent(
		candidates,
		MAX_CONCURRENT_INSPECT_FILE_READS,
		async ({ path, absolutePath }) => ({
			path,
			contents: shouldReadInspectContents(path)
				? await readFile(absolutePath, "utf8")
				: "",
		}),
	);
}

export function isInspectThemeFile(path: string): boolean {
	return shouldReadInspectContents(path) || path.startsWith("assets/");
}

function shouldReadInspectContents(path: string): boolean {
	return (
		path.endsWith(".nz.liquid") ||
		/^sections\/[^/]+\.(json|liquid)$/.test(path) ||
		/^snippets\/[^/]+\.liquid$/.test(path) ||
		/^blocks\/[^/]+\.liquid$/.test(path) ||
		/^templates\/.+\.(json|liquid)$/.test(path) ||
		/^layout\/[^/]+\.liquid$/.test(path) ||
		/^locales\/[^/]+\.json$/.test(path) ||
		path === "config/settings_schema.json" ||
		path === "config/settings_data.json"
	);
}

async function mapConcurrent<Input, OutputValue>(
	values: Input[],
	concurrency: number,
	map: (value: Input) => Promise<OutputValue>,
): Promise<OutputValue[]> {
	const results = new Array<OutputValue>(values.length);
	let nextIndex = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, values.length) },
		async () => {
			while (nextIndex < values.length) {
				const index = nextIndex++;
				results[index] = await map(values[index] as Input);
			}
		},
	);
	await Promise.all(workers);
	return results;
}
