import {
	strongerThemeEvidence,
	type ThemeEvidenceStrength,
} from "./theme-evidence-strength.js";
import type {
	ThemeCapabilityRecord,
	ThemeCapabilitySignalRecord,
	ThemeClassificationRecord,
	ThemeDataAccessRecord,
} from "./theme-facts.js";

type AccessCapabilityRule = {
	name: string;
	evidenceStrength: ThemeEvidenceStrength;
	matches: (access: ThemeDataAccessRecord) => boolean;
};

const ACCESS_CAPABILITY_RULES: AccessCapabilityRule[] = [
	{
		name: "displaysProductPrice",
		evidenceStrength: "direct",
		matches: (access) =>
			access.object === "product" && access.propertyPath === "price",
	},
	{
		name: "displaysProductMedia",
		evidenceStrength: "strong",
		matches: (access) =>
			access.object === "product" &&
			/(^|\.)(featured_image|media|images)$/.test(access.propertyPath ?? ""),
	},
	{
		name: "displaysCartItems",
		evidenceStrength: "direct",
		matches: (access) =>
			access.object === "cart" && /(^|\.)items/.test(access.propertyPath ?? ""),
	},
	{
		name: "usesCart",
		evidenceStrength: "suggestive",
		matches: (access) => access.object === "cart",
	},
	{
		name: "usesSearch",
		evidenceStrength: "suggestive",
		matches: (access) => access.object === "search",
	},
	{
		name: "displaysRecommendations",
		evidenceStrength: "strong",
		matches: (access) => access.object === "recommendations",
	},
	{
		name: "usesLocalization",
		evidenceStrength: "strong",
		matches: (access) => access.object === "localization",
	},
];

type ClassificationRule = {
	label: string;
	evidenceStrength: ThemeEvidenceStrength;
	evidenceCapabilities: string[];
	evidenceDataExpressions?: string[];
	matches: (capabilities: Set<string>, data: Set<string>) => boolean;
	uncertainty: string[];
};

const CLASSIFICATION_RULES: ClassificationRule[] = [
	{
		label: "productForm",
		evidenceStrength: "direct",
		evidenceCapabilities: ["addsToCart", "selectsVariants"],
		matches: (capabilities) =>
			capabilities.has("addsToCart") && capabilities.has("selectsVariants"),
		uncertainty: [],
	},
	{
		label: "productCard",
		evidenceStrength: "suggestive",
		evidenceCapabilities: ["displaysProductPrice", "displaysProductMedia"],
		evidenceDataExpressions: ["product.title"],
		matches: (capabilities, data) =>
			capabilities.has("displaysProductPrice") &&
			(capabilities.has("displaysProductMedia") || data.has("product.title")),
		uncertainty: ["could be full product section"],
	},
	{
		label: "cartDrawer",
		evidenceStrength: "suggestive",
		evidenceCapabilities: ["updatesCart", "displaysCartItems"],
		matches: (capabilities) =>
			capabilities.has("updatesCart") || capabilities.has("displaysCartItems"),
		uncertainty: ["cart page and drawer share signals"],
	},
	{
		label: "searchOverlay",
		evidenceStrength: "strong",
		evidenceCapabilities: ["performsPredictiveSearch"],
		matches: (capabilities) => capabilities.has("performsPredictiveSearch"),
		uncertainty: [],
	},
	{
		label: "collectionGrid",
		evidenceStrength: "suggestive",
		evidenceCapabilities: ["filtersCollections"],
		matches: (capabilities) => capabilities.has("filtersCollections"),
		uncertainty: [],
	},
	{
		label: "localizationSelector",
		evidenceStrength: "strong",
		evidenceCapabilities: ["switchesLocalization"],
		matches: (capabilities) => capabilities.has("switchesLocalization"),
		uncertainty: [],
	},
	{
		label: "productGallery",
		evidenceStrength: "suggestive",
		evidenceCapabilities: ["displaysProductMedia"],
		matches: (capabilities) => capabilities.has("displaysProductMedia"),
		uncertainty: ["single product image and media gallery share signals"],
	},
	{
		label: "recommendations",
		evidenceStrength: "strong",
		evidenceCapabilities: ["displaysRecommendations"],
		matches: (capabilities) => capabilities.has("displaysRecommendations"),
		uncertainty: [],
	},
	{
		label: "navigation",
		evidenceStrength: "strong",
		evidenceCapabilities: ["displaysNavigation"],
		matches: (capabilities) => capabilities.has("displaysNavigation"),
		uncertainty: [],
	},
];

export function inferCapabilities(
	dataAccesses: ThemeDataAccessRecord[],
	capabilitySignals: ThemeCapabilitySignalRecord[],
): ThemeCapabilityRecord[] {
	const byId = new Map<string, ThemeCapabilityRecord>();
	const add = (
		path: string,
		capability: string,
		evidenceStrength: ThemeEvidenceStrength,
		evidenceId: string,
	): void => {
		const id = `capability:${path}:${capability}`;
		const existing = byId.get(id);
		if (existing) {
			existing.evidenceStrength = strongerThemeEvidence(
				existing.evidenceStrength,
				evidenceStrength,
			);
			existing.evidenceIds = [
				...new Set([...existing.evidenceIds, evidenceId]),
			];
			return;
		}
		byId.set(id, {
			id,
			path,
			capability,
			evidenceStrength,
			evidenceIds: [evidenceId],
		});
	};
	for (const signal of capabilitySignals) {
		add(signal.path, signal.capability, signal.evidenceStrength, signal.id);
	}
	for (const access of dataAccesses) {
		for (const rule of ACCESS_CAPABILITY_RULES) {
			if (rule.matches(access)) {
				add(access.fromPath, rule.name, rule.evidenceStrength, access.id);
			}
		}
	}
	return [...byId.values()];
}

export function inferClassifications(
	capabilities: ThemeCapabilityRecord[],
	dataAccesses: ThemeDataAccessRecord[],
): ThemeClassificationRecord[] {
	const capabilitiesByPath = new Map<string, Set<string>>();
	for (const capability of capabilities) {
		const names = capabilitiesByPath.get(capability.path) ?? new Set<string>();
		names.add(capability.capability);
		capabilitiesByPath.set(capability.path, names);
	}
	const dataByPath = new Map<string, Set<string>>();
	for (const access of dataAccesses) {
		const expressions = dataByPath.get(access.fromPath) ?? new Set<string>();
		expressions.add(`${access.object}.${access.propertyPath ?? ""}`);
		dataByPath.set(access.fromPath, expressions);
	}
	const records: ThemeClassificationRecord[] = [];
	for (const [path, names] of capabilitiesByPath) {
		const data = dataByPath.get(path) ?? new Set<string>();
		for (const rule of CLASSIFICATION_RULES) {
			if (!rule.matches(names, data)) continue;
			const contributing = new Set(rule.evidenceCapabilities);
			const evidenceIds = capabilities
				.filter(
					(capability) =>
						capability.path === path && contributing.has(capability.capability),
				)
				.flatMap((capability) => capability.evidenceIds);
			const evidenceDataExpressions = new Set(
				rule.evidenceDataExpressions ?? [],
			);
			for (const access of dataAccesses) {
				if (
					access.fromPath === path &&
					evidenceDataExpressions.has(access.expression)
				) {
					evidenceIds.push(access.id);
				}
			}
			records.push({
				id: `classification:${path}:${rule.label}`,
				path,
				label: rule.label,
				evidenceStrength: rule.evidenceStrength,
				evidenceIds: [...new Set(evidenceIds)].sort((a, b) =>
					a.localeCompare(b),
				),
				uncertainty: rule.uncertainty,
			});
		}
	}
	return records;
}
