// Shape of the parse pass's output: the handful of Nazare-specific nodes
// (import / props / render / output expression) lifted out of a Liquid file,
// alongside the untouched LiquidHTML AST. Anything Nazare doesn't model stays
// opaque rather than being rejected — every valid Shopify theme should be at
// least partially readable.
import type { Diagnostic, PropTypeInfo, SourceSpan } from "@nazare/core";
import type { DocumentNode, LiquidHtmlNode } from "@shopify/liquid-html-parser";

/** @deprecated Use {@link Diagnostic} from @nazare/core. */
export type ParseDiagnostic = Diagnostic;

export type NazareImportNode = {
	type: "NazareImport";
	localName: string;
	packageId: string;
	span: SourceSpan;
};

export type NazarePropDeclaration = {
	name: string;
	typeExpression: string;
	typeInfo: PropTypeInfo;
	required: boolean;
	hasDefault: boolean;
	span: SourceSpan;
};

export type NazarePropsNode = {
	type: "NazareProps";
	props: NazarePropDeclaration[];
	span: SourceSpan;
};

export type NazarePassedProp = {
	name: string;
	expression: string;
	span: SourceSpan;
	nameSpan: SourceSpan;
	expressionSpan: SourceSpan;
};

export type NazareRenderNode = {
	type: "NazareRender";
	target: string;
	props: NazarePassedProp[];
	reachability: "unconditional" | "conditional-unmodeled" | "unknown";
	span: SourceSpan;
};

export type NazareOutputExpressionNode = {
	type: "NazareOutputExpression";
	expression: string;
	expressionSpan: SourceSpan;
	span: SourceSpan;
};

export type NazareDataBinding = {
	attribute: string;
	property: string;
	expression: string;
	span: SourceSpan;
};

export type NazareElementRefNode = {
	type: "NazareElementRef";
	name: string;
	tagName: string;
	dataBindings: NazareDataBinding[];
	span: SourceSpan;
};

export type NazareRefAccess = {
	name: string;
	span: SourceSpan;
};

export type NazareDataAccess = {
	ref: string;
	property: string;
	span: SourceSpan;
};

export type NazareScriptNode = {
	type: "NazareScript";
	lang: "ts" | "js";
	source: string;
	refAccesses: NazareRefAccess[];
	dataAccesses: NazareDataAccess[];
	span: SourceSpan;
	/** Span of the script body only, excluding the {% script %} tags. */
	bodySpan: SourceSpan;
};

/** Side-effect import of a sidecar asset: {% import "./x.ts" %} etc. */
export type NazareAssetImportNode = {
	type: "NazareAssetImport";
	path: string;
	span: SourceSpan;
};

export type NazareStyleNode = {
	type: "NazareStyle";
	source: string;
	span: SourceSpan;
	/** Span of the CSS body only, excluding the {% stylesheet %} tags. */
	bodySpan: SourceSpan;
};

export type NazareOpaqueNode = {
	type: "OpaqueLiquidHtml";
	node: LiquidHtmlNode;
	span: SourceSpan;
};

export type NazareNode =
	| NazareImportNode
	| NazarePropsNode
	| NazareRenderNode
	| NazareOutputExpressionNode
	| NazareElementRefNode
	| NazareScriptNode
	| NazareStyleNode
	| NazareAssetImportNode
	| NazareOpaqueNode;

export type NazareAst = {
	file: string;
	liquidAst: DocumentNode;
	nodes: NazareNode[];
	diagnostics: Diagnostic[];
};
