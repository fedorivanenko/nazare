// Author-written migrations for Shopify theme data. When a developer renames a
// section type or a setting id, or drops a setting, the saved merchant values in
// the live theme are keyed by the OLD name and would strand. A migration
// mechanically rewrites those values so they survive the rename, and is applied
// to two targets from one definition: the pulled Zone B data (the actual values)
// and the prior schema lock (so the drift diff no longer flags the change).
//
// Every migration carries a stable `id`. The build records which ids have been
// applied to each target theme (see the ledger in index.ts) and skips them next
// time, so a migration runs exactly ONCE per target — a later, unrelated setting
// that reuses an old name is not clobbered by a stale rename. Ops apply in file
// order and mutate in place, so a `renameSetting` after a `renameSection` must
// name the section by its NEW type. Migrations are append-only history.

import type { Diagnostic } from "@nazare/core";

type MigrationOp =
	| { op: "renameSection"; from: string; to: string }
	| { op: "renameSetting"; section?: string; from: string; to: string }
	| { op: "renameBlock"; from: string; to: string }
	| { op: "removeSetting"; section?: string; setting: string };

export type Migration = MigrationOp & { id: string };

type Json = Record<string, unknown>;

function invalid(file: string, message: string): Diagnostic {
	return {
		severity: "error",
		phase: "emit",
		code: "THEME_MIGRATION_INVALID",
		message: `${file}: ${message}`,
	};
}

/** Parses and validates a migrations file. Invalid entries yield error diagnostics. */
export function parseMigrations(
	raw: string,
	file: string,
): { migrations: Migration[]; issues: Diagnostic[] } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		return {
			migrations: [],
			issues: [
				invalid(
					file,
					`not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				),
			],
		};
	}

	const list = (parsed as Json)?.migrations;
	if (!Array.isArray(list)) {
		return {
			migrations: [],
			issues: [invalid(file, 'missing "migrations" array')],
		};
	}

	const migrations: Migration[] = [];
	const issues: Diagnostic[] = [];
	const seenIds = new Set<string>();
	list.forEach((entry, index) => {
		const at = `migrations[${index}]`;
		if (!entry || typeof entry !== "object") {
			issues.push(invalid(file, `${at} is not an object`));
			return;
		}
		const str = (key: string): string | undefined => {
			const value = (entry as Json)[key];
			return typeof value === "string" && value.length > 0 ? value : undefined;
		};

		const id = str("id");
		if (!id) {
			issues.push(invalid(file, `${at} needs a non-empty "id"`));
			return;
		}
		if (seenIds.has(id)) {
			issues.push(invalid(file, `${at} duplicate id ${JSON.stringify(id)}`));
			return;
		}
		seenIds.add(id);

		const op = (entry as Json).op;
		switch (op) {
			case "renameSection":
			case "renameBlock": {
				const from = str("from");
				const to = str("to");
				if (!from || !to)
					issues.push(invalid(file, `${at} ${op} needs "from" and "to"`));
				else migrations.push({ id, op, from, to });
				return;
			}
			case "renameSetting": {
				const from = str("from");
				const to = str("to");
				if (!from || !to)
					issues.push(
						invalid(file, `${at} renameSetting needs "from" and "to"`),
					);
				else migrations.push({ id, op, from, to, section: str("section") });
				return;
			}
			case "removeSetting": {
				const setting = str("setting");
				if (!setting)
					issues.push(invalid(file, `${at} removeSetting needs "setting"`));
				else migrations.push({ id, op, setting, section: str("section") });
				return;
			}
			default:
				issues.push(invalid(file, `${at} unknown op ${JSON.stringify(op)}`));
		}
	});

	return { migrations, issues };
}

// --- schema-lock manifest transform -------------------------------------------

type SchemaSetting = { id: string; type: string };
type SchemaEntry = { settings: SchemaSetting[]; blocks: { type: string }[] };
type SchemaManifest = { version: 1; sections: Record<string, SchemaEntry> };

const sectionKey = (type: string) => `sections/${type}.liquid`;

/**
 * Applies migrations to a schema lock so the drift diff compares against the
 * post-rename expectation: a migrated change goes silent, an unmigrated one
 * still warns. Idempotent, so the full migration list is always safe to apply.
 */
export function applyMigrationsToManifest(
	manifest: SchemaManifest,
	migrations: Migration[],
): SchemaManifest {
	const sections: Record<string, SchemaEntry> = {};
	for (const [key, entry] of Object.entries(manifest.sections)) {
		sections[key] = {
			settings: entry.settings.map((s) => ({ ...s })),
			blocks: entry.blocks.map((b) => ({ ...b })),
		};
	}

	for (const migration of migrations) {
		switch (migration.op) {
			case "renameSection": {
				const fromKey = sectionKey(migration.from);
				if (sections[fromKey]) {
					sections[sectionKey(migration.to)] = sections[fromKey];
					delete sections[fromKey];
				}
				break;
			}
			case "renameSetting": {
				const entry = migration.section
					? sections[sectionKey(migration.section)]
					: undefined;
				if (entry) {
					for (const setting of entry.settings) {
						if (setting.id === migration.from) setting.id = migration.to;
					}
				}
				break;
			}
			case "removeSetting": {
				const entry = migration.section
					? sections[sectionKey(migration.section)]
					: undefined;
				if (entry)
					entry.settings = entry.settings.filter(
						(s) => s.id !== migration.setting,
					);
				break;
			}
			case "renameBlock": {
				for (const entry of Object.values(sections)) {
					for (const block of entry.blocks) {
						if (block.type === migration.from) block.type = migration.to;
					}
				}
				break;
			}
		}
	}

	return { version: manifest.version, sections };
}

// --- Zone B data transform ----------------------------------------------------

type SectionInstance = {
	type?: string;
	settings?: Json;
	blocks?: Record<string, { type?: string; settings?: Json }>;
};

function transformInstance(
	instance: SectionInstance,
	migrations: Migration[],
): void {
	for (const migration of migrations) {
		switch (migration.op) {
			case "renameSection":
				if (instance.type === migration.from) instance.type = migration.to;
				break;
			case "renameSetting":
				if (
					migration.section &&
					instance.type === migration.section &&
					instance.settings &&
					migration.from in instance.settings
				) {
					instance.settings[migration.to] = instance.settings[migration.from];
					delete instance.settings[migration.from];
				}
				break;
			case "removeSetting":
				if (
					migration.section &&
					instance.type === migration.section &&
					instance.settings
				) {
					delete instance.settings[migration.setting];
				}
				break;
			case "renameBlock":
				if (instance.blocks) {
					for (const block of Object.values(instance.blocks)) {
						if (block.type === migration.from) block.type = migration.to;
					}
				}
				break;
		}
	}
}

// Rewrites a container that holds a `sections` instance map (a template or a
// section group). settings_data.json also nests one under `current.sections`.
function transformSectionsContainer(
	container: unknown,
	migrations: Migration[],
): void {
	if (!container || typeof container !== "object") return;
	const sections = (container as Json).sections;
	if (!sections || typeof sections !== "object") return;
	for (const instance of Object.values(sections as Json)) {
		if (instance && typeof instance === "object")
			transformInstance(instance as SectionInstance, migrations);
	}
}

// Theme-global (section-less) setting renames/removals touch the flat setting
// keys under settings_data `current` and each named preset.
function transformGlobalSettings(
	scope: unknown,
	migrations: Migration[],
): void {
	if (!scope || typeof scope !== "object") return;
	const settings = scope as Json;
	for (const migration of migrations) {
		if (migration.op === "renameSetting" && !migration.section) {
			if (migration.from in settings) {
				settings[migration.to] = settings[migration.from];
				delete settings[migration.from];
			}
		} else if (migration.op === "removeSetting" && !migration.section) {
			delete settings[migration.setting];
		}
	}
}

function transformSettingsData(root: Json, migrations: Migration[]): void {
	const current = root.current;
	if (current && typeof current === "object") {
		transformGlobalSettings(current, migrations);
		transformSectionsContainer(current, migrations);
	}
	const presets = root.presets;
	if (presets && typeof presets === "object") {
		for (const preset of Object.values(presets as Json)) {
			transformGlobalSettings(preset, migrations);
			transformSectionsContainer(preset, migrations);
		}
	}
}

/**
 * Applies migrations to the merchant-owned data files, returning the rewritten
 * contents and the paths that actually changed. Files that are not valid JSON
 * are left untouched with a warning.
 */
export function applyMigrationsToData(
	data: Map<string, string>,
	migrations: Migration[],
): { data: Map<string, string>; changed: string[]; issues: Diagnostic[] } {
	if (migrations.length === 0) return { data, changed: [], issues: [] };

	const out = new Map<string, string>();
	const changed: string[] = [];
	const issues: Diagnostic[] = [];

	for (const [path, raw] of data) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			issues.push({
				severity: "warning",
				phase: "emit",
				code: "THEME_MIGRATION_SKIPPED",
				message: `${path}: not valid JSON, migrations not applied`,
			});
			out.set(path, raw);
			continue;
		}

		const before = JSON.stringify(parsed);
		if (path === "config/settings_data.json") {
			transformSettingsData(parsed as Json, migrations);
		} else {
			transformSectionsContainer(parsed, migrations);
		}
		const after = JSON.stringify(parsed);

		if (after === before) {
			out.set(path, raw); // no logical change — keep original formatting
		} else {
			out.set(path, `${JSON.stringify(parsed, null, 2)}\n`);
			changed.push(path);
		}
	}

	return { data: out, changed, issues };
}
