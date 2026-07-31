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
import {
	type ThemeMetafieldIdentity,
	ThemeMetafieldIndex,
} from "./theme-metafield-index.js";

export type ThemeRenderOccurrence = {
	id: string;
	fromPath: string;
	targetPath?: string;
	targetName?: string;
	invocationKind: "render" | "include";
	span?: ThemeSemanticModel["renderSites"][number]["span"];
};

/**
 * Public Inspect boundary: checked-out theme sources plus supplied Shopify
 * snapshots. Recognizable calls in local JavaScript files are indexed. Static
 * GraphQL metafield arguments are queryable; dynamic GraphQL is uncertainty.
 * Runtime responses, app proxies, remote app code, and server-side app data
 * stay opaque. Nazare records local call sites but never guesses remote data.
 */
export const THEME_METAFIELD_IMPACT_SCOPE = {
	included: [
		"liquid",
		"shopifyJsonDynamicSources",
		"localJavaScriptNetworkCalls",
		"staticGraphqlMetafieldRequests",
	],
	excluded: [
		"remoteAppRuntime",
		"runtimeNetworkResponses",
		"appProxyResponses",
		"serverSideAppData",
	],
} as const;

export type ThemeMetafieldImpactScope = typeof THEME_METAFIELD_IMPACT_SCOPE;

export type ThemeMetafieldImpact = {
	version: 2;
	scope: ThemeMetafieldImpactScope;
	identity: ThemeMetafieldIdentity;
	definition: ThemeSemanticModel["metafieldDefinitions"][number] | null;
	reads: ThemeSemanticModel["metafieldReads"];
	apiReads: ThemeSemanticModel["networkAccesses"];
	/** All local JavaScript network calls, including non-metafield endpoints. */
	localNetworkAccessCount: number;
	affectedSources: string[];
	affectedPages: string[];
	snapshot: ThemeSemanticModel["metafieldSchema"];
	certainty: "complete" | "partial";
	uncertainty: string[];
	uncertainSources: Array<{ path: string; reasons: string[] }>;
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
	private metafieldIndexValue: ThemeMetafieldIndex | undefined;
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

	getMetafieldImpact(identity: ThemeMetafieldIdentity): ThemeMetafieldImpact {
		const query = this.getMetafieldIndex().query(identity);
		const summary = this.getImpactSummary();
		const pagePaths = this.model.pages.map((page) => page.path);
		const apiReads = this.model.networkAccesses.filter((access) =>
			networkAccessExactlyMatches(access, identity),
		);
		const affectedSources = [
			...new Set([
				...query.affectedSources,
				...apiReads.map((access) => access.fromPath),
			]),
		].sort(compareCanonicalStrings);
		const affectedPages = [
			...new Set(
				affectedSources.flatMap((path) =>
					path === "config/settings_data.json"
						? pagePaths
						: (summary.affectedPages[path] ?? []),
				),
			),
		].sort(compareCanonicalStrings);
		const uncertainty = metafieldSnapshotUncertainty(
			this.model.metafieldSchema,
			this.model.issues,
		);
		const uncertainSources = metafieldUncertainSources(this.model, identity);
		return {
			version: 2,
			scope: THEME_METAFIELD_IMPACT_SCOPE,
			identity: query.identity,
			definition: query.definition ?? null,
			reads: query.reads,
			apiReads,
			localNetworkAccessCount: this.model.networkAccesses.length,
			affectedSources,
			affectedPages,
			snapshot: { ...this.model.metafieldSchema },
			certainty:
				uncertainty.length > 0 || uncertainSources.length > 0
					? "partial"
					: "complete",
			uncertainty,
			uncertainSources,
		};
	}

	private getMetafieldIndex(): ThemeMetafieldIndex {
		this.metafieldIndexValue ??= new ThemeMetafieldIndex(this.model);
		return this.metafieldIndexValue;
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

function metafieldSnapshotUncertainty(
	schema: ThemeSemanticModel["metafieldSchema"],
	issues: Diagnostic[],
): string[] {
	switch (schema.state) {
		case "present":
			return issues
				.filter((issue) => issue.code === "THEME_METAFIELDS_POSSIBLY_TRUNCATED")
				.map((issue) => issue.message);
		case "unknown":
			return [`Metafield definitions are unavailable at ${schema.path}`];
		case "invalid":
			return [`Metafield definitions are invalid at ${schema.path}`];
		default:
			return assertNever(schema.state);
	}
}

function metafieldUncertainSources(
	model: ThemeSemanticModel,
	identity: ThemeMetafieldIdentity,
): Array<{ path: string; reasons: string[] }> {
	const reasonsByPath = new Map<string, Set<string>>();
	const indexedAccessIds = new Set(
		model.metafieldReads.map((read) => read.dataAccessId),
	);
	for (const access of model.dataAccesses) {
		if (!isMetafieldAccess(access) || indexedAccessIds.has(access.id)) continue;
		if (
			access.object !== "unknown" &&
			access.object !== "metafields" &&
			access.object !== identity.owner
		) {
			continue;
		}
		addUncertainty(
			reasonsByPath,
			access.fromPath,
			"Dynamic metafield access cannot be assigned to a static owner.namespace.key",
		);
	}
	for (const access of model.networkAccesses) {
		if (
			access.graphql === "none" ||
			!networkAccessCouldMatch(access, identity)
		) {
			continue;
		}
		addUncertainty(
			reasonsByPath,
			access.fromPath,
			`Local ${access.transport} request may read this metafield, but its GraphQL identity is not fully static`,
		);
	}
	for (const issue of model.issues) {
		if (issue.code !== "THEME_JSON_METAFIELD_SOURCE_INVALID") continue;
		const path = issue.span?.file;
		if (!path) continue;
		addUncertainty(reasonsByPath, path, issue.message);
	}
	for (const source of model.sourceAnalyses) {
		if (!sourceLanguageCanReadMetafields(source.language)) continue;
		if (source.completeness === "failed") {
			addUncertainty(
				reasonsByPath,
				source.path,
				`${source.language} source analysis failed and may hide metafield reads`,
			);
		}
		if (source.language !== "liquid" && source.language !== "nazare-liquid") {
			continue;
		}
		for (const reason of source.uncertainty) {
			if (
				reason.toLowerCase().includes("metafield") &&
				!reason.startsWith("Dynamic metafield path ")
			) {
				addUncertainty(reasonsByPath, source.path, reason);
			}
		}
	}
	return [...reasonsByPath]
		.map(([path, reasons]) => ({
			path,
			reasons: [...reasons].sort(compareCanonicalStrings),
		}))
		.sort((a, b) => compareCanonicalStrings(a.path, b.path));
}

function sourceLanguageCanReadMetafields(
	language: ThemeSemanticModel["sourceAnalyses"][number]["language"],
): boolean {
	return (
		language === "liquid" ||
		language === "nazare-liquid" ||
		language === "javascript"
	);
}

function networkAccessExactlyMatches(
	access: ThemeSemanticModel["networkAccesses"][number],
	identity: ThemeMetafieldIdentity,
): boolean {
	return access.metafieldReferences.some(
		(reference) =>
			reference.certainty === "exact" &&
			reference.owner === identity.owner &&
			reference.namespace === identity.namespace &&
			reference.key === identity.key,
	);
}

function networkAccessCouldMatch(
	access: ThemeSemanticModel["networkAccesses"][number],
	identity: ThemeMetafieldIdentity,
): boolean {
	if (access.graphql === "dynamic" || access.graphql === "invalid") return true;
	return access.metafieldReferences.some(
		(reference) =>
			reference.certainty === "partial" &&
			(reference.owner === undefined || reference.owner === identity.owner) &&
			(reference.namespace === undefined ||
				reference.namespace === identity.namespace) &&
			(reference.key === undefined || reference.key === identity.key),
	);
}

function isMetafieldAccess(
	access: ThemeSemanticModel["dataAccesses"][number],
): boolean {
	return (
		access.object === "metafields" ||
		access.propertyPath === "metafields" ||
		access.propertyPath?.startsWith("metafields.") === true
	);
}

function addUncertainty(
	reasonsByPath: Map<string, Set<string>>,
	path: string,
	reason: string,
): void {
	const reasons = reasonsByPath.get(path) ?? new Set<string>();
	reasons.add(reason);
	reasonsByPath.set(path, reasons);
}

function assertNever(value: never): never {
	throw new Error(`Unhandled metafield schema state: ${String(value)}`);
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
