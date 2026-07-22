import type { Diagnostic } from "@nazare/core";
import type {
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
	ThemeEvidenceRecord,
} from "./theme-facts.js";

export type ThemeGraphView = {
	nodeIds: string[];
	edgeIds: string[];
};

export type ThemeGraphViews = {
	themeStructure: ThemeGraphView;
	shopifyData: ThemeGraphView;
	storefrontArchitecture: ThemeGraphView;
	configuration: ThemeGraphView;
	changeImpact: ThemeGraphView;
};

export type ThemeMetafieldQueries = {
	path: string;
	state: "unknown" | "present" | "invalid";
	pulledAt?: string;
	consumedDefinitionIds: string[];
	unconsumedDefinitionIds: string[];
	brokenReadIds: string[];
};

export type ThemeImpactSummary = {
	dependencies: Record<string, string[]>;
	dependents: Record<string, string[]>;
	affectedPages: Record<string, string[]>;
	unusedFiles: string[];
};

export interface InspectNazareThemeResult {
	version: 2;
	root: string;
	nodes: SemanticThemeGraphNode[];
	edges: SemanticThemeGraphEdge[];
	evidence: ThemeEvidenceRecord[];
	impact: ThemeImpactSummary;
	metafields: ThemeMetafieldQueries;
	views: ThemeGraphViews;
	issues: Diagnostic[];
}
