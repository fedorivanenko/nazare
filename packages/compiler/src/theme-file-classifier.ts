import { baseNameOf } from "./paths.js";

export type ThemeFileKind =
	| "section"
	| "snippet"
	| "templateJson"
	| "templateLiquid"
	| "layout"
	| "locale"
	| "asset"
	| "settingsSchema"
	| "settingsData"
	| "nazareComponent"
	| "other";

export function normalizeThemePath(path: string): string {
	let normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
	while (normalized.includes("//"))
		normalized = normalized.replaceAll("//", "/");
	if (normalized === ".") return "";
	return normalized;
}

export function isUnsafeThemePath(path: string): boolean {
	const normalized = normalizeThemePath(path);
	return (
		normalized.startsWith("/") ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.includes("/../")
	);
}

export function classifyThemeFile(path: string): ThemeFileKind {
	const normalized = normalizeThemePath(path);
	if (normalized.endsWith(".nz.liquid")) return "nazareComponent";
	if (/^sections\/[^/]+\.liquid$/.test(normalized)) return "section";
	if (/^snippets\/[^/]+\.liquid$/.test(normalized)) return "snippet";
	if (/^templates\/.+\.json$/.test(normalized)) return "templateJson";
	if (/^templates\/.+\.liquid$/.test(normalized)) return "templateLiquid";
	if (/^layout\/[^/]+\.liquid$/.test(normalized)) return "layout";
	if (/^locales\/[^/]+\.json$/.test(normalized)) return "locale";
	if (normalized.startsWith("assets/")) return "asset";
	if (normalized === "config/settings_schema.json") return "settingsSchema";
	if (normalized === "config/settings_data.json") return "settingsData";
	return "other";
}

/** The theme-facing name of a file: its basename, known extensions stripped. */
export function themeNameFromPath(path: string): string {
	return baseNameOf(normalizeThemePath(path));
}
