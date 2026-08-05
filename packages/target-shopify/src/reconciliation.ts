import type { Diagnostic } from "@nazare/core";
import type { ShopifySchemaLock } from "./build-products.js";

export type ShopifyMigration =
	| { id: string; op: "renameSection"; from: string; to: string }
	| {
			id: string;
			op: "renameSetting";
			section: string | null;
			from: string;
			to: string;
	  }
	| { id: string; op: "renameBlock"; from: string; to: string }
	| {
			id: string;
			op: "removeSetting";
			section: string | null;
			setting: string;
	  };

export type ShopifyLocaleMerge = {
	contents: string;
	conflicts: readonly string[];
};

type JsonObject = Record<string, unknown>;
type SectionInstance = {
	type?: string;
	settings?: JsonObject;
	blocks?: Record<string, { type?: string }>;
};

export function applyMigrationsToSchemaLock(
	lock: ShopifySchemaLock,
	migrations: readonly ShopifyMigration[],
): ShopifySchemaLock {
	const sections = Object.fromEntries(
		Object.entries(lock.sections).map(([path, entry]) => [
			path,
			{
				settings: entry.settings.map((setting) => ({ ...setting })),
				blocks: entry.blocks.map((block) => ({ ...block })),
			},
		]),
	);
	for (const migration of migrations) {
		if (migration.op === "renameSection") {
			const from = sectionPath(migration.from);
			if (sections[from]) {
				sections[sectionPath(migration.to)] = sections[from];
				delete sections[from];
			}
		} else if (migration.op === "renameSetting" && migration.section) {
			const entry = sections[sectionPath(migration.section)];
			if (entry) {
				for (const setting of entry.settings) {
					if (setting.id === migration.from) setting.id = migration.to;
				}
			}
		} else if (migration.op === "removeSetting" && migration.section) {
			const entry = sections[sectionPath(migration.section)];
			if (entry) {
				entry.settings = entry.settings.filter(
					(setting) => setting.id !== migration.setting,
				);
			}
		} else if (migration.op === "renameBlock") {
			for (const entry of Object.values(sections)) {
				for (const block of entry.blocks) {
					if (block.type === migration.from) block.type = migration.to;
				}
			}
		}
	}
	return { version: 1, sections };
}

export function applyMigrationsToMerchantData(
	data: Readonly<Record<string, string>>,
	migrations: readonly ShopifyMigration[],
): {
	contents: Readonly<Record<string, string>>;
	changedPaths: readonly string[];
	diagnostics: readonly Diagnostic[];
} {
	const contents: Record<string, string> = {};
	const changedPaths: string[] = [];
	const diagnostics: Diagnostic[] = [];
	for (const [path, raw] of Object.entries(data)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			diagnostics.push({
				severity: "warning",
				phase: "emit",
				code: "SHOPIFY_MIGRATION_SKIPPED",
				message: `${path}: invalid JSON; migrations not applied`,
			});
			contents[path] = raw;
			continue;
		}
		const before = JSON.stringify(parsed);
		if (path === "config/settings_data.json" && isObject(parsed)) {
			transformSettingsData(parsed, migrations);
		} else transformSectionsContainer(parsed, migrations);
		if (JSON.stringify(parsed) === before) contents[path] = raw;
		else {
			contents[path] = `${JSON.stringify(parsed, null, 2)}\n`;
			changedPaths.push(path);
		}
	}
	return { contents, changedPaths, diagnostics };
}

export function mergeShopifyLocale(
	base: unknown,
	source: unknown,
	merchant: unknown,
): ShopifyLocaleMerge {
	const conflicts: string[] = [];
	const value = mergeLocaleNode(base, source, merchant, "", conflicts);
	return { contents: `${JSON.stringify(value, null, 2)}\n`, conflicts };
}

function transformSettingsData(
	root: JsonObject,
	migrations: readonly ShopifyMigration[],
): void {
	if (isObject(root.current)) {
		transformGlobalSettings(root.current, migrations);
		transformSectionsContainer(root.current, migrations);
	}
	if (isObject(root.presets)) {
		for (const preset of Object.values(root.presets)) {
			if (!isObject(preset)) continue;
			transformGlobalSettings(preset, migrations);
			transformSectionsContainer(preset, migrations);
		}
	}
}

function transformSectionsContainer(
	container: unknown,
	migrations: readonly ShopifyMigration[],
): void {
	if (!isObject(container) || !isObject(container.sections)) return;
	for (const instance of Object.values(container.sections)) {
		if (isObject(instance)) transformInstance(instance, migrations);
	}
}

function transformInstance(
	instance: SectionInstance,
	migrations: readonly ShopifyMigration[],
): void {
	for (const migration of migrations) {
		if (migration.op === "renameSection" && instance.type === migration.from) {
			instance.type = migration.to;
		} else if (
			migration.op === "renameSetting" &&
			migration.section === instance.type &&
			instance.settings &&
			migration.from in instance.settings
		) {
			instance.settings[migration.to] = instance.settings[migration.from];
			delete instance.settings[migration.from];
		} else if (
			migration.op === "removeSetting" &&
			migration.section === instance.type &&
			instance.settings
		) {
			delete instance.settings[migration.setting];
		} else if (migration.op === "renameBlock" && instance.blocks) {
			for (const block of Object.values(instance.blocks)) {
				if (block.type === migration.from) block.type = migration.to;
			}
		}
	}
}

function transformGlobalSettings(
	settings: JsonObject,
	migrations: readonly ShopifyMigration[],
): void {
	for (const migration of migrations) {
		if (
			migration.op === "renameSetting" &&
			migration.section === null &&
			migration.from in settings
		) {
			settings[migration.to] = settings[migration.from];
			delete settings[migration.from];
		} else if (migration.op === "removeSetting" && migration.section === null) {
			delete settings[migration.setting];
		}
	}
}

function mergeLocaleNode(
	base: unknown,
	source: unknown,
	merchant: unknown,
	path: string,
	conflicts: string[],
): unknown {
	if (isObject(source) || isObject(merchant)) {
		if (source !== undefined && !isObject(source)) return source;
		const sourceObject = isObject(source) ? source : {};
		const merchantObject = isObject(merchant) ? merchant : {};
		const baseObject = isObject(base) ? base : {};
		const output: JsonObject = {};
		for (const key of new Set([
			...Object.keys(sourceObject),
			...Object.keys(merchantObject),
		])) {
			const value = mergeLocaleNode(
				baseObject[key],
				sourceObject[key],
				merchantObject[key],
				path ? `${path}.${key}` : key,
				conflicts,
			);
			if (value !== undefined) output[key] = value;
		}
		return output;
	}
	if (base === undefined) return merchant !== undefined ? merchant : source;
	if (merchant === undefined) return source;
	if (source === undefined) {
		if (merchant === base) return undefined;
		conflicts.push(path);
		return merchant;
	}
	if (merchant === base) return source;
	if (source === base) return merchant;
	if (source === merchant) return source;
	conflicts.push(path);
	return merchant;
}

function sectionPath(type: string): string {
	return `sections/${type}.liquid`;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
