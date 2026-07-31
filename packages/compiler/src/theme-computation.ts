import type { Diagnostic } from "@nazare/core";
import { compareCanonicalStrings } from "./canonical-order.js";
import {
	type ThemeBehaviorConnectionsResult,
	ThemeBehaviorIndex,
	type ThemeBehaviorQuery,
	type ThemeBehaviorQueryResult,
	type ThemeBehaviorQueryRole,
} from "./theme-behavior-index.js";

import type {
	InspectNazareThemeResult,
	ThemeAnalysis,
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
	private behaviorIndexValue: ThemeBehaviorIndex | undefined;
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

	queryBehavior(
		query: ThemeBehaviorQuery,
		role: ThemeBehaviorQueryRole,
	): ThemeBehaviorQueryResult {
		return this.getBehaviorIndex().query(query, role);
	}

	getBehaviorConnections(
		path: string,
	): ThemeBehaviorConnectionsResult | undefined {
		return this.getBehaviorIndex().getConnections(path);
	}

	private getBehaviorIndex(): ThemeBehaviorIndex {
		this.behaviorIndexValue ??= new ThemeBehaviorIndex(this.model);
		return this.behaviorIndexValue;
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
