import type { SourceSpan } from "@nazare/core";

export type ThemeEvidenceRecord = {
	id: string;
	kind:
		| "schema"
		| "schemaSetting"
		| "settingRead"
		| "dataRead"
		| "renderCall"
		| "renderArgument"
		| "templateConfig"
		| "dependency"
		| "docParam"
		| "inputDeclaration"
		| "localeTranslation"
		| "behavior";
	file: string;
	span?: SourceSpan;
	extractor: string;
};
