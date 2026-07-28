import type { Diagnostic } from "@nazare/core";
import type {
	InspectNazareThemeResult,
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
} from "./theme-facts.js";
import type { ThemeFileKind } from "./theme-file-classifier.js";

export function themeGraphToDot(graph: InspectNazareThemeResult): string {
	const lines = ["digraph nazare_theme {", "  rankdir=LR;"];
	for (const node of graph.nodes) {
		const label =
			"name" in node && node.name
				? `${node.kind}: ${node.name}`
				: `${node.kind}: ${"path" in node ? node.path : node.id}`;
		lines.push(`  ${dotId(node.id)} [label="${dotEscape(label)}"];`);
	}
	for (const edge of graph.edges) {
		lines.push(
			`  ${dotId(edge.from)} -> ${dotId(edge.to)} [label="${dotEscape(edge.kind)}"];`,
		);
	}
	lines.push("}");
	return lines.join("\n");
}

function dotId(value: string): string {
	return `"${dotEscape(value)}"`;
}

function dotEscape(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\n", "\\n");
}

export type ThemeGraphSummary = {
	fileCount: number;
	pageCount: number;
	sectionCount: number;
	snippetCount: number;
	componentCount: number;
	unresolvedCount: number;
	issueCount: number;
	errorCount: number;
	warningCount: number;
	brokenMetafieldReadCount: number;
	affectedPageCount: number;
};

export function getThemeNode(
	graph: InspectNazareThemeResult,
	nodeId: string,
): SemanticThemeGraphNode | undefined {
	return graph.nodes.find((node) => node.id === nodeId);
}

export function getThemeDependencies(
	graph: InspectNazareThemeResult,
	nodeId: string,
): string[] {
	return graph.impact.dependencies[nodeId] ?? [];
}

export function getThemeDependents(
	graph: InspectNazareThemeResult,
	nodeId: string,
): string[] {
	return graph.impact.dependents[nodeId] ?? [];
}

export function getThemeAffectedPages(
	graph: InspectNazareThemeResult,
	nodeId: string,
): string[] {
	return graph.impact.affectedPages[nodeId] ?? [];
}

export function getThemeEdgesFrom(
	graph: InspectNazareThemeResult,
	nodeId: string,
): SemanticThemeGraphEdge[] {
	return graph.edges.filter((edge) => edge.from === nodeId);
}

export function getThemeEdgesTo(
	graph: InspectNazareThemeResult,
	nodeId: string,
): SemanticThemeGraphEdge[] {
	return graph.edges.filter((edge) => edge.to === nodeId);
}

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

export function getThemeFileImpact(
	graph: InspectNazareThemeResult,
	path: string,
): ThemeFileImpact | undefined {
	const file = graph.nodes.find(
		(node) => node.kind === "file" && node.path === path,
	);
	if (!file || file.kind !== "file") return undefined;
	const dependencies = getThemeDependencies(graph, path);
	const dependents = getThemeDependents(graph, path);
	const affectedPages = getThemeAffectedPages(graph, path);
	const unused = graph.impact.unusedFiles.includes(path);
	const targetKind = dynamicTargetKind(file.fileKind);
	const hasDynamicReference =
		targetKind !== undefined &&
		graph.nodes.some(
			(node) =>
				node.kind === "unresolved" &&
				node.targetKind === targetKind &&
				node.name === undefined,
		);
	const uncertainty = hasDynamicReference
		? [
				`Theme contains a dynamic ${targetKind} reference that may resolve to ${path}`,
			]
		: [];
	return {
		version: 1,
		path,
		fileKind: file.fileKind,
		usage: themeFileUsage(
			file.fileKind,
			dependents.length,
			unused,
			hasDynamicReference,
		),
		certainty: uncertainty.length > 0 ? "partial" : "complete",
		uncertainty,
		dependencies,
		dependents,
		affectedPages,
		issues: graph.issues.filter((issue) => issue.span?.file === path),
	};
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
	if (dependentCount > 0) return "used";
	if (hasDynamicReference) return "unknown";
	if (unused) return "unused";
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

export function summarizeThemeGraph(
	graph: InspectNazareThemeResult,
): ThemeGraphSummary {
	const count = (kind: SemanticThemeGraphNode["kind"]): number =>
		graph.nodes.filter((node) => node.kind === kind).length;
	const errorCount = graph.issues.filter(
		(issue) => issue.severity === "error",
	).length;
	const warningCount = graph.issues.filter(
		(issue) => issue.severity === "warning",
	).length;
	return {
		fileCount: count("file"),
		pageCount: count("page"),
		sectionCount: count("section"),
		snippetCount: count("snippet"),
		componentCount: count("component"),
		unresolvedCount: count("unresolved"),
		issueCount: graph.issues.length,
		errorCount,
		warningCount,
		brokenMetafieldReadCount: graph.metafields.brokenReadIds.length,
		affectedPageCount: new Set(Object.values(graph.impact.affectedPages).flat())
			.size,
	};
}
