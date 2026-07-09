import type { SourceSpan } from "@nazare/core";
import type { DocumentNode, LiquidHtmlNode } from "@shopify/liquid-html-parser";

export type ParseDiagnostic = {
	severity: "error" | "warning";
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
};

export type NazareRenderNode = {
	type: "NazareRender";
	target: string;
	props: NazarePassedProp[];
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
	| NazareOpaqueNode;

export type NazareAst = {
	file: string;
	liquidAst: DocumentNode;
	nodes: NazareNode[];
	diagnostics: ParseDiagnostic[];
};
