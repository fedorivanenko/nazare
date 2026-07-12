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
	/** Project-relative path of the imported component file. */
	path: string;
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

/** A data-* attribute on a ref'd element whose value is a bound expression. */
export type ElementRefDataBinding = {
	/** Attribute name without the data- prefix, as authored (kebab-case). */
	attribute: string;
	/** dataset property name (camelCase of attribute). */
	property: string;
	/** The bound expression, e.g. "props.step". */
	expression: string;
	span?: SourceSpan;
};

/** An HTML element in the component's markup carrying a ref="name" attribute. */
export type ElementRefSyntaxNode = {
	id: Id;
	kind: "element-ref";
	name: string;
	tagName: string;
	ownerId: Id;
	dataBindings?: ElementRefDataBinding[];
	span?: SourceSpan;
};

/** A data.<ref>.<property> access inside a script. */
export type ScriptDataAccess = {
	ref: string;
	property: string;
	span?: SourceSpan;
};

/** A {% script %}…{% endscript %} block owning the component's behavior. */
export type ScriptSyntaxNode = {
	id: Id;
	kind: "script";
	lang: "ts" | "js";
	source: string;
	ownerId: Id;
	dataAccesses?: ScriptDataAccess[];
	/** The import binding name, when the script came in via {% import %}. */
	bindingName?: string;
	span?: SourceSpan;
	/** Span of the script body only, excluding the {% script %} tags. */
	bodySpan?: SourceSpan;
};

/** The {% blocks %} slot: where merchant-composed theme blocks render. */
export type BlocksSlotSyntaxNode = {
	id: Id;
	kind: "blocks-slot";
	/** Accepted theme-block type names; empty means accept any theme block. */
	blockTypes: string[];
	ownerId: Id;
	span?: SourceSpan;
};

/** A {% stylesheet %}…{% endstylesheet %} block owning component styles. */
export type StyleSyntaxNode = {
	id: Id;
	kind: "style";
	source: string;
	ownerId: Id;
	/**
	 * The css-module binding ({% stylesheet styles %} or a style import).
	 * Bound sheets get their classes scoped and linked; unbound sheets pass
	 * through untouched.
	 */
	bindingName?: string;
	span?: SourceSpan;
	bodySpan?: SourceSpan;
};

/** A refs.<name> access inside a script block. */
export type RefAccessSyntaxNode = {
	id: Id;
	kind: "ref-access";
	name: string;
	scriptId: Id;
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
	| ExpressionSyntaxNode
	| ElementRefSyntaxNode
	| ScriptSyntaxNode
	| StyleSyntaxNode
	| BlocksSlotSyntaxNode
	| RefAccessSyntaxNode;

export type ArtifactSyntaxKind = ArtifactSyntaxNode["kind"];
