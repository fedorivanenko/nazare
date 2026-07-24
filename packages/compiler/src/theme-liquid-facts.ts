import type { Diagnostic } from "@nazare/core";
import { checkVanillaSchema } from "./check-vanilla.js";
import { markDiagnostics } from "./pipeline.js";
import { type PlainLiquidAst, parsePlainLiquid } from "./plain-liquid.js";
import { renderSiteKey, type ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";
import { collectSourceThemeFacts } from "./theme-source-facts.js";

export function collectPlainLiquidThemeFacts(
	path: string,
	contents: string,
	options: { parseMode: "strict" | "tolerant" } = {
		parseMode: "tolerant",
	},
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const ast = parsePlainLiquid(contents, path, {
		parseMode: options.parseMode,
	});
	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = [
		...markDiagnostics(ast.diagnostics, "parse"),
		...markDiagnostics(checkVanillaSchema(ast), "check"),
	];
	const name = themeNameFromPath(path);
	if (path.startsWith("sections/") && path.endsWith(".liquid")) {
		facts.push({ kind: "declaresSection", path, name });
	}
	if (path.startsWith("snippets/") && path.endsWith(".liquid")) {
		facts.push({ kind: "declaresSnippet", path, name });
	}
	if (path.startsWith("templates/") && path.endsWith(".liquid")) {
		facts.push({ kind: "declaresTemplate", path, name });
	}
	for (const dependency of ast.dependencies) {
		if (dependency.kind === "snippet") {
			facts.push({
				kind: "rendersSnippet",
				fromPath: path,
				targetName: dependency.name,
				siteId: renderSiteKey(path, dependency.span),
				invocationKind: dependency.invocationKind ?? "render",
				static: dependency.static,
				span: dependency.span,
			});
		}
		if (dependency.kind === "section") {
			facts.push({
				kind: "containsSection",
				fromPath: path,
				targetName: dependency.name,
				static: dependency.static,
				span: dependency.span,
			});
		}
		if (dependency.kind === "section-group") {
			facts.push({
				kind: "containsSectionGroup",
				fromPath: path,
				targetName: dependency.name,
				static: dependency.static,
				span: dependency.span,
			});
		}
		if (dependency.kind === "layout" && dependency.name !== "none") {
			facts.push({
				kind: "usesLayout",
				fromPath: path,
				targetName: dependency.name,
				static: dependency.static,
				span: dependency.span,
			});
		}
	}
	// The parser already located every settings read; map, don't re-scan.
	for (const read of ast.settingsReads) {
		facts.push({
			kind: "readsSetting",
			fromPath: path,
			settingObject: read.object,
			settingId: read.name,
			span: read.span,
		});
	}
	if (ast.factsCollected) {
		facts.push(...collectSourceThemeFacts(path, contents, ast.liquidAst));
	}
	facts.push(...schemaFacts(path, ast, issues));
	return { facts, issues };
}

function schemaFacts(
	path: string,
	ast: PlainLiquidAst,
	issues: Diagnostic[],
): ThemeFact[] {
	if (!ast.schema) return [];
	const schemaPath = "schema";
	const facts: ThemeFact[] = [
		{ kind: "definesSchema", path, schemaPath, span: ast.schema.span },
	];
	let parsed: unknown;
	try {
		parsed = JSON.parse(ast.schema.source);
	} catch (error) {
		issues.push(
			schemaShapeIssue(
				path,
				"THEME_SCHEMA_JSON_INVALID",
				`Invalid schema JSON: ${error instanceof Error ? error.message : String(error)}`,
				ast,
			),
		);
		return facts;
	}
	if (!isRecord(parsed)) {
		issues.push(
			schemaShapeIssue(
				path,
				"THEME_SCHEMA_INVALID_ROOT",
				"Schema root must be an object",
				ast,
			),
		);
		return facts;
	}
	if (parsed.settings !== undefined) {
		collectSchemaSettings(
			path,
			schemaPath,
			parsed.settings,
			path.startsWith("blocks/") ? themeNameFromPath(path) : undefined,
			ast,
			facts,
			issues,
		);
	}
	if (parsed.blocks !== undefined) {
		if (!Array.isArray(parsed.blocks)) {
			issues.push(
				schemaShapeIssue(
					path,
					"THEME_SCHEMA_INVALID_BLOCKS",
					'Schema "blocks" must be an array',
					ast,
				),
			);
		} else {
			const seenBlockTypes = new Set<string>();
			for (const [index, block] of parsed.blocks.entries()) {
				if (!isRecord(block)) {
					issues.push(
						schemaShapeIssue(
							path,
							"THEME_SCHEMA_INVALID_BLOCK",
							`Schema block ${index} must be an object`,
							ast,
						),
					);
					continue;
				}
				if (typeof block.type !== "string" || block.type.length === 0) {
					issues.push(
						schemaShapeIssue(
							path,
							"THEME_SCHEMA_INVALID_BLOCK_TYPE",
							`Schema block ${index} must have a non-empty string type`,
							ast,
						),
					);
					continue;
				}
				if (seenBlockTypes.has(block.type)) {
					issues.push(
						schemaShapeIssue(
							path,
							"THEME_SCHEMA_DUPLICATE_BLOCK_TYPE",
							`Duplicate schema block type ${block.type}`,
							ast,
						),
					);
					continue;
				}
				seenBlockTypes.add(block.type);
				facts.push({
					kind: "declaresBlock",
					path,
					blockType: block.type,
					name: typeof block.name === "string" ? block.name : undefined,
					span: ast.schema.span,
				});
				if (block.settings !== undefined) {
					collectSchemaSettings(
						path,
						schemaPath,
						block.settings,
						block.type,
						ast,
						facts,
						issues,
					);
				}
			}
		}
	}
	return facts;
}

function collectSchemaSettings(
	path: string,
	schemaPath: string,
	value: unknown,
	blockType: string | undefined,
	ast: PlainLiquidAst,
	facts: ThemeFact[],
	issues: Diagnostic[],
): void {
	const owner = blockType ? `block ${blockType}` : "section";
	if (!Array.isArray(value)) {
		issues.push(
			schemaShapeIssue(
				path,
				"THEME_SCHEMA_INVALID_SETTINGS",
				`Schema settings for ${owner} must be an array`,
				ast,
			),
		);
		return;
	}
	const seenIds = new Set<string>();
	for (const [index, setting] of value.entries()) {
		if (!isRecord(setting)) {
			issues.push(
				schemaShapeIssue(
					path,
					"THEME_SCHEMA_INVALID_SETTING",
					`Schema setting ${owner}.${index} must be an object`,
					ast,
				),
			);
			continue;
		}
		if (typeof setting.type !== "string" || setting.type.length === 0) {
			issues.push(
				schemaShapeIssue(
					path,
					"THEME_SCHEMA_INVALID_SETTING_TYPE",
					`Schema setting ${owner}.${index} must have a non-empty string type`,
					ast,
				),
			);
			continue;
		}
		if (setting.type === "header" || setting.type === "paragraph") continue;
		if (typeof setting.id !== "string" || setting.id.length === 0) {
			issues.push(
				schemaShapeIssue(
					path,
					"THEME_SCHEMA_INVALID_SETTING_ID",
					`Schema setting ${owner}.${index} must have a non-empty string id`,
					ast,
				),
			);
			continue;
		}
		if (seenIds.has(setting.id)) {
			issues.push(
				schemaShapeIssue(
					path,
					"THEME_SCHEMA_DUPLICATE_SETTING_ID",
					`Duplicate schema setting id ${setting.id} in ${owner}`,
					ast,
				),
			);
			continue;
		}
		seenIds.add(setting.id);
		if (blockType) {
			facts.push({
				kind: "definesBlockSetting",
				path,
				blockType,
				settingId: setting.id,
				settingType: setting.type,
				span: ast.schema?.span,
			});
		} else {
			facts.push({
				kind: "definesSetting",
				path,
				schemaPath,
				settingId: setting.id,
				settingType: setting.type,
				span: ast.schema?.span,
			});
		}
	}
}

function schemaShapeIssue(
	path: string,
	code: string,
	message: string,
	ast: PlainLiquidAst,
): Diagnostic {
	return {
		severity: "error",
		code,
		message: `${message} in ${path}`,
		phase: "parse",
		span: ast.schema?.span,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
