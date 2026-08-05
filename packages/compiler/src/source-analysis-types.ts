import type { SourceSpan } from "@nazare/core";

export type SourceAnalysisUncertainty = {
	code: string;
	message: string;
	span?: SourceSpan;
};

export type AnalyzedSourceFact = {
	kind: string;
	targetName?: string;
	fromPath?: string;
	subjectKind?: string;
	hookKind?: string;
	operation?: string;
	name?: string;
	span?: SourceSpan;
	extractor?: string;
};
