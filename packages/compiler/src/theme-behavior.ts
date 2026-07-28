import type {
	ThemeBehaviorFact,
	ThemeBehaviorRecord,
	ThemeEvidenceRecord,
	ThemeFact,
	ThemeSourceAnalysisRecord,
} from "./theme-facts.js";

export type ThemeBehaviorCollection = {
	records: ThemeBehaviorRecord[];
	sourceAnalyses: ThemeSourceAnalysisRecord[];
	evidence: ThemeEvidenceRecord[];
};

export function collectThemeBehavior(
	facts: ThemeFact[],
): ThemeBehaviorCollection {
	const behaviorFacts = facts.filter(
		(fact): fact is ThemeBehaviorFact => fact.kind === "behavior",
	);
	const records = behaviorFacts
		.map((fact) => {
			const { kind: _kind, ...record } = fact;
			return { ...record, id: themeBehaviorId(fact) };
		})
		.sort((a, b) => a.id.localeCompare(b.id));
	const sourceAnalyses = facts
		.filter(
			(fact): fact is Extract<ThemeFact, { kind: "sourceAnalysis" }> =>
				fact.kind === "sourceAnalysis",
		)
		.map((fact) => ({
			id: `source-analysis:${encodeURIComponent(fact.path)}`,
			path: fact.path,
			language: fact.language,
			completeness: fact.completeness,
			uncertainty: fact.uncertainty,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
	return {
		records,
		sourceAnalyses,
		evidence: records.map((record) => ({
			id: record.id,
			kind: "behavior",
			file: record.fromPath,
			span: record.span,
			extractor: record.extractor,
		})),
	};
}

export function themeBehaviorId(fact: ThemeBehaviorFact): string {
	const location = fact.span
		? `${fact.span.start.line}:${fact.span.start.column}`
		: "unknown";
	const hookKind = fact.subjectKind === "domHook" ? `:${fact.hookKind}` : "";
	return `behavior:${encodeURIComponent(fact.fromPath)}:${location}:${fact.subjectKind}${hookKind}:${fact.operation}:${encodeURIComponent(fact.name)}`;
}
