// Shape of the parse pass's output: the handful of Nazare-specific nodes
// (import / props / render / output expression) lifted out of a Liquid file,
// alongside the untouched LiquidHTML AST. Anything Nazare doesn't model stays
// opaque rather than being rejected — every valid Shopify theme should be at
// least partially readable.
import type { Diagnostic, PropTypeInfo, SourceSpan } from "@nazare/core";
import type { DocumentNode, LiquidHtmlNode } from "@shopify/liquid-html-parser";

/** @deprecated Use {@link Diagnostic} from @nazare/core. */
export type ParseDiagnostic = Diagnostic;

/** {% import Name from "./name.nz.liquid" %} — a component import. */
export type NazareImportNode = {
	type: "NazareImport";
	localName: string;
	/** Project-relative path of the imported component file. */
	path: string;
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
	/** The import binding name, when the script came in via {% import %}. */
	bindingName?: string;
	span: SourceSpan;
	/** Span of the script body only, excluding the {% script %} tags. */
	bodySpan: SourceSpan;
};

/** {% import name from "./x.ts|.js|.css" %} — a behavior or style import. */
export type NazareAssetImportNode = {
	type: "NazareAssetImport";
	localName: string;
	/** Project-relative path of the imported file. */
	path: string;
	span: SourceSpan;
};

/** {% blocks "notice", "quote" %} — the theme-block slot in a section. */
export type NazareBlocksNode = {
	type: "NazareBlocks";
	blockTypes: string[];
	span: SourceSpan;
};

export type NazareStyleNode = {
	type: "NazareStyle";
	source: string;
	/** The import binding name, when the style came in via {% import %}. */
	bindingName?: string;
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
	| NazareBlocksNode
	| NazareAssetImportNode
	| NazareOpaqueNode;

/** A literal section.settings.x / block.settings.x read anywhere in the file. */
export type SettingsRead = {
	object: "section" | "block";
	name: string;
	span: SourceSpan;
};

/** An authored {% schema %} block (vanilla sections), body unparsed. */
export type AuthoredSchema = {
	source: string;
	span: SourceSpan;
};

export type NazareAst = {
	file: string;
	liquidAst: DocumentNode;
	nodes: NazareNode[];
	settingsReads: SettingsRead[];
	schema?: AuthoredSchema;
	diagnostics: Diagnostic[];
};
