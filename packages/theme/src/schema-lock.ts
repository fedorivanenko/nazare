import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type DriftEntry = { code: string; message: string };

export type SchemaSetting = { id: string; type: string };
export type SchemaEntry = {
	settings: SchemaSetting[];
	blocks: { type: string }[];
};
export type SchemaManifest = {
	version: 1;
	sections: Record<string, SchemaEntry>;
};

export async function readSchemaManifest(
	path: string,
): Promise<SchemaManifest | undefined> {
	const raw = await readFile(path, "utf8").catch(() => undefined);
	if (raw === undefined) return undefined;
	try {
		return JSON.parse(raw) as SchemaManifest;
	} catch {
		return undefined;
	}
}

// Stable key order so the committed lock produces clean diffs.
export function sortSchemaManifest(manifest: SchemaManifest): SchemaManifest {
	const sections: Record<string, SchemaEntry> = {};
	for (const key of Object.keys(manifest.sections).sort()) {
		sections[key] = manifest.sections[key];
	}
	return { version: manifest.version, sections };
}

function sectionType(path: string): string {
	return basename(path, ".liquid");
}

// Reports only breaking changes: a rename cannot be told apart from a
// remove-plus-add without author intent, so it surfaces as a removal here.
// Additions are non-breaking (Shopify fills defaults) and stay silent.
export function diffSchemaManifests(
	prior: SchemaManifest | undefined,
	next: SchemaManifest,
): DriftEntry[] {
	if (!prior) return [];
	const drift: DriftEntry[] = [];
	for (const [path, oldEntry] of Object.entries(prior.sections)) {
		const type = sectionType(path);
		const newEntry = next.sections[path];
		if (!newEntry) {
			drift.push({
				code: "THEME_SECTION_REMOVED",
				message: `section "${type}" removed — templates and settings_data that reference it will break`,
			});
			continue;
		}
		const newTypeById = new Map(newEntry.settings.map((s) => [s.id, s.type]));
		for (const setting of oldEntry.settings) {
			const newType = newTypeById.get(setting.id);
			if (newType === undefined) {
				drift.push({
					code: "THEME_SETTING_REMOVED",
					message: `setting "${setting.id}" removed from "${type}" — saved merchant values are orphaned`,
				});
			} else if (newType !== setting.type) {
				drift.push({
					code: "THEME_SETTING_RETYPED",
					message: `setting "${setting.id}" in "${type}" changed type ${setting.type} → ${newType} — saved value may not migrate`,
				});
			}
		}
		const newBlockTypes = new Set(newEntry.blocks.map((block) => block.type));
		for (const block of oldEntry.blocks) {
			if (!newBlockTypes.has(block.type)) {
				drift.push({
					code: "THEME_BLOCK_REMOVED",
					message: `block type "${block.type}" removed from "${type}"`,
				});
			}
		}
	}
	return drift;
}
