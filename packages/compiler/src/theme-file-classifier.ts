import { baseNameOf } from "./paths.js";

export type ThemeFileKind =
	| "section"
	| "sectionGroup"
	| "snippet"
	| "themeBlock"
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
	const segments = normalized.split("/");
	return (
		normalized.length === 0 ||
		normalized.startsWith("/") ||
		/^[A-Za-z]:\//.test(normalized) ||
		normalized.endsWith("/") ||
		[...normalized].some((character) => {
			const code = character.charCodeAt(0);
			return code <= 31 || code === 127;
		}) ||
		segments.some((segment) => segment === "." || segment === "..")
	);
}

export function classifyThemeFile(path: string): ThemeFileKind {
	const normalized = normalizeThemePath(path);
	if (normalized.endsWith(".nz.liquid")) return "nazareComponent";
	if (/^sections\/[^/]+\.liquid$/.test(normalized)) return "section";
	if (/^sections\/[^/]+\.json$/.test(normalized)) return "sectionGroup";
	if (/^snippets\/[^/]+\.liquid$/.test(normalized)) return "snippet";
	if (/^blocks\/[^/]+\.liquid$/.test(normalized)) return "themeBlock";
	if (/^templates\/.+\.json$/.test(normalized)) return "templateJson";
	if (/^templates\/.+\.liquid$/.test(normalized)) return "templateLiquid";
	if (/^layout\/[^/]+\.liquid$/.test(normalized)) return "layout";
	if (/^locales\/[^/]+\.json$/.test(normalized)) return "locale";
	if (normalized.startsWith("assets/")) return "asset";
	if (normalized === "config/settings_schema.json") return "settingsSchema";
	if (normalized === "config/settings_data.json") return "settingsData";
	return "other";
}

/**
 * The theme-facing name of a file: its basename, known extensions stripped.
 * Matches how Liquid addresses these entities — `{% section 'main-product' %}`,
 * `{% render 'price' %}`, `{{ 'shop.title' | t }}`. Not for assets: see
 * themeAssetNameFromPath.
 */
export function themeNameFromPath(path: string): string {
	return baseNameOf(normalizeThemePath(path));
}

/**
 * The theme-facing name of an asset: its full basename, extension included,
 * because that is how Liquid addresses one — `{{ 'theme.css' | asset_url }}`.
 * Stripping the extension collapsed every theme.css/theme.js pair into one
 * name and reported the two files as duplicate declarations of `theme`.
 */
export function themeAssetNameFromPath(path: string): string {
	const normalized = normalizeThemePath(path);
	return normalized.split("/").at(-1) ?? normalized;
}
