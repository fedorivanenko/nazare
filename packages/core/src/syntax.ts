// Syntax-layer nodes: the flat, id-linked form of a parsed component that
// the compiler's syntax pass produces and every later pass consumes. Nodes
// record what the source literally says — no resolution, no judgment. Only
// kinds the compiler actually produces belong here; planned ones live in
// git history, not in the union.
import type { Id } from "./id.js";
import type { PropTypeInfo, SemanticType } from "./semantic.js";
import type { SourceSpan } from "./source.js";

export type FileSyntaxNode = {
	id: Id;
	kind: "file";
	path: string;
	span?: SourceSpan;
};

export type ComponentSyntaxNode = {
	id: Id;
	kind: "component";
	name: string;
	fileId: Id;
	span?: SourceSpan;
};

export type PropsInterfaceSyntaxNode = {
	id: Id;
	kind: "props-interface";
	ownerId: Id;
	propDeclarationIds: Id[];
	span?: SourceSpan;
};

export type PropDeclarationSyntaxNode = {
	id: Id;
	kind: "prop-declaration";
	name: string;
	typeExpression: string;
	typeInfo: PropTypeInfo;
	required: boolean;
	hasDefault: boolean;
	propsInterfaceId: Id;
	span?: SourceSpan;
};

export type PropArgumentSyntaxNode = {
	id: Id;
	kind: "prop-argument";
	name: string;
	nameSpan?: SourceSpan;
	expressionId: Id;
	renderSiteId: Id;
	span?: SourceSpan;
};

export type RenderReachability =
	| "unconditional"
	| "conditional-unmodeled"
	| "unknown";

export type RenderSiteSyntaxNode = {
	id: Id;
	kind: "render-site";
	targetName: string;
	argumentIds: Id[];
	ownerId: Id;
	reachability: RenderReachability;
	span?: SourceSpan;
};

export type ImportSyntaxNode = {
	id: Id;
	kind: "import";
	localName: string;
	packageId: string;
	fileId: Id;
	span?: SourceSpan;
};

export type ExpressionSyntaxNode = {
	id: Id;
	kind: "expression";
	source: string;
	inferredType?: SemanticType;
	span?: SourceSpan;
};

export type ArtifactSyntaxNode =
	| FileSyntaxNode
	| ComponentSyntaxNode
	| PropsInterfaceSyntaxNode
	| PropDeclarationSyntaxNode
	| PropArgumentSyntaxNode
	| RenderSiteSyntaxNode
	| ImportSyntaxNode
	| ExpressionSyntaxNode;

export type ArtifactSyntaxKind = ArtifactSyntaxNode["kind"];
