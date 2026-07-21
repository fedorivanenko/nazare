import type { Diagnostic } from "@nazare/core";
import type { ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";

export function collectJsonThemeFacts(
	path: string,
	contents: string,
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = [];
	if (path.startsWith("templates/") && path.endsWith(".json")) {
		facts.push({
			kind: "declaresTemplate",
			path,
			name: themeNameFromPath(path),
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
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
		collectTemplateFacts(path, parsed, facts, issues);
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
	return { facts, issues };
}

function collectTemplateFacts(
	path: string,
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
	if (!("sections" in parsed)) return;
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
