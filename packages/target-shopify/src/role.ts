export type ShopifyFileRole =
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

export function classifyShopifyFile(path: string): ShopifyFileRole {
	if (path.endsWith(".nz.liquid")) return "nazareComponent";
	if (/^sections\/[^/]+\.liquid$/.test(path)) return "section";
	if (/^sections\/[^/]+\.json$/.test(path)) return "sectionGroup";
	if (/^snippets\/[^/]+\.liquid$/.test(path)) return "snippet";
	if (/^blocks\/[^/]+\.liquid$/.test(path)) return "themeBlock";
	if (/^templates\/.+\.json$/.test(path)) return "templateJson";
	if (/^templates\/.+\.liquid$/.test(path)) return "templateLiquid";
	if (/^layout\/[^/]+\.liquid$/.test(path)) return "layout";
	if (/^locales\/[^/]+\.json$/.test(path)) return "locale";
	if (path.startsWith("assets/")) return "asset";
	if (path === "config/settings_schema.json") return "settingsSchema";
	if (path === "config/settings_data.json") return "settingsData";
	return "other";
}

export function shopifyResourceName(path: string): string {
	const name = path.split("/").at(-1) ?? path;
	return name.replace(/\.nz\.liquid$|\.liquid$|\.json$/, "");
}
