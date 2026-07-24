import type {
	InspectNazareThemeResult,
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
} from "./theme-facts.js";

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
