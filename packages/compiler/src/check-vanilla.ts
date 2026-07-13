// Vanilla-Liquid checking: files with an authored {% schema %} (plain
// Shopify sections — Nazare components get theirs generated) have every
// literal section.settings.x / block.settings.x read validated against the
// schema's declared setting ids. Unknown reads render silently blank at
// runtime; here they fail the compile. Block reads are only checked when
// the schema defines classic inline blocks with their own settings —
// theme-block settings live in other files.
import type { Diagnostic } from "@nazare/core";
import type { NazareAst } from "./ast.js";
import { schemaInvalidJson, unknownSettingRead } from "./diagnostics.js";

type AuthoredSchemaJson = {
	settings?: { id?: string }[];
	blocks?: { type?: string; settings?: { id?: string }[] }[];
};

export function checkVanillaSchema(ast: NazareAst): Diagnostic[] {
	if (!ast.schema) return [];

	let parsed: AuthoredSchemaJson;
	try {
		parsed = JSON.parse(ast.schema.source) as AuthoredSchemaJson;
	} catch (error) {
		return [
			schemaInvalidJson(
				error instanceof Error ? error.message : String(error),
				ast.schema.span,
			),
		];
	}

	const issues: Diagnostic[] = [];
	const sectionIds = new Set(
		(parsed.settings ?? [])
			.map((setting) => setting.id)
			.filter((id): id is string => typeof id === "string"),
	);

	const blocks = parsed.blocks ?? [];
	const classicBlocks =
		blocks.length > 0 &&
		blocks.every(
			(block) => block.type !== "@theme" && Array.isArray(block.settings),
		);
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
		} else {
			if (!classicBlocks || blockIds.has(read.name)) continue;
			issues.push(unknownSettingRead("block", read.name, read.span));
		}
	}

	return issues;
}
