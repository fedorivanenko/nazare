import type { Diagnostic } from "@nazare/core";
import type { ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";

export function collectJsonThemeFacts(
	path: string,
	contents: string,
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const facts: ThemeFact[] = [];
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
				{
					severity: "error",
					code: "THEME_JSON_PARSE_ERROR",
					message: `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
					phase: "parse",
				},
			],
		};
	}
	if (isTemplateLikeJson(path)) {
		const sections = (parsed as { sections?: unknown }).sections;
		if (sections && typeof sections === "object" && !Array.isArray(sections)) {
			for (const [instanceId, section] of Object.entries(sections)) {
				if (!section || typeof section !== "object") continue;
				const type = (section as { type?: unknown }).type;
				facts.push({
					kind: "containsSection",
					fromPath: path,
					targetName: typeof type === "string" ? type : undefined,
					static: typeof type === "string",
				});
				facts.push({
					kind: "sectionInstance",
					templatePath: path,
					instanceId,
					sectionType: typeof type === "string" ? type : undefined,
					static: typeof type === "string",
				});
			}
		}
	}
	if (path === "config/settings_schema.json" && Array.isArray(parsed)) {
		const schemaPath = "config/settings_schema.json";
		facts.push({ kind: "definesSchema", path, schemaPath });
		for (const group of parsed) {
			if (!group || typeof group !== "object") continue;
			const settings = (group as { settings?: unknown }).settings;
			if (!Array.isArray(settings)) continue;
			for (const setting of settings) {
				if (!setting || typeof setting !== "object") continue;
				const id = (setting as { id?: unknown }).id;
				if (typeof id !== "string") continue;
				const type = (setting as { type?: unknown }).type;
				facts.push({
					kind: "definesSetting",
					path,
					schemaPath,
					settingId: id,
					settingType: typeof type === "string" ? type : undefined,
				});
			}
		}
	}
	return { facts, issues: [] };
}

function isTemplateLikeJson(path: string): boolean {
	return (
		(path.startsWith("templates/") || path.startsWith("sections/")) &&
		path.endsWith(".json")
	);
}
