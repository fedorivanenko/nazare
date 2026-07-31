import type { Diagnostic } from "@nazare/core";
import { getNodePath, type Node as JsonNode, parseTree } from "jsonc-parser";
import { spanFromOffsets } from "./source.js";
import type { ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";

export function collectJsonThemeFacts(
	path: string,
	contents: string,
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripShopifyJsonPreamble(contents));
	} catch (error) {
		return {
			facts,
			issues: [
				invalidJsonShape(
					path,
					"THEME_JSON_PARSE_ERROR",
					`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
				),
			],
		};
	}

	if (isTemplateLikeJson(path)) {
		collectTemplateFacts(path, contents, parsed, facts, issues);
	}
	if (path.startsWith("locales/") && path.endsWith(".json")) {
		if (!isRecord(parsed)) {
			issues.push(
				invalidJsonShape(
					path,
					"THEME_LOCALE_INVALID_ROOT",
					"Locale root must be an object",
				),
			);
		} else {
			for (const key of flattenLocaleKeys(parsed)) {
				facts.push({ kind: "definesLocaleKey", path, key });
			}
		}
	}
	if (path === "config/settings_schema.json") {
		collectSettingsSchemaFacts(path, parsed, facts, issues);
	}
	if (path === "config/settings_data.json" && !isRecord(parsed)) {
		issues.push(
			invalidJsonShape(
				path,
				"THEME_SETTINGS_DATA_INVALID_ROOT",
				"Settings data root must be an object",
			),
		);
	}
	if (issues.some((issue) => issue.severity === "error")) {
		return { facts: [], issues };
	}
	if (path.startsWith("templates/") && path.endsWith(".json")) {
		facts.push({
			kind: "declaresTemplate",
			path,
			name: themeNameFromPath(path),
		});
	}
	if (path.startsWith("locales/") && path.endsWith(".json")) {
		facts.push({
			kind: "declaresLocale",
			path,
			name: themeNameFromPath(path),
		});
	}
	return { facts, issues };
}

/** Shopify-generated JSON files commonly start with an IMPORTANT block
 * comment. JSON itself has no comments, but Shopify accepts this exact
 * preamble. Strip only leading comments; never rewrite JSON content. */
function stripShopifyJsonPreamble(contents: string): string {
	let offset = contents.charCodeAt(0) === 0xfeff ? 1 : 0;
	while (offset < contents.length) {
		while (/\s/.test(contents[offset] ?? "")) offset += 1;
		if (contents.startsWith("/*", offset)) {
			const end = contents.indexOf("*/", offset + 2);
			if (end < 0) return contents.slice(offset);
			offset = end + 2;
			continue;
		}
		if (contents.startsWith("//", offset)) {
			const end = contents.indexOf("\n", offset + 2);
			if (end < 0) return "";
			offset = end + 1;
			continue;
		}
		break;
	}
	return contents.slice(offset);
}

function collectTemplateFacts(
	path: string,
	contents: string,
	parsed: unknown,
	facts: ThemeFact[],
	issues: Diagnostic[],
): void {
	if (!isRecord(parsed)) {
		issues.push(
			invalidJsonShape(
				path,
				"THEME_TEMPLATE_INVALID_ROOT",
				"Template root must be an object",
			),
		);
		return;
	}
	if (!("sections" in parsed)) {
		issues.push(
			invalidJsonShape(
				path,
				"THEME_TEMPLATE_MISSING_SECTIONS",
				'Template must contain a "sections" object',
			),
		);
		return;
	}
	if (!isRecord(parsed.sections)) {
		issues.push(
			invalidJsonShape(
				path,
				"THEME_TEMPLATE_INVALID_SECTIONS",
				'Template "sections" must be an object',
			),
		);
		return;
	}
	if (parsed.order !== undefined && !Array.isArray(parsed.order)) {
		issues.push(
			invalidJsonShape(
				path,
				"THEME_TEMPLATE_INVALID_ORDER",
				'Template "order" must be an array of section instance ids',
			),
		);
	} else if (Array.isArray(parsed.order)) {
		const seenOrderIds = new Set<string>();
		for (const [orderIndex, instanceId] of parsed.order.entries()) {
			if (typeof instanceId !== "string" || !instanceId) {
				issues.push(
					invalidJsonShape(
						path,
						"THEME_TEMPLATE_INVALID_ORDER_ID",
						`Template order entry ${orderIndex} must be a non-empty string`,
					),
				);
				continue;
			}
			if (!(instanceId in parsed.sections)) {
				issues.push(
					invalidJsonShape(
						path,
						"THEME_TEMPLATE_UNKNOWN_ORDER_ID",
						`Template order references missing section ${instanceId}`,
					),
				);
			}
			if (seenOrderIds.has(instanceId)) {
				issues.push(
					invalidJsonShape(
						path,
						"THEME_TEMPLATE_DUPLICATE_ORDER_ID",
						`Template order repeats section ${instanceId}`,
					),
				);
			}
			seenOrderIds.add(instanceId);
		}
	}
	collectJsonSettingMetafieldSources(path, contents, facts, issues);
	for (const [instanceId, section] of Object.entries(parsed.sections)) {
		if (!isRecord(section)) {
			issues.push(
				invalidJsonShape(
					path,
					"THEME_TEMPLATE_INVALID_SECTION_INSTANCE",
					`Template section ${instanceId} must be an object`,
				),
			);
			continue;
		}
		if (typeof section.type !== "string" || section.type.length === 0) {
			issues.push(
				invalidJsonShape(
					path,
					"THEME_TEMPLATE_INVALID_SECTION_TYPE",
					`Template section ${instanceId} must have a non-empty string type`,
				),
			);
			continue;
		}
		facts.push({
			kind: "containsSection",
			fromPath: path,
			targetName: section.type,
			static: true,
		});
		facts.push({
			kind: "sectionInstance",
			templatePath: path,
			instanceId,
			sectionType: section.type,
			static: true,
		});
		collectBlockInstances(path, instanceId, section.blocks, facts, issues);
	}
}

function collectBlockInstances(
	ownerPath: string,
	sectionInstanceId: string,
	value: unknown,
	facts: ThemeFact[],
	issues: Diagnostic[],
	parentInstanceId?: string,
): void {
	if (value === undefined) return;
	if (!isRecord(value)) {
		issues.push(
			invalidJsonShape(
				ownerPath,
				"THEME_TEMPLATE_INVALID_BLOCKS",
				`Blocks for section instance ${sectionInstanceId} must be an object`,
			),
		);
		return;
	}
	for (const [instanceId, block] of Object.entries(value)) {
		if (!isRecord(block)) {
			issues.push(
				invalidJsonShape(
					ownerPath,
					"THEME_TEMPLATE_INVALID_BLOCK_INSTANCE",
					`Template block ${instanceId} must be an object`,
				),
			);
			continue;
		}
		const blockType =
			typeof block.type === "string" && block.type.length > 0
				? block.type
				: undefined;
		if (!blockType) {
			issues.push(
				invalidJsonShape(
					ownerPath,
					"THEME_TEMPLATE_INVALID_BLOCK_TYPE",
					`Template block ${instanceId} must have a non-empty string type`,
				),
			);
			continue;
		}
		facts.push({
			kind: "blockInstance",
			ownerPath,
			sectionInstanceId,
			instanceId,
			blockType,
			parentInstanceId,
			static: true,
		});
		collectBlockInstances(
			ownerPath,
			sectionInstanceId,
			block.blocks,
			facts,
			issues,
			instanceId,
		);
	}
}

function collectSettingsSchemaFacts(
	path: string,
	parsed: unknown,
	facts: ThemeFact[],
	issues: Diagnostic[],
): void {
	if (!Array.isArray(parsed)) {
		issues.push(
			invalidJsonShape(
				path,
				"THEME_SETTINGS_SCHEMA_INVALID_ROOT",
				"Settings schema root must be an array",
			),
		);
		return;
	}
	const schemaPath = "config/settings_schema.json";
	const seenSettingIds = new Set<string>();
	facts.push({ kind: "definesSchema", path, schemaPath });
	for (const [groupIndex, group] of parsed.entries()) {
		if (!isRecord(group)) {
			issues.push(
				invalidJsonShape(
					path,
					"THEME_SETTINGS_SCHEMA_INVALID_GROUP",
					`Settings schema group ${groupIndex} must be an object`,
				),
			);
			continue;
		}
		if (!("settings" in group)) continue;
		if (!Array.isArray(group.settings)) {
			issues.push(
				invalidJsonShape(
					path,
					"THEME_SETTINGS_SCHEMA_INVALID_SETTINGS",
					`Settings schema group ${groupIndex} settings must be an array`,
				),
			);
			continue;
		}
		for (const [settingIndex, setting] of group.settings.entries()) {
			if (!isRecord(setting)) {
				issues.push(
					invalidJsonShape(
						path,
						"THEME_SETTINGS_SCHEMA_INVALID_SETTING",
						`Setting ${groupIndex}.${settingIndex} must be an object`,
					),
				);
				continue;
			}
			if (typeof setting.type !== "string" || setting.type.length === 0) {
				issues.push(
					invalidJsonShape(
						path,
						"THEME_SETTINGS_SCHEMA_INVALID_SETTING_TYPE",
						`Setting ${groupIndex}.${settingIndex} type must be a non-empty string`,
					),
				);
				continue;
			}
			if (setting.type === "header" || setting.type === "paragraph") continue;
			if (typeof setting.id !== "string" || setting.id.length === 0) {
				issues.push(
					invalidJsonShape(
						path,
						"THEME_SETTINGS_SCHEMA_INVALID_SETTING_ID",
						`Setting ${groupIndex}.${settingIndex} id must be a non-empty string`,
					),
				);
				continue;
			}
			if (seenSettingIds.has(setting.id)) {
				issues.push(
					invalidJsonShape(
						path,
						"THEME_SETTINGS_SCHEMA_DUPLICATE_SETTING_ID",
						`Duplicate settings schema id ${setting.id}`,
					),
				);
				continue;
			}
			seenSettingIds.add(setting.id);
			facts.push({
				kind: "definesSetting",
				path,
				schemaPath,
				settingId: setting.id,
				settingType:
					typeof setting.type === "string" ? setting.type : undefined,
			});
		}
	}
}

function flattenLocaleKeys(
	value: Record<string, unknown>,
	prefix = "",
): string[] {
	const keys: string[] = [];
	for (const [key, child] of Object.entries(value)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		if (isRecord(child)) {
			keys.push(...flattenLocaleKeys(child, fullKey));
			continue;
		}
		keys.push(fullKey);
	}
	return keys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

const LIQUID_OUTPUT_EXPRESSION = /^\s*\{\{\s*(.*?)\s*\}\}\s*$/;
const METAFIELD_DYNAMIC_SOURCE_PATH =
	/^([A-Za-z_][A-Za-z0-9_]*)\.metafields\.([A-Za-z0-9_$:-]+)(?:\.([A-Za-z0-9_-]+)|\[\s*(["'])([^"'\\]+)\4\s*\])$/;
const METAFIELD_DYNAMIC_SOURCE_SUFFIX = /(?:\.value|\s*\|\s*metafield_tag)$/;

function collectJsonSettingMetafieldSources(
	path: string,
	contents: string,
	facts: ThemeFact[],
	issues: Diagnostic[],
): void {
	const tree = parseTree(contents);
	if (!tree) return;
	walkJsonTree(tree, (node) => {
		if (
			node.type !== "string" ||
			typeof node.value !== "string" ||
			!isTemplateSettingValue(node)
		) {
			return;
		}
		const value = node.value;
		const dynamicSource = parseMetafieldDynamicSource(value);
		if (!dynamicSource) {
			if (looksLikeMetafieldDynamicSource(value)) {
				issues.push({
					severity: "warning",
					code: "THEME_JSON_METAFIELD_SOURCE_INVALID",
					message: `Unsupported metafield dynamic source ${JSON.stringify(value)} in ${path}; expected {{ owner.metafields.namespace.key }}`,
					phase: "parse",
					span: jsonStringValueSpan(path, contents, node),
				});
			}
			return;
		}
		facts.push({
			kind: "readsShopifyData",
			fromPath: path,
			object: dynamicSource.owner,
			propertyPath: `metafields.${dynamicSource.namespace}.${dynamicSource.key}`,
			expression: `${dynamicSource.owner}.metafields.${dynamicSource.namespace}.${dynamicSource.key}`,
			span: jsonStringValueSpan(path, contents, node),
		});
	});
}

function parseMetafieldDynamicSource(
	value: string,
): { owner: string; namespace: string; key: string } | undefined {
	const output = LIQUID_OUTPUT_EXPRESSION.exec(value);
	if (!output) return undefined;
	const expression = output[1].trim();
	const match =
		METAFIELD_DYNAMIC_SOURCE_PATH.exec(expression) ??
		METAFIELD_DYNAMIC_SOURCE_PATH.exec(
			expression.replace(METAFIELD_DYNAMIC_SOURCE_SUFFIX, "").trim(),
		);
	if (!match) return undefined;
	return {
		owner: match[1],
		namespace: match[2],
		key: match[3] ?? match[5],
	};
}

function walkJsonTree(node: JsonNode, visit: (node: JsonNode) => void): void {
	visit(node);
	for (const child of node.children ?? []) walkJsonTree(child, visit);
}

function isTemplateSettingValue(node: JsonNode): boolean {
	const path = getNodePath(node);
	if (path.length < 4 || path[0] !== "sections") return false;
	const settingsIndex = path.length - 2;
	if (path[settingsIndex] !== "settings") return false;
	return (
		settingsIndex === 2 ||
		path.slice(2, settingsIndex).some((segment) => segment === "blocks")
	);
}

function looksLikeMetafieldDynamicSource(value: string): boolean {
	return (
		(value.includes("{{") || value.includes("}}")) &&
		value.includes(".metafields")
	);
}

function jsonStringValueSpan(
	path: string,
	contents: string,
	node: JsonNode,
): ReturnType<typeof spanFromOffsets> {
	const source = contents.slice(node.offset, node.offset + node.length);
	const expressionStart = source.indexOf("{{");
	const expressionEnd = source.lastIndexOf("}}");
	const start =
		expressionStart >= 0 ? node.offset + expressionStart : node.offset;
	const end =
		expressionEnd >= expressionStart
			? node.offset + expressionEnd + 2
			: node.offset + node.length;
	return spanFromOffsets(contents, path, { start, end });
}

function invalidJsonShape(
	path: string,
	code: string,
	message: string,
): Diagnostic {
	return {
		severity: "error",
		code,
		message: `${message} in ${path}`,
		phase: "parse",
	};
}

function isTemplateLikeJson(path: string): boolean {
	return (
		(path.startsWith("templates/") || path.startsWith("sections/")) &&
		path.endsWith(".json")
	);
}
