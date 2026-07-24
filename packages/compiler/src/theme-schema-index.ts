import type { Diagnostic } from "@nazare/core";
import type {
	ThemeBlockInstanceRecord,
	ThemeBlockRecord,
	ThemeBlockSettingRecord,
	ThemeDeclaration,
	ThemeLocaleKeyRecord,
	ThemeLocaleReferenceRecord,
	ThemeSectionInstanceRecord,
	ThemeSettingReadRecord,
	ThemeSettingRecord,
} from "./theme-facts.js";

export type ThemeSchemaIndexInput = {
	declarations: ThemeDeclaration[];
	blocks: ThemeBlockRecord[];
	settings: ThemeSettingRecord[];
	blockSettings: ThemeBlockSettingRecord[];
	localeKeys: ThemeLocaleKeyRecord[];
};

export type ThemeRecordResolution<RecordValue> = {
	records: RecordValue[];
	issues: Diagnostic[];
};

export class ThemeSchemaIndex {
	private readonly declarationsByKey = new Map<string, ThemeDeclaration[]>();
	private readonly declarationById = new Map<string, ThemeDeclaration>();
	private readonly settingsByScopeAndId = new Map<string, ThemeSettingRecord>();
	private readonly globalSettingsById = new Map<string, ThemeSettingRecord>();
	private readonly blockSettingsByOwnerAndId = new Map<
		string,
		ThemeBlockSettingRecord[]
	>();
	private readonly blocksByOwnerAndType = new Map<string, ThemeBlockRecord>();
	private readonly localeKeysByKey = new Map<string, ThemeLocaleKeyRecord>();
	private readonly sectionInstancesByOwnerAndId = new Map<
		string,
		ThemeSectionInstanceRecord
	>();

	constructor(input: ThemeSchemaIndexInput) {
		for (const declaration of input.declarations) {
			this.declarationById.set(declaration.id, declaration);
			const key = `${declaration.kind}:${declaration.name}`;
			const declarations = this.declarationsByKey.get(key) ?? [];
			declarations.push(declaration);
			this.declarationsByKey.set(key, declarations);
		}
		for (const setting of input.settings) {
			this.settingsByScopeAndId.set(
				`${setting.path}:${setting.settingId}`,
				setting,
			);
			if (setting.path === "config/settings_schema.json") {
				this.globalSettingsById.set(setting.settingId, setting);
			}
		}
		for (const setting of input.blockSettings) {
			const key = `${setting.path}:${setting.settingId}`;
			const settings = this.blockSettingsByOwnerAndId.get(key) ?? [];
			settings.push(setting);
			this.blockSettingsByOwnerAndId.set(key, settings);
		}
		for (const block of input.blocks) {
			this.blocksByOwnerAndType.set(`${block.path}:${block.blockType}`, block);
		}
		for (const localeKey of input.localeKeys) {
			this.localeKeysByKey.set(localeKey.key, localeKey);
		}
	}

	getSettings(scopePath: string, settingId: string): ThemeSettingRecord[] {
		const setting = this.settingsByScopeAndId.get(`${scopePath}:${settingId}`);
		return setting ? [setting] : [];
	}

	getBlockSettings(
		ownerPath: string,
		settingId: string,
	): ThemeBlockSettingRecord[] {
		return [
			...(this.blockSettingsByOwnerAndId.get(`${ownerPath}:${settingId}`) ??
				[]),
		].sort((a, b) => a.id.localeCompare(b.id));
	}

	getLocaleKey(key: string): ThemeLocaleKeyRecord | undefined {
		return this.localeKeysByKey.get(key);
	}

	getSectionInstance(
		ownerPath: string,
		instanceId: string,
	): ThemeSectionInstanceRecord | undefined {
		return this.sectionInstancesByOwnerAndId.get(`${ownerPath}:${instanceId}`);
	}

	resolveInstances(
		sectionInstances: ThemeSectionInstanceRecord[],
		blockInstances: ThemeBlockInstanceRecord[],
	): {
		sectionInstances: ThemeSectionInstanceRecord[];
		blockInstances: ThemeBlockInstanceRecord[];
	} {
		const resolvedSections = sectionInstances.map((instance) => {
			if (!instance.sectionType)
				return withoutKey(instance, "resolvedDeclarationId");
			const candidates =
				this.declarationsByKey.get(`section:${instance.sectionType}`) ?? [];
			return withOptional(
				instance,
				"resolvedDeclarationId",
				candidates.length === 1 ? candidates[0]?.id : undefined,
			);
		});
		this.sectionInstancesByOwnerAndId.clear();
		for (const instance of resolvedSections) {
			this.sectionInstancesByOwnerAndId.set(
				`${instance.templatePath}:${instance.instanceId}`,
				instance,
			);
		}
		const resolvedBlocks = blockInstances.map((instance) => {
			if (!instance.blockType) return withoutKey(instance, "resolvedBlockId");
			const themeBlocks =
				this.declarationsByKey.get(`themeBlock:${instance.blockType}`) ?? [];
			if (themeBlocks.length === 1) {
				return withOptional(instance, "resolvedBlockId", themeBlocks[0]?.id);
			}
			const section = this.getSectionInstance(
				instance.ownerPath,
				instance.sectionInstanceId,
			);
			const sectionPath = section?.resolvedDeclarationId
				? this.declarationById.get(section.resolvedDeclarationId)?.path
				: undefined;
			const schemaBlock = sectionPath
				? this.blocksByOwnerAndType.get(`${sectionPath}:${instance.blockType}`)
				: undefined;
			return withOptional(instance, "resolvedBlockId", schemaBlock?.id);
		});
		return {
			sectionInstances: resolvedSections,
			blockInstances: resolvedBlocks,
		};
	}

	resolveSettingReads(
		reads: ThemeSettingReadRecord[],
	): ThemeRecordResolution<ThemeSettingReadRecord> {
		const issues: Diagnostic[] = [];
		const records = reads.map((read) => {
			let resolvedSettingId: string | undefined;
			let candidateSettingIds: string[] | undefined;
			if (read.settingObject === "settings") {
				resolvedSettingId = this.globalSettingsById.get(read.settingId)?.id;
			} else if (read.settingObject === "section") {
				resolvedSettingId = this.settingsByScopeAndId.get(
					`${read.fromPath}:${read.settingId}`,
				)?.id;
			} else {
				const candidates = this.getBlockSettings(read.fromPath, read.settingId);
				if (candidates.length === 1) resolvedSettingId = candidates[0]?.id;
				if (candidates.length > 1) {
					candidateSettingIds = candidates.map((candidate) => candidate.id);
					issues.push({
						severity: "warning",
						code: "THEME_AMBIGUOUS_SETTING_READ",
						message: `Block setting read ${read.settingId} from ${read.fromPath} matches multiple block types`,
						phase: "resolve",
						span: read.span,
					});
				}
			}
			if (!resolvedSettingId && !candidateSettingIds) {
				issues.push({
					severity: "warning",
					code: "THEME_UNRESOLVED_SETTING_READ",
					message: `Unresolved ${read.settingObject} setting ${read.settingId} from ${read.fromPath}`,
					phase: "resolve",
					span: read.span,
				});
			}
			return withResolution(read, resolvedSettingId, candidateSettingIds);
		});
		return { records, issues };
	}

	resolveLocaleReferences(
		references: ThemeLocaleReferenceRecord[],
	): ThemeRecordResolution<ThemeLocaleReferenceRecord> {
		const issues: Diagnostic[] = [];
		const records = references.map((reference) => {
			if (!reference.static || !reference.key) return reference;
			const localeKey = this.localeKeysByKey.get(reference.key);
			if (!localeKey) {
				issues.push({
					severity: "warning",
					code: "THEME_UNRESOLVED_LOCALE_KEY",
					message: `Unresolved locale key ${reference.key} from ${reference.fromPath}`,
					phase: "resolve",
					span: reference.span,
				});
			}
			const resolvedLocaleKeyIds = localeKey ? [localeKey.id] : [];
			return arraysEqual(reference.resolvedLocaleKeyIds, resolvedLocaleKeyIds)
				? reference
				: { ...reference, resolvedLocaleKeyIds };
		});
		return { records, issues };
	}
}

function withResolution(
	read: ThemeSettingReadRecord,
	resolvedSettingId: string | undefined,
	candidateSettingIds: string[] | undefined,
): ThemeSettingReadRecord {
	const next = { ...read };
	if (resolvedSettingId) next.resolvedSettingId = resolvedSettingId;
	else delete next.resolvedSettingId;
	if (candidateSettingIds) next.candidateSettingIds = candidateSettingIds;
	else delete next.candidateSettingIds;
	return JSON.stringify(next) === JSON.stringify(read) ? read : next;
}

function withOptional<
	RecordValue extends object,
	Key extends "resolvedDeclarationId" | "resolvedBlockId",
>(record: RecordValue, key: Key, value: string | undefined): RecordValue {
	if ((record as Record<Key, unknown>)[key] === value) return record;
	const next = { ...record } as Record<string, unknown>;
	if (value) next[key] = value;
	else delete next[key];
	return next as RecordValue;
}

function withoutKey<
	RecordValue extends object,
	Key extends "resolvedDeclarationId" | "resolvedBlockId",
>(record: RecordValue, key: Key): RecordValue {
	return withOptional(record, key, undefined);
}

function arraysEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
