import type { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeBlockRecord,
	ThemeBlockSettingRecord,
	ThemeFact,
	ThemeSchemaRecord,
	ThemeSettingReadRecord,
	ThemeSettingRecord,
} from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeSchemaSettingPassResult = {
	schemas: ThemeSchemaRecord[];
	settings: ThemeSettingRecord[];
	blocks: ThemeBlockRecord[];
	blockSettings: ThemeBlockSettingRecord[];
	settingReads: ThemeSettingReadRecord[];
};

export type ThemeSchemaSettingRecord =
	| ThemeSchemaRecord
	| ThemeSettingRecord
	| ThemeBlockRecord
	| ThemeBlockSettingRecord
	| ThemeSettingReadRecord;

export type ThemeSchemaSettingPassContext = {
	facts: ThemeFactStore;
	schemaSettingResultsBySource: Map<string, ThemeSchemaSettingPassResult>;
	ids: ThemeSchemaSettingIds;
};

export function createThemeSchemaSettingPass(): IncrementalPass<
	string,
	ThemeSchemaSettingRecord,
	ThemeSchemaSettingPassContext
> {
	return {
		name: "schema-settings",
		stage: "schema",
		routes: [{ kind: "settingChanged", target: "dataFlow" }],
		collectChanges(changes) {
			return new Set(
				changes
					.filter((change) => change.kind === "factsChanged")
					.map((change) => change.path),
			);
		},
		run(paths, context) {
			const records: ThemeSchemaSettingRecord[] = [];
			const changedIds = new Set<string>();
			for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
				const previous = context.schemaSettingResultsBySource.get(path);
				const next = collectThemeSchemaSettings(
					context.facts.getFile(path),
					context.ids,
				);
				for (const record of recordsFromResult(previous))
					changedIds.add(record.id);
				for (const record of recordsFromResult(next)) changedIds.add(record.id);
				if (recordsFromResult(next).length === 0) {
					context.schemaSettingResultsBySource.delete(path);
				} else {
					context.schemaSettingResultsBySource.set(path, next);
				}
				records.push(...recordsFromResult(next));
			}
			return {
				records,
				changes: [...changedIds]
					.sort((a, b) => a.localeCompare(b))
					.map((id): PassChange => ({ kind: "settingChanged", id })),
			};
		},
	};
}

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

function recordsFromResult(
	result: ThemeSchemaSettingPassResult | undefined,
): ThemeSchemaSettingRecord[] {
	if (!result) return [];
	return [
		...result.schemas,
		...result.settings,
		...result.blocks,
		...result.blockSettings,
		...result.settingReads,
	];
}
