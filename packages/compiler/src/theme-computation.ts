import type { Diagnostic } from "@nazare/core";
import { compareCanonicalStrings } from "./canonical-order.js";
import type {
	InspectNazareThemeResult,
	ThemeAnalysis,
	ThemeBehaviorRecord,
	ThemeFileRecord,
	ThemeImpactSummary,
	ThemeSemanticModel,
} from "./theme-facts.js";
import type { ThemeFileKind } from "./theme-file-classifier.js";
import { themeGraphFromModel } from "./theme-graph-output.js";
import { impactSummary } from "./theme-impact.js";

export type ThemeRenderOccurrence = {
	id: string;
	fromPath: string;
	targetPath?: string;
	targetName?: string;
	invocationKind: "render" | "include";
	span?: ThemeSemanticModel["renderSites"][number]["span"];
};

export type ThemeBehaviorQuery =
	| {
			subjectKind: "domHook";
			hookKind: "class" | "id" | "attribute";
			name: string;
	  }
	| {
			subjectKind: "customProperty" | "customEvent" | "customElement";
			name: string;
	  };

export type ThemeBehaviorConnection = {
	usage: ThemeBehaviorRecord;
	related: ThemeBehaviorRecord[];
};

export type ThemeFileImpact = {
	version: 1;
	path: string;
	fileKind: ThemeFileKind;
	usage: "entry" | "used" | "unused" | "unknown";
	certainty: "complete" | "partial";
	uncertainty: string[];
	dependencies: string[];
	dependents: string[];
	affectedPages: string[];
	issues: Diagnostic[];
};

/**
 * Canonical computation result. Typed semantic records and direct indexes are
 * primary; the public graph is a lazy, deterministic projection.
 */
export class ThemeComputation {
	readonly analysis: ThemeAnalysis;
	readonly model: ThemeSemanticModel;
	private readonly filesByPath: Map<string, ThemeFileRecord>;
	private readonly sourceAnalysisByPath: Map<
		string,
		ThemeSemanticModel["sourceAnalyses"][number]
	>;
	private readonly issuesByPath: Map<string, Diagnostic[]>;
	private readonly dynamicTargetKinds: Set<string>;
	private behaviorBySubjectValue:
		| Map<string, ThemeBehaviorRecord[]>
		| undefined;
	private impactSummaryValue: ThemeImpactSummary | undefined;
	private unusedFilesValue: Set<string> | undefined;
	private graphValue: InspectNazareThemeResult | undefined;
	private impactsValue: Map<string, ThemeFileImpact> | undefined;

	constructor(
		analysis: ThemeAnalysis,
		initial: { impactSummary?: ThemeImpactSummary } = {},
	) {
		this.analysis = analysis;
		this.model = analysis.ir;
		this.filesByPath = new Map(
			this.model.files.map((file) => [file.path, file]),
		);
		this.sourceAnalysisByPath = new Map(
			this.model.sourceAnalyses.map((record) => [record.path, record]),
		);
		this.issuesByPath = issuesByPath(this.model.issues);
		this.impactSummaryValue = initial.impactSummary;
		this.dynamicTargetKinds = new Set(
			this.model.references
				.filter((reference) => !reference.static)
				.map((reference) => reference.targetKind),
		);
	}

	getImpactSummary(): ThemeImpactSummary {
		this.impactSummaryValue ??= impactSummary(this.model);
		return this.impactSummaryValue;
	}

	getFileImpact(path: string): ThemeFileImpact | undefined {
		const file = this.filesByPath.get(path);
		if (!file) return undefined;
		const summary = this.getImpactSummary();
		const dependents = summary.dependents[path] ?? [];
		const targetKind = dynamicTargetKind(file.fileKind);
		const hasDynamicReference =
			targetKind !== undefined && this.dynamicTargetKinds.has(targetKind);
		const sourceAnalysis = this.sourceAnalysisByPath.get(path);
		const uncertainty = [
			...(hasDynamicReference
				? [
						`Theme contains a dynamic ${targetKind} reference that may resolve to ${path}`,
					]
				: []),
			...(sourceAnalysis?.uncertainty ?? []),
		];
		return {
			version: 1,
			path,
			fileKind: file.fileKind,
			usage: themeFileUsage(
				file.fileKind,
				dependents.length,
				this.getUnusedFiles().has(path),
				hasDynamicReference,
			),
			certainty: uncertainty.length > 0 ? "partial" : "complete",
			uncertainty,
			dependencies: summary.dependencies[path] ?? [],
			dependents,
			affectedPages: summary.affectedPages[path] ?? [],
			issues: this.issuesByPath.get(path) ?? [],
		};
	}

	getBehaviorUsages(query: ThemeBehaviorQuery): ThemeBehaviorRecord[] {
		return [
			...(this.getBehaviorBySubject().get(behaviorSubjectKey(query)) ?? []),
		];
	}

	private getBehaviorBySubject(): Map<string, ThemeBehaviorRecord[]> {
		if (this.behaviorBySubjectValue) return this.behaviorBySubjectValue;
		const index = new Map<string, ThemeBehaviorRecord[]>();
		for (const record of this.model.behavior) {
			const key = behaviorSubjectKey(record);
			const records = index.get(key);
			if (records) records.push(record);
			else index.set(key, [record]);
		}
		this.behaviorBySubjectValue = index;
		return index;
	}

	getBehaviorProducers(query: ThemeBehaviorQuery): ThemeBehaviorRecord[] {
		return this.getBehaviorUsages(query).filter(isBehaviorProducer);
	}

	getBehaviorConsumers(query: ThemeBehaviorQuery): ThemeBehaviorRecord[] {
		return this.getBehaviorUsages(query).filter(isBehaviorConsumer);
	}

	getBehaviorConnections(path: string): ThemeBehaviorConnection[] {
		return this.model.behavior
			.filter((usage) => usage.fromPath === path)
			.map((usage) => ({
				usage,
				related: this.getBehaviorUsages(behaviorQuery(usage)).filter(
					(record) => record.id !== usage.id,
				),
			}))
			.filter((connection) => connection.related.length > 0)
			.sort((a, b) => compareCanonicalStrings(a.usage.id, b.usage.id));
	}

	getRenderOccurrences(path: string): ThemeRenderOccurrence[] {
		const declarationPathById = new Map(
			this.model.declarations.map((declaration) => [
				declaration.id,
				declaration.path,
			]),
		);
		return this.model.renderSites
			.map(
				(site): ThemeRenderOccurrence => ({
					id: site.id,
					fromPath: site.fromPath,
					targetPath: site.resolvedDeclarationId
						? declarationPathById.get(site.resolvedDeclarationId)
						: undefined,
					targetName: site.targetName,
					invocationKind: site.invocationKind,
					span: site.span,
				}),
			)
			.filter(
				(occurrence) =>
					occurrence.fromPath === path || occurrence.targetPath === path,
			)
			.sort((a, b) => compareCanonicalStrings(a.id, b.id));
	}

	getEvidence(recordId: string): ThemeSemanticModel["evidence"] {
		return this.model.evidence.filter((record) => record.id === recordId);
	}

	getFileImpacts(): Map<string, ThemeFileImpact> {
		if (this.impactsValue) return this.impactsValue;
		const impacts = new Map<string, ThemeFileImpact>();
		for (const path of this.filesByPath.keys()) {
			const impact = this.getFileImpact(path);
			if (impact) impacts.set(path, impact);
		}
		this.impactsValue = impacts;
		return impacts;
	}

	private getUnusedFiles(): Set<string> {
		this.unusedFilesValue ??= new Set(this.getImpactSummary().unusedFiles);
		return this.unusedFilesValue;
	}

	toInspectGraph(): InspectNazareThemeResult {
		this.graphValue ??= themeGraphFromModel(this.model, {
			impact: this.getImpactSummary(),
		});
		return this.graphValue;
	}
}

function behaviorSubjectKey(
	subject: ThemeBehaviorQuery | ThemeBehaviorRecord,
): string {
	const hookKind = subject.subjectKind === "domHook" ? subject.hookKind : "";
	return `${subject.subjectKind}\0${hookKind}\0${subject.name}`;
}

function behaviorQuery(record: ThemeBehaviorRecord): ThemeBehaviorQuery {
	return record.subjectKind === "domHook"
		? {
				subjectKind: "domHook",
				hookKind: record.hookKind,
				name: record.name,
			}
		: { subjectKind: record.subjectKind, name: record.name };
}

function isBehaviorProducer(record: ThemeBehaviorRecord): boolean {
	return ["emits", "mutates", "defines", "dispatches"].includes(
		record.operation,
	);
}

function isBehaviorConsumer(record: ThemeBehaviorRecord): boolean {
	return ["selects", "queries", "mutates", "reads", "listens", "uses"].includes(
		record.operation,
	);
}

function issuesByPath(issues: Diagnostic[]): Map<string, Diagnostic[]> {
	const result = new Map<string, Diagnostic[]>();
	for (const issue of issues) {
		const path = issue.span?.file;
		if (!path) continue;
		const owned = result.get(path);
		if (owned) owned.push(issue);
		else result.set(path, [issue]);
	}
	return result;
}

function themeFileUsage(
	fileKind: ThemeFileKind,
	dependentCount: number,
	unused: boolean,
	hasDynamicReference: boolean,
): ThemeFileImpact["usage"] {
	if (
		fileKind === "templateJson" ||
		fileKind === "templateLiquid" ||
		fileKind === "layout" ||
		fileKind === "locale" ||
		fileKind === "settingsSchema" ||
		fileKind === "settingsData"
	) {
		return "entry";
	}
	if (hasDynamicReference) return "unknown";
	if (unused) return "unused";
	if (dependentCount > 0) return "used";
	return "unknown";
}

function dynamicTargetKind(
	fileKind: ThemeFileKind,
):
	| "snippet"
	| "section"
	| "sectionGroup"
	| "layout"
	| "themeBlock"
	| "asset"
	| "component"
	| undefined {
	if (fileKind === "snippet") return "snippet";
	if (fileKind === "section") return "section";
	if (fileKind === "sectionGroup") return "sectionGroup";
	if (fileKind === "layout") return "layout";
	if (fileKind === "themeBlock") return "themeBlock";
	if (fileKind === "asset") return "asset";
	if (fileKind === "nazareComponent") return "component";
	return undefined;
}
