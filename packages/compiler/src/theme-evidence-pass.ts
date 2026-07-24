import { docParamEvidenceId } from "./theme-expected-input-pass.js";
import type {
	ThemeBlockInstanceRecord,
	ThemeCapabilitySignalRecord,
	ThemeDataAccessRecord,
	ThemeEvidenceRecord,
	ThemeFact,
	ThemeLocaleReferenceRecord,
	ThemeReference,
	ThemeRenderArgumentRecord,
	ThemeSchemaRecord,
	ThemeSectionInstanceRecord,
	ThemeSemanticModel,
	ThemeSettingReadRecord,
	ThemeSettingRecord,
	ThemeVariableReadRecord,
} from "./theme-facts.js";

export type ThemeEvidenceInputs = {
	references: ThemeReference[];
	sectionInstances: ThemeSectionInstanceRecord[];
	blockInstances: ThemeBlockInstanceRecord[];
	localeReferences: ThemeLocaleReferenceRecord[];
	schemas: ThemeSchemaRecord[];
	settings: ThemeSettingRecord[];
	settingReads: ThemeSettingReadRecord[];
	dataAccesses: ThemeDataAccessRecord[];
	variableReads: ThemeVariableReadRecord[];
	renderArguments: ThemeRenderArgumentRecord[];
	capabilitySignals: ThemeCapabilitySignalRecord[];
	docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[];
};

export function deriveThemeEvidence(
	model: ThemeSemanticModel,
	facts: ThemeFact[],
): ThemeEvidenceRecord[] {
	return deriveThemeEvidenceRecords({
		references: model.references,
		sectionInstances: model.sectionInstances,
		blockInstances: model.blockInstances,
		localeReferences: model.localeReferences,
		schemas: model.schemas,
		settings: model.settings,
		settingReads: model.settingReads,
		dataAccesses: model.dataAccesses,
		variableReads: model.variableReads,
		renderArguments: model.renderArguments,
		capabilitySignals: model.capabilitySignals,
		docParams: facts.filter(
			(fact): fact is Extract<ThemeFact, { kind: "declaresDocParam" }> =>
				fact.kind === "declaresDocParam",
		),
	});
}

export function deriveThemeEvidenceRecords(
	records: ThemeEvidenceInputs,
): ThemeEvidenceRecord[] {
	return [
		...records.docParams.map((param) => ({
			id: docParamEvidenceId(param.path, param.name),
			kind: "docParam" as const,
			file: param.path,
			span: param.span,
			extractor: "theme-source-facts",
		})),
		...records.sectionInstances.map((instance) => ({
			id: instance.id,
			kind: "templateConfig" as const,
			file: instance.templatePath,
			extractor: "theme-json-facts",
		})),
		...records.blockInstances.map((instance) => ({
			id: instance.id,
			kind: "templateConfig" as const,
			file: instance.ownerPath,
			extractor: "theme-json-facts",
		})),
		...records.references.map((reference) => ({
			id: reference.id,
			kind:
				reference.kind === "rendersSnippet"
					? ("renderCall" as const)
					: ("dependency" as const),
			file: reference.fromPath,
			span: reference.span,
			extractor: "theme-liquid-dependencies",
		})),
		...records.localeReferences.map((reference) => ({
			id: reference.id,
			kind: "dependency" as const,
			file: reference.fromPath,
			span: reference.span,
			extractor: "theme-source-facts",
		})),
		...records.schemas.map((schema) => ({
			id: schema.id,
			kind: "schema" as const,
			file: schema.path,
			span: schema.span,
			extractor: "theme-schema",
		})),
		...records.settings.map((setting) => ({
			id: setting.id,
			kind: "schemaSetting" as const,
			file: setting.path,
			span: setting.span,
			extractor: "theme-schema",
		})),
		...records.settingReads.map((read) => ({
			id: read.id,
			kind: "settingRead" as const,
			file: read.fromPath,
			span: read.span,
			extractor: "theme-source-facts",
		})),
		...records.dataAccesses.map((access) => ({
			id: access.id,
			kind: "dataRead" as const,
			file: access.fromPath,
			span: access.span,
			extractor: "theme-source-facts",
		})),
		...records.variableReads.map((read) => ({
			id: read.id,
			kind: "dataRead" as const,
			file: read.fromPath,
			span: read.span,
			extractor: "theme-source-facts",
		})),
		...records.renderArguments.map((argument) => ({
			id: argument.id,
			kind: "renderArgument" as const,
			file: argument.fromPath,
			span: argument.span,
			extractor: "theme-source-facts",
		})),
		...records.capabilitySignals.map((signal) => ({
			id: signal.id,
			kind: "dataRead" as const,
			file: signal.path,
			span: signal.span,
			extractor: "theme-source-facts",
		})),
	].sort((a, b) => a.id.localeCompare(b.id));
}
