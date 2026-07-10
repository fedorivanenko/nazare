import type { Id } from "./id.js";
import type { SourceSpan } from "./source.js";
import type { ArtifactSymbolKind } from "./symbol.js";
import type { ArtifactSyntaxKind } from "./syntax.js";

export type ArtifactGraphNodeKind = ArtifactSyntaxKind | ArtifactSymbolKind;

export type ArtifactGraphEdgeKind =
	| "declares"
	| "aliases"
	| "imports"
	| "renders"
	| "supplies-argument"
	| "expects-prop"
	| "binds-to"
	| "references"
	| "materializes-as-setting"
	| "uses-expression"
	| "resolves-to";

export type ArtifactGraphNode = {
	id: Id;
	kind: ArtifactGraphNodeKind;
	name: string;
	layer: "syntax" | "symbol";
	span?: SourceSpan;
};

export type ArtifactGraphEdge = {
	id: Id;
	kind: ArtifactGraphEdgeKind;
	from: Id;
	to: Id;
	origin: "syntax" | "resolved" | "derived";
	span?: SourceSpan;
};

export type ArtifactGraph = {
	nodes: ArtifactGraphNode[];
	edges: ArtifactGraphEdge[];
};
