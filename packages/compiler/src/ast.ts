import type { PropTypeInfo, SourceSpan } from "@nazare/core";
import type { DocumentNode, LiquidHtmlNode } from "@shopify/liquid-html-parser";

export type ParseDiagnostic = {
	severity: "error" | "warning" | "info";
	code: string;
	message: string;
	span?: SourceSpan;
};

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
	| NazareOpaqueNode;

export type NazareAst = {
	file: string;
	liquidAst: DocumentNode;
	nodes: NazareNode[];
	diagnostics: ParseDiagnostic[];
};
