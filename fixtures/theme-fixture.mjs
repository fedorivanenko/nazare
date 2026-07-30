import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES_ROOT = dirname(fileURLToPath(import.meta.url));
export const CANONICAL_THEME_ROOT = join(FIXTURES_ROOT, "canonical-theme");

const EXCLUDED_NAMES = new Set([
	".git",
	".nazare-out",
	"node_modules",
	".DS_Store",
]);

/** Mirrors the CLI's theme-input boundary for fixture and benchmark tooling. */
export function isThemeInputPath(path) {
	return isParsedThemeInputPath(path) || path.startsWith("assets/");
}

export function isParsedThemeInputPath(path) {
	return (
		path.endsWith(".nz.liquid") ||
		/\.(?:css|js|ts)$/.test(path) ||
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

export function themeInputPaths(root = CANONICAL_THEME_ROOT) {
	return walkFiles(resolve(root))
		.map((path) => relative(resolve(root), path).split(sep).join("/"))
		.filter(isThemeInputPath)
		.sort(compareAscii);
}

/** Load the exact compiler input represented by a fixture theme. */
export function loadThemeFixture(root = CANONICAL_THEME_ROOT) {
	const absoluteRoot = resolve(root);
	return themeInputPaths(absoluteRoot).map((path) => ({
		path,
		contents: isParsedThemeInputPath(path)
			? readFileSync(join(absoluteRoot, ...path.split("/")), "utf8")
			: "",
	}));
}

function walkFiles(root) {
	const files = [];
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (EXCLUDED_NAMES.has(entry.name)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) files.push(path);
		}
	};
	visit(root);
	return files;
}

function compareAscii(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
