// Theme semantics the scanner deliberately does not know.
//
// A scanner reports what a file wrote. These tables say what it means: which
// roots are Shopify data, which names every scope already provides, and which
// reads or literals are evidence of a storefront capability. They live apart
// from both the reference extractor and the scanner adapter because both read
// them, and a second copy would be a second answer.
import type { ThemeEvidenceStrength } from "./theme-evidence-strength.js";

export const SHOPIFY_DATA_OBJECTS = new Set([
	"article",
	"blog",
	"company",
	"company_location",
	"product",
	"variant",
	"collection",
	"cart",
	"customer",
	"location",
	"market",
	"order",
	"page",
	"shop",
	"search",
	"recommendations",
	"localization",
	"linklists",
	"metafields",
	"metaobjects",
]);

// Names visible in every Liquid scope (globals, tag-scoped loop objects, and
// the theme-context objects Shopify injects everywhere). A bare read of any
// other unassigned name inside a snippet is a render input.
export const LIQUID_GLOBAL_NAMES = new Set([
	"additional_checkout_buttons",
	"all_products",
	"articles",
	"block",
	"blogs",
	"canonical_url",
	"cart",
	"checkout",
	"collections",
	"content_for_additional_checkout_buttons",
	"content_for_header",
	"content_for_index",
	"content_for_layout",
	"current_page",
	"current_tags",
	"customer",
	"forloop",
	"form",
	"handle",
	"images",
	"linklists",
	"localization",
	"metafields",
	"metaobjects",
	"page",
	"page_description",
	"page_title",
	"pages",
	"paginate",
	"powered_by_link",
	"predictive_search",
	"recommendations",
	"request",
	"routes",
	"scripts",
	"section",
	"settings",
	"shop",
	"tablerowloop",
	"template",
	"theme",
]);

export const ASSET_FILTER_NAMES = new Set(["asset_url", "asset_img_url"]);

export type LookupCapabilityRule = {
	capability: string;
	evidenceStrength: ThemeEvidenceStrength;
	matches: (object: string, propertyPath: string) => boolean;
};

export const lookupCapabilityRules: LookupCapabilityRule[] = [
	{
		capability: "addsToCart",
		evidenceStrength: "direct",
		matches: (object, path) => object === "routes" && path === "cart_add_url",
	},
	{
		capability: "updatesCart",
		evidenceStrength: "direct",
		matches: (object, path) =>
			object === "routes" &&
			(path === "cart_change_url" || path === "cart_update_url"),
	},
	{
		capability: "selectsVariants",
		evidenceStrength: "strong",
		matches: (object, path) =>
			object === "product" &&
			(/(^|\.)variants($|\.)/.test(path) ||
				path.startsWith("selected_or_first_available_variant")),
	},
	{
		capability: "performsPredictiveSearch",
		evidenceStrength: "direct",
		matches: (object) => object === "predictive_search",
	},
	{
		capability: "filtersCollections",
		evidenceStrength: "strong",
		matches: (object, path) =>
			(object === "collection" && /(^|\.)filters($|\.)/.test(path)) ||
			(object === "filter" && (path === "active_values" || path === "values")),
	},
	{
		capability: "displaysNavigation",
		evidenceStrength: "strong",
		matches: (object) => object === "linklists",
	},
];

// Signals only visible as literal text (form actions, input names, JS calls
// in inline <script>). These are heuristics by nature; they run over source
// with comments and raw/script/stylesheet bodies blanked so dead text can
// never signal, and they carry an explicit categorical evidence strength.
export const textCapabilityRules: Array<{
	capability: string;
	evidenceStrength: ThemeEvidenceStrength;
	pattern: RegExp;
}> = [
	{
		capability: "addsToCart",
		evidenceStrength: "direct",
		pattern: /\/cart\/add/g,
	},
	{
		capability: "updatesCart",
		evidenceStrength: "direct",
		pattern: /\/cart\/(?:change|update)/g,
	},
	{
		capability: "selectsVariants",
		evidenceStrength: "strong",
		pattern: /name=["']id["']/g,
	},
	{
		capability: "performsPredictiveSearch",
		evidenceStrength: "direct",
		pattern: /(?:predictive_search|\/search\/suggest)/g,
	},
	{
		capability: "switchesLocalization",
		evidenceStrength: "direct",
		pattern:
			/(?:form\s+['"]localization['"]|localization\.country|localization\.language)/g,
	},
];
