import {
	createDefaultSourceParserRegistry,
	type EmbeddedRegion,
	type LiquidSyntaxFacts,
	liquidSyntaxFacts,
	type NazareSyntaxFact,
	type NazareSyntaxProblem,
	nazareSyntaxFacts,
	parseSourceDocument,
	type SourceLanguage,
	type SourceParseIssue,
} from "@nazare/source";

export const SOURCE_ANALYSIS_SCHEMA_VERSION = 1 as const;
export const DEFAULT_SOURCE_ANALYSIS_LANGUAGE: SourceLanguage = "liquid";

type SourceAnalysisBase = {
	schemaVersion: typeof SOURCE_ANALYSIS_SCHEMA_VERSION;
	file: string;
	language: SourceLanguage;
	authoritative: boolean;
	issues: readonly SourceParseIssue[];
	embeddedRegions: readonly EmbeddedRegion[];
};

export type LiquidSourceAnalysisResult = SourceAnalysisBase & {
	language: "liquid";
	syntax: { liquid: LiquidSyntaxFacts };
};

export type NazareSourceAnalysisResult = SourceAnalysisBase & {
	language: "nazare-liquid";
	problems: readonly NazareSyntaxProblem[];
	syntax: {
		nazare: readonly NazareSyntaxFact[];
		liquid: LiquidSyntaxFacts;
	};
};

export type SourceAnalysisResult =
	| LiquidSourceAnalysisResult
	| NazareSourceAnalysisResult;

export function analyzeSource(input: {
	file: string;
	source: string;
	language?: SourceLanguage;
}): SourceAnalysisResult {
	const language = input.language ?? DEFAULT_SOURCE_ANALYSIS_LANGUAGE;
	const document = parseSourceDocument(
		createDefaultSourceParserRegistry(),
		input.file,
		language,
		input.source,
	);
	if (language === "nazare-liquid") {
		const nazare = nazareSyntaxFacts(document);
		return {
			schemaVersion: SOURCE_ANALYSIS_SCHEMA_VERSION,
			file: document.file,
			language,
			authoritative: nazare.authoritative,
			issues: document.issues,
			problems: nazare.problems,
			embeddedRegions: document.embeddedRegions,
			syntax: {
				nazare: nazare.facts,
				liquid: nazare.liquid,
			},
		};
	}
	const liquid = liquidSyntaxFacts(document);
	return {
		schemaVersion: SOURCE_ANALYSIS_SCHEMA_VERSION,
		file: document.file,
		language,
		authoritative: liquid.authoritative,
		issues: document.issues,
		embeddedRegions: document.embeddedRegions,
		syntax: { liquid },
	};
}
