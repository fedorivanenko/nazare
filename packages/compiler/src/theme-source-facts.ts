import type { SourceSpan } from "@nazare/core";
import { spanFromOffsets } from "./source.js";
import type { ThemeFact } from "./theme-facts.js";

const SHOPIFY_OBJECTS = new Set([
	"product",
	"variant",
	"collection",
	"cart",
	"customer",
	"search",
	"recommendations",
	"localization",
	"metafields",
	"metaobjects",
]);

const dataAccessPattern =
	/\b(product|variant|collection|cart|customer|search|recommendations|localization|metafields|metaobjects)((?:\.[A-Za-z_][\w-]*)*)/g;
const settingReadPattern = /\b(section|block)\.settings\.([A-Za-z_][\w-]*)/g;
const renderTagPattern = /{%\s*render\s+['"]([^'"]+)['"]([\s\S]*?)%}/g;
const renderArgumentPattern = /(?:^|,)\s*([A-Za-z_][\w-]*)\s*:\s*([^,}%\n]+)/g;
const assetFilterPattern =
	/['"]([^'"]+)['"]\s*\|\s*(?:asset_url|asset_img_url|stylesheet_tag|script_tag)/g;
const localeFilterPattern = /['"]([^'"]+)['"]\s*\|\s*t\b/g;
const capabilityPatterns: Array<{
	capability: string;
	confidence: number;
	pattern: RegExp;
}> = [
	{
		capability: "addsToCart",
		confidence: 0.95,
		pattern: /(?:\/cart\/add|routes\.cart_add_url)/g,
	},
	{
		capability: "updatesCart",
		confidence: 0.9,
		pattern:
			/(?:\/cart\/(?:change|update)|routes\.cart_change_url|routes\.cart_update_url)/g,
	},
	{
		capability: "selectsVariants",
		confidence: 0.85,
		pattern:
			/(?:product\.variants|selected_or_first_available_variant|name=["']id["'])/g,
	},
	{
		capability: "performsPredictiveSearch",
		confidence: 0.9,
		pattern: /(?:predictive_search|\/search\/suggest)/g,
	},
	{
		capability: "filtersCollections",
		confidence: 0.8,
		pattern: /(?:collection\.filters|filter\.active_values|filter\.values)/g,
	},
];

export function collectSourceThemeFacts(
	path: string,
	contents: string,
): ThemeFact[] {
	return [
		...collectDataAccessFacts(path, contents),
		...collectSettingReadFacts(path, contents),
		...collectRenderArgumentFacts(path, contents),
		...collectAssetReferenceFacts(path, contents),
		...collectLocaleReferenceFacts(path, contents),
		...collectCapabilityFacts(path, contents),
	];
}

function collectDataAccessFacts(path: string, contents: string): ThemeFact[] {
	const facts: ThemeFact[] = [];
	for (const match of contents.matchAll(dataAccessPattern)) {
		const object = match[1];
		if (!SHOPIFY_OBJECTS.has(object)) continue;
		const propertyPath = (match[2] ?? "").replace(/^\./, "") || undefined;
		facts.push({
			kind: "readsShopifyData",
			fromPath: path,
			object,
			propertyPath,
			expression: match[0],
			span: matchSpan(path, contents, match),
		});
	}
	return facts;
}

function collectSettingReadFacts(path: string, contents: string): ThemeFact[] {
	const facts: ThemeFact[] = [];
	for (const match of contents.matchAll(settingReadPattern)) {
		facts.push({
			kind: "readsSetting",
			fromPath: path,
			settingObject: match[1] as "section" | "block",
			settingId: match[2],
			span: matchSpan(path, contents, match),
		});
	}
	return facts;
}

function collectRenderArgumentFacts(
	path: string,
	contents: string,
): ThemeFact[] {
	const facts: ThemeFact[] = [];
	for (const renderMatch of contents.matchAll(renderTagPattern)) {
		const targetName = renderMatch[1];
		const argumentSource = renderMatch[2] ?? "";
		const renderOffset = renderMatch.index ?? 0;
		for (const argumentMatch of argumentSource.matchAll(
			renderArgumentPattern,
		)) {
			const valueExpression = argumentMatch[2].trim();
			const source = sourceExpression(valueExpression);
			facts.push({
				kind: "passesRenderArgument",
				fromPath: path,
				targetName,
				argumentName: argumentMatch[1],
				valueExpression,
				...(source
					? { sourceObject: source.object, sourcePath: source.path }
					: {}),
				span: spanFromOffsets(contents, path, {
					start: renderOffset + (argumentMatch.index ?? 0),
					end:
						renderOffset + (argumentMatch.index ?? 0) + argumentMatch[0].length,
				}),
			});
		}
	}
	return facts;
}

function collectAssetReferenceFacts(
	path: string,
	contents: string,
): ThemeFact[] {
	return [...contents.matchAll(assetFilterPattern)].map((match) => ({
		kind: "referencesAsset" as const,
		fromPath: path,
		targetName: match[1],
		static: true,
		span: matchSpan(path, contents, match),
	}));
}

function collectLocaleReferenceFacts(
	path: string,
	contents: string,
): ThemeFact[] {
	return [...contents.matchAll(localeFilterPattern)].map((match) => ({
		kind: "referencesLocaleKey" as const,
		fromPath: path,
		key: match[1],
		static: true,
		span: matchSpan(path, contents, match),
	}));
}

function collectCapabilityFacts(path: string, contents: string): ThemeFact[] {
	const facts: ThemeFact[] = [];
	for (const capability of capabilityPatterns) {
		for (const match of contents.matchAll(capability.pattern)) {
			facts.push({
				kind: "detectsCapability",
				path,
				capability: capability.capability,
				confidence: capability.confidence,
				span: matchSpan(path, contents, match),
			});
		}
	}
	return facts;
}

function sourceExpression(
	expression: string,
): { object: string; path?: string } | undefined {
	const match = expression.match(
		/^(product|variant|collection|cart|customer|search|recommendations|localization|metafields|metaobjects|section\.settings|block\.settings)(?:\.([A-Za-z_][\w.-]*))?$/,
	);
	if (!match) return undefined;
	return { object: match[1], path: match[2] };
}

function matchSpan(
	path: string,
	contents: string,
	match: RegExpMatchArray,
): SourceSpan | undefined {
	if (match.index === undefined) return undefined;
	return spanFromOffsets(contents, path, {
		start: match.index,
		end: match.index + match[0].length,
	});
}
