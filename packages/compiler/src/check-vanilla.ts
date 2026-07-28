// Vanilla-Liquid checking: files with an authored {% schema %} (plain
// Shopify sections — Nazare components get theirs generated) have every
// literal section.settings.x / block.settings.x read validated against the
// schema's declared setting ids. Unknown reads render silently blank at
// runtime; here they fail the compile. Block reads are only checked when
// the schema defines classic inline blocks with their own settings —
// theme-block settings live in other files.
import type { Diagnostic } from "@nazare/core";
import type { NazareAst } from "./ast.js";
import {
	schemaInvalidJson,
	schemaInvalidShape,
	unknownSettingRead,
} from "./diagnostics.js";

type SchemaSetting = { id?: string };
type SchemaBlock = { type?: string; settings?: SchemaSetting[] };
type AuthoredSchemaJson = {
	settings?: SchemaSetting[];
	blocks?: SchemaBlock[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function checkVanillaSchema(
	ast: Pick<NazareAst, "schema" | "settingsReads">,
): Diagnostic[] {
	if (!ast.schema) return [];

	let value: unknown;
	try {
		value = JSON.parse(ast.schema.source);
	} catch (error) {
		return [
			schemaInvalidJson(
				error instanceof Error ? error.message : String(error),
				ast.schema.span,
			),
		];
	}

	const shapeError = validateSchemaShape(value);
	if (shapeError) return [schemaInvalidShape(shapeError, ast.schema.span)];
	const parsed = value as AuthoredSchemaJson;
	const issues: Diagnostic[] = [];
	const settings = parsed.settings ?? [];
	const sectionIds = new Set(
		settings
			.map((setting) => setting.id)
			.filter((id): id is string => typeof id === "string"),
	);

	// Block reads are checkable only when every block is a classic inline
	// block — one "@theme"/"@app" entry brings settings declared in other
	// files, so the full id set is unknowable here. A classic block without a
	// settings array still counts (it simply declares no ids).
	const blocks = parsed.blocks ?? [];
	const classicBlocks =
		blocks.length > 0 &&
		blocks.every((block) => block.type !== "@theme" && block.type !== "@app");
	const blockIds = new Set(
		blocks.flatMap((block) =>
			(block.settings ?? [])
				.map((setting) => setting.id)
				.filter((id): id is string => typeof id === "string"),
		),
	);

	for (const read of ast.settingsReads) {
		if (read.object === "section") {
			if (sectionIds.has(read.name)) continue;
			issues.push(unknownSettingRead("section", read.name, read.span));
		} else if (read.object === "block") {
			if (!classicBlocks || blockIds.has(read.name)) continue;
			issues.push(unknownSettingRead("block", read.name, read.span));
		}
	}

	return issues;
}

function validateSchemaShape(value: unknown): string | undefined {
	if (!isRecord(value)) return "root must be an object";
	if (value.settings !== undefined) {
		if (!Array.isArray(value.settings)) return '"settings" must be an array';
		for (const [index, setting] of value.settings.entries()) {
			if (!isRecord(setting)) return `settings[${index}] must be an object`;
			if (setting.id !== undefined && typeof setting.id !== "string") {
				return `settings[${index}].id must be a string`;
			}
		}
	}
	if (value.blocks !== undefined) {
		if (!Array.isArray(value.blocks)) return '"blocks" must be an array';
		for (const [index, block] of value.blocks.entries()) {
			if (!isRecord(block)) return `blocks[${index}] must be an object`;
			if (block.type !== undefined && typeof block.type !== "string") {
				return `blocks[${index}].type must be a string`;
			}
			if (block.settings === undefined) continue;
			if (!Array.isArray(block.settings)) {
				return `blocks[${index}].settings must be an array`;
			}
			for (const [settingIndex, setting] of block.settings.entries()) {
				if (!isRecord(setting)) {
					return `blocks[${index}].settings[${settingIndex}] must be an object`;
				}
				if (setting.id !== undefined && typeof setting.id !== "string") {
					return `blocks[${index}].settings[${settingIndex}].id must be a string`;
				}
			}
		}
	}
	return undefined;
}
