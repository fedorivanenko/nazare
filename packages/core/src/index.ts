export type Id = string;

export type SourcePosition = {
	line: number;
	column: number;
};

export type SourceSpan = {
	file: string;
	start: SourcePosition;
	end: SourcePosition;
};

export type ArtifactSyntaxKind =
	| "file"
	| "component"
	| "section"
	| "snippet"
	| "props-interface"
	| "prop-declaration"
	| "prop-argument"
	| "render-site"
	| "import"
	| "schema"
	| "schema-field"
	| "expression"
	| "style-expression"
	| "behavior";

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

export type SectionSyntaxNode = {
	id: Id;
	kind: "section";
	name: string;
	fileId: Id;
	span?: SourceSpan;
};

export type SnippetSyntaxNode = {
	id: Id;
	kind: "snippet";
	name: string;
	fileId: Id;
	span?: SourceSpan;
};

export type SemanticType =
	| { kind: "string" }
	| { kind: "string-literal"; value: string }
	| { kind: "url" }
	| { kind: "boolean" }
	| { kind: "number" }
	| { kind: "number-literal"; value: number }
	| { kind: "money" }
	| { kind: "object"; name?: string; fields?: Record<string, SemanticType> }
	| { kind: "array"; element: SemanticType }
	| { kind: "literal"; value: unknown }
	| { kind: "unknown" };

export const shopifyObjectTypeNames = [
	"ShopifyArticle",
	"ShopifyCart",
	"ShopifyCollection",
	"ShopifyCustomer",
	"ShopifyImage",
	"ShopifyMedia",
	"ShopifyPage",
	"ShopifyProduct",
	"ShopifyVariant",
] as const;

export type ShopifyObjectTypeName = (typeof shopifyObjectTypeNames)[number];

export type SettingMetadata = {
	label?: string;
	default?: unknown;
};

export type PropTypeInfo = {
	valueType: SemanticType;
	setting?: SettingMetadata;
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

export type SchemaSyntaxNode = {
	id: Id;
	kind: "schema";
	ownerId: Id;
	fieldIds: Id[];
	span?: SourceSpan;
};

export type SchemaFieldSyntaxNode = {
	id: Id;
	kind: "schema-field";
	name: string;
	schemaId: Id;
	span?: SourceSpan;
};

export type StyleExpressionSyntaxNode = {
	id: Id;
	kind: "style-expression";
	source: string;
	span?: SourceSpan;
};

export type BehaviorSyntaxNode = {
	id: Id;
	kind: "behavior";
	name: string;
	ownerId: Id;
	span?: SourceSpan;
};

export type ArtifactSyntaxNode =
	| FileSyntaxNode
	| ComponentSyntaxNode
	| SectionSyntaxNode
	| SnippetSyntaxNode
	| PropsInterfaceSyntaxNode
	| PropDeclarationSyntaxNode
	| PropArgumentSyntaxNode
	| RenderSiteSyntaxNode
	| ImportSyntaxNode
	| ExpressionSyntaxNode
	| SchemaSyntaxNode
	| SchemaFieldSyntaxNode
	| StyleExpressionSyntaxNode
	| BehaviorSyntaxNode;

export type ArtifactSymbolKind =
	| "component"
	| "section"
	| "snippet"
	| "alias"
	| "prop"
	| "setting"
	| "schema"
	| "schema-field"
	| "behavior";

export type ArtifactSymbolResolution =
	| "local"
	| "external-resolved"
	| "external-unresolved";

export type ArtifactSymbolSource =
	| "syntax"
	| "manifest"
	| "compiled-contract"
	| "registry";

export type ArtifactSymbol = {
	id: Id;
	kind: ArtifactSymbolKind;
	name: string;
	declarations: Id[];
	resolution: ArtifactSymbolResolution;
	source: ArtifactSymbolSource;
	packageId?: string;
	ownerSymbolId?: Id;
	semanticType?: SemanticType;
};

export type ArtifactResolution =
	| {
			kind: "setting-projection";
			propSymbolId: Id;
			settingSymbolId: Id;
	  }
	| {
			kind: "alias-target";
			aliasSymbolId: Id;
			targetSymbolId: Id;
	  }
	| {
			kind: "import-target";
			importId: Id;
			aliasSymbolId: Id;
			targetSymbolId: Id;
	  }
	| {
			kind: "render-target";
			renderSiteId: Id;
			symbolId: Id;
	  }
	| {
			kind: "prop-binding";
			renderSiteId: Id;
			argumentId: Id;
			targetComponentSymbolId: Id;
			propSymbolId: Id;
			expressionId: Id;
	  }
	| {
			kind: "symbol-reference";
			expressionId: Id;
			symbolId: Id;
	  };

export type ArtifactIR = {
	syntax: ArtifactSyntaxNode[];
	symbols: ArtifactSymbol[];
	resolutions: ArtifactResolution[];
};

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
	| "binds-schema"
	| "uses-expression"
	| "computes-style"
	| "attaches-behavior"
	| "depends-on"
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

export type DiagnosticSeverity = "error" | "warning" | "info";

export type Diagnostic = {
	severity: DiagnosticSeverity;
	code: string;
	message: string;
	nodeId?: Id;
	edgeId?: Id;
	span?: SourceSpan;
};

/** @deprecated Use {@link Diagnostic}. */
export type ValidationIssue = Diagnostic;

export type ConstraintRule<T> = {
	id: string;
	validate(input: T): ValidationIssue[];
};

export type ArtifactContractProp = {
	name: string;
	symbolId: Id;
	required: boolean;
	hasDefault: boolean;
	typeExpression: string;
	typeInfo: PropTypeInfo;
};

export type ArtifactContract = {
	packageId: string;
	componentSymbolId: Id;
	props: ArtifactContractProp[];
};

export type NazareManifest = {
	id: string;
	version: string;
	kind?: "snippet" | "section" | "function";
	entry: string;
	dependencies?: Record<string, string>;
	files: string[];
};

export const packageName = "@nazare/core";
