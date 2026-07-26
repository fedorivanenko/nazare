import type { Diagnostic } from "@nazare/core";
import {
	LineIndex,
	type LiquidScanIssue,
	liquidDependencies,
	liquidSchema,
	liquidSettingsReads,
	scanLiquid,
} from "@nazare/scan";
import {
	createDefaultSourceParserRegistry,
	liquidSyntaxFacts,
	parseSourceDocument,
} from "@nazare/source";
import type { AuthoredSchema, SettingsRead } from "./ast.js";
import { checkVanillaSchema } from "./check-vanilla.js";
import { parseLiquidCrash } from "./diagnostics.js";
import { markDiagnostics } from "./pipeline.js";
import {
	invalidDependencyName,
	parsePlainLiquid,
	plainLiquidFactsSkipped,
	validateDependencyName,
} from "./plain-liquid.js";
import { spanFromOffsets } from "./source.js";
import { renderSiteKey, type ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";
import { collectScannedSourceFacts } from "./theme-scan-facts.js";
import { collectTreeSitterSourceThemeFacts } from "./theme-tree-sitter-facts.js";

export function collectPlainLiquidThemeFacts(
	path: string,
	contents: string,
	options: {
		parseMode: "strict" | "liquid-only";
		sourceFrontend?: "legacy" | "tree-sitter";
	} = {
		parseMode: "liquid-only",
	},
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	if (options.sourceFrontend === "tree-sitter") {
		return collectTreeSitterPlainLiquidThemeFacts(path, contents);
	}
	const scan = scanLiquid(contents);
	const index = new LineIndex(contents);
	const document = scan.status === "valid" ? scan.document : undefined;
	const schemaToken = document ? liquidSchema(document) : undefined;
	// Schema validation still uses Shopify's parser. Files without authored
	// schema stay entirely on the scanner-backed analysis path.
	const schemaAst = schemaToken
		? parsePlainLiquid(contents, path, { parseMode: options.parseMode })
		: undefined;
	const factsCollected = schemaAst?.factsCollected ?? document !== undefined;
	const settingsReads: SettingsRead[] = document
		? liquidSettingsReads(document).map((read) => ({
				object: read.object,
				name: read.name,
				span: index.spanAt(path, read.range),
			}))
		: [];
	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = schemaAst
		? [
				...markDiagnostics(schemaAst.diagnostics, "parse"),
				...markDiagnostics(
					checkVanillaSchema({
						schema: schemaAst.schema,
						settingsReads,
					}),
					"check",
				),
			]
		: scan.status === "invalid"
			? [
					...markDiagnostics(
						scan.issues.map((issue) =>
							parseLiquidCrash(
								scanIssueMessage(issue.code, issue.name),
								index.spanAt(path, issue.range),
							),
						),
						"parse",
					),
					...markDiagnostics([plainLiquidFactsSkipped(path)], "parse"),
				]
			: [];
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
	if (factsCollected && document) {
		for (const dependency of liquidDependencies(document)) {
			const span = index.spanAt(path, dependency.range);
			const validation = dependency.name
				? validateDependencyName(dependency.kind, dependency.name)
				: { valid: true as const };
			if (dependency.name && !validation.valid) {
				issues.push(
					invalidDependencyName(
						dependency.kind,
						dependency.name,
						span,
						validation.reason,
					),
				);
			}
			const targetName = dependency.name;
			const staticReference = targetName !== undefined;
			if (dependency.kind === "snippet") {
				facts.push({
					kind: "rendersSnippet",
					fromPath: path,
					targetName,
					siteId: renderSiteKey(path, span),
					invocationKind: dependency.invocationKind ?? "render",
					static: staticReference,
					span,
				});
			}
			if (dependency.kind === "section") {
				facts.push({
					kind: "containsSection",
					fromPath: path,
					targetName,
					static: staticReference,
					span,
				});
			}
			if (dependency.kind === "section-group") {
				facts.push({
					kind: "containsSectionGroup",
					fromPath: path,
					targetName,
					static: staticReference,
					span,
				});
			}
			if (dependency.kind === "layout" && targetName !== "none") {
				facts.push({
					kind: "usesLayout",
					fromPath: path,
					targetName,
					static: staticReference,
					span,
				});
			}
		}
		for (const read of settingsReads) {
			facts.push({
				kind: "readsSetting",
				fromPath: path,
				settingObject: read.object,
				settingId: read.name,
				span: read.span,
			});
		}
		const sourceResult = collectScannedSourceFacts(path, contents, document);
		facts.push(...sourceResult.facts);
		issues.push(...sourceResult.issues);
	}
	if (schemaAst?.schema) {
		facts.push(...schemaFacts(path, schemaAst.schema, issues));
	}
	return { facts, issues };
}

function collectTreeSitterPlainLiquidThemeFacts(
	path: string,
	contents: string,
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const document = parseSourceDocument(
		createDefaultSourceParserRegistry(),
		path,
		"liquid",
		contents,
	);
	const syntax = liquidSyntaxFacts(document);
	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = document.issues.map(
		(issue) =>
			markDiagnostics(
				[
					parseLiquidCrash(
						`${issue.code}: ${issue.message}`,
						spanFromOffsets(contents, path, issue.range),
					),
				],
				"parse",
			)[0] as Diagnostic,
	);
	if (!syntax.authoritative) {
		issues.push(...markDiagnostics([plainLiquidFactsSkipped(path)], "parse"));
	}
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
	if (!syntax.authoritative) return { facts, issues };

	for (const dependency of syntax.dependencies) {
		const at = spanFromOffsets(contents, path, dependency.range);
		const validation = dependency.name
			? validateDependencyName(dependency.kind, dependency.name)
			: { valid: true as const };
		if (dependency.name && !validation.valid) {
			issues.push(
				invalidDependencyName(
					dependency.kind,
					dependency.name,
					at,
					validation.reason,
				),
			);
		}
		const targetName = dependency.name;
		const staticReference = targetName !== undefined;
		if (dependency.kind === "snippet") {
			facts.push({
				kind: "rendersSnippet",
				fromPath: path,
				targetName,
				siteId: renderSiteKey(path, at),
				invocationKind: dependency.invocationKind ?? "render",
				static: staticReference,
				span: at,
			});
		} else if (dependency.kind === "section") {
			facts.push({
				kind: "containsSection",
				fromPath: path,
				targetName,
				static: staticReference,
				span: at,
			});
		} else if (dependency.kind === "section-group") {
			facts.push({
				kind: "containsSectionGroup",
				fromPath: path,
				targetName,
				static: staticReference,
				span: at,
			});
		} else if (dependency.kind === "layout" && targetName !== "none") {
			facts.push({
				kind: "usesLayout",
				fromPath: path,
				targetName,
				static: staticReference,
				span: at,
			});
		}
	}
	const settingsReads: SettingsRead[] = syntax.settingsReads.map((read) => ({
		object: read.object,
		name: read.name,
		span: spanFromOffsets(contents, path, read.range),
	}));
	for (const read of settingsReads) {
		facts.push({
			kind: "readsSetting",
			fromPath: path,
			settingObject: read.object,
			settingId: read.name,
			span: read.span,
		});
	}
	const sourceResult = collectTreeSitterSourceThemeFacts(
		path,
		contents,
		syntax,
	);
	facts.push(...sourceResult.facts);
	issues.push(...sourceResult.issues);
	const schema: AuthoredSchema | undefined = syntax.schema
		? {
				source: syntax.schema.body,
				span: spanFromOffsets(contents, path, syntax.schema.range),
			}
		: undefined;
	if (schema) {
		issues.push(
			...markDiagnostics(
				checkVanillaSchema({ schema, settingsReads }),
				"check",
			),
		);
		facts.push(...schemaFacts(path, schema, issues));
	}
	return { facts, issues };
}

function scanIssueMessage(
	code: LiquidScanIssue["code"],
	name: string | undefined,
): string {
	switch (code) {
		case "UNTERMINATED_TAG":
			return "Unterminated Liquid tag";
		case "UNCLOSED_RAW_TAG":
		case "UNCLOSED_BLOCK":
			return `Unclosed Liquid ${name} block`;
		case "MISMATCHED_BLOCK":
			return `Mismatched Liquid end${name} tag`;
		case "UNTERMINATED_STRING":
			return "Unterminated Liquid string";
		case "UNCLOSED_BRACKET":
			return "Unclosed Liquid bracket lookup";
	}
}

function schemaFacts(
	path: string,
	schema: AuthoredSchema,
	issues: Diagnostic[],
): ThemeFact[] {
	const schemaPath = "schema";
	const facts: ThemeFact[] = [
		{ kind: "definesSchema", path, schemaPath, span: schema.span },
	];
	let parsed: unknown;
	try {
		parsed = JSON.parse(schema.source);
	} catch (error) {
		issues.push(
			schemaShapeIssue(
				path,
				"THEME_SCHEMA_JSON_INVALID",
				`Invalid schema JSON: ${error instanceof Error ? error.message : String(error)}`,
				schema,
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
				schema,
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
			schema,
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
					schema,
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
							schema,
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
							schema,
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
							schema,
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
					span: schema.span,
				});
				if (block.settings !== undefined) {
					collectSchemaSettings(
						path,
						schemaPath,
						block.settings,
						block.type,
						schema,
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
	schema: AuthoredSchema,
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
				schema,
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
					schema,
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
					schema,
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
					schema,
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
					schema,
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
				span: schema.span,
			});
		} else {
			facts.push({
				kind: "definesSetting",
				path,
				schemaPath,
				settingId: setting.id,
				settingType: setting.type,
				span: schema.span,
			});
		}
	}
}

function schemaShapeIssue(
	path: string,
	code: string,
	message: string,
	schema: AuthoredSchema,
): Diagnostic {
	return {
		severity: "error",
		code,
		message: `${message} in ${path}`,
		phase: "parse",
		span: schema.span,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
