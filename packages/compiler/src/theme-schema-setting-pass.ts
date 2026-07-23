import type {
	ThemeBlockRecord,
	ThemeBlockSettingRecord,
	ThemeFact,
	ThemeSchemaRecord,
	ThemeSettingReadRecord,
	ThemeSettingRecord,
} from "./theme-facts.js";

export type ThemeSchemaSettingPassResult = {
	schemas: ThemeSchemaRecord[];
	settings: ThemeSettingRecord[];
	blocks: ThemeBlockRecord[];
	blockSettings: ThemeBlockSettingRecord[];
	settingReads: ThemeSettingReadRecord[];
};

export type ThemeSchemaSettingIds = {
	schema(path: string, schemaPath: string): string;
	setting(path: string, schemaPath: string, settingId: string): string;
	block(path: string, blockType: string): string;
	blockSetting(path: string, blockType: string, settingId: string): string;
	settingRead(
		path: string,
		settingObject: ThemeSettingReadRecord["settingObject"],
		settingId: string,
		span: ThemeSettingReadRecord["span"],
	): string;
};

export function collectThemeSchemaSettings(
	facts: ThemeFact[],
	ids: ThemeSchemaSettingIds,
): ThemeSchemaSettingPassResult {
	const schemas: ThemeSchemaRecord[] = [];
	const settings: ThemeSettingRecord[] = [];
	const blocks: ThemeBlockRecord[] = [];
	const blockSettings: ThemeBlockSettingRecord[] = [];
	const settingReads: ThemeSettingReadRecord[] = [];
	for (const fact of facts) {
		if (fact.kind === "definesSchema") {
			schemas.push({
				id: ids.schema(fact.path, fact.schemaPath),
				path: fact.path,
				schemaPath: fact.schemaPath,
				span: fact.span,
			});
		}
		if (fact.kind === "definesSetting") {
			settings.push({
				id: ids.setting(fact.path, fact.schemaPath, fact.settingId),
				path: fact.path,
				schemaPath: fact.schemaPath,
				settingId: fact.settingId,
				settingType: fact.settingType,
				span: fact.span,
			});
		}
		if (fact.kind === "declaresBlock") {
			blocks.push({
				id: ids.block(fact.path, fact.blockType),
				path: fact.path,
				blockType: fact.blockType,
				name: fact.name,
				span: fact.span,
			});
		}
		if (fact.kind === "definesBlockSetting") {
			blockSettings.push({
				id: ids.blockSetting(fact.path, fact.blockType, fact.settingId),
				path: fact.path,
				blockType: fact.blockType,
				settingId: fact.settingId,
				settingType: fact.settingType,
				span: fact.span,
			});
		}
		if (fact.kind === "readsSetting") {
			settingReads.push({
				id: ids.settingRead(
					fact.fromPath,
					fact.settingObject,
					fact.settingId,
					fact.span,
				),
				fromPath: fact.fromPath,
				settingObject: fact.settingObject,
				settingId: fact.settingId,
				span: fact.span,
			});
		}
	}
	return { schemas, settings, blocks, blockSettings, settingReads };
}
