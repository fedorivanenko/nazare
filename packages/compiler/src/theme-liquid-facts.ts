import type { Diagnostic } from "@nazare/core";
import { type PlainLiquidAst, parsePlainLiquid } from "./plain-liquid.js";
import { renderSiteKey, type ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";
import { collectSourceThemeFacts } from "./theme-source-facts.js";

export function collectPlainLiquidThemeFacts(
	path: string,
	contents: string,
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const ast = parsePlainLiquid(contents, path, { parseMode: "tolerant" });
	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = [...ast.diagnostics];
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
	try {
		const parsed = JSON.parse(ast.schema.source) as { settings?: unknown };
		if (Array.isArray(parsed.settings)) {
			for (const setting of parsed.settings) {
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
					span: ast.schema.span,
				});
			}
		}
		const blocks = (parsed as { blocks?: unknown }).blocks;
		if (Array.isArray(blocks)) {
			for (const block of blocks) {
				if (!block || typeof block !== "object") continue;
				const type = (block as { type?: unknown }).type;
				if (typeof type !== "string") continue;
				const name = (block as { name?: unknown }).name;
				facts.push({
					kind: "declaresBlock",
					path,
					blockType: type,
					name: typeof name === "string" ? name : undefined,
					span: ast.schema.span,
				});
				const settings = (block as { settings?: unknown }).settings;
				if (!Array.isArray(settings)) continue;
				for (const setting of settings) {
					if (!setting || typeof setting !== "object") continue;
					const id = (setting as { id?: unknown }).id;
					if (typeof id !== "string") continue;
					const settingType = (setting as { type?: unknown }).type;
					facts.push({
						kind: "definesBlockSetting",
						path,
						blockType: type,
						settingId: id,
						settingType:
							typeof settingType === "string" ? settingType : undefined,
						span: ast.schema.span,
					});
				}
			}
		}
	} catch (error) {
		// No other pass parses this schema in the analysis path, so the failure
		// must be reported here or it disappears.
		issues.push({
			severity: "error",
			code: "THEME_SCHEMA_JSON_INVALID",
			message: `Invalid schema JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
			phase: "parse",
			span: ast.schema.span,
		});
	}
	return facts;
}
