import type Parser from "tree-sitter";

export type SourceLanguage = "liquid" | "nazare-liquid";

export const DEFAULT_NAZARE_SCRIPT_LANGUAGE = "typescript" as const;

/** Half-open JavaScript UTF-16 code-unit range. */
export type SourceRange = { start: number; end: number };

/** Existing Nazare convention: one-based line and UTF-16 column. */
export type SourcePosition = { line: number; column: number };

export type SourceParseIssue = {
	code: "TREE_SITTER_ERROR" | "TREE_SITTER_MISSING";
	range: SourceRange;
	message: string;
};

export type EmbeddedRegion = {
	language: "javascript" | "typescript" | "css";
	bodyRange: SourceRange;
	openRange: SourceRange;
	closeRange?: SourceRange;
};

export type SourceDocument = {
	file: string;
	language: SourceLanguage;
	source: string;
	/** Keep node traversal inside source adapters; compiler passes receive facts. */
	tree: Parser.Tree;
	issues: readonly SourceParseIssue[];
	embeddedRegions: readonly EmbeddedRegion[];
};

/** Applied sequentially; every range addresses source produced by prior edits. */
export type SourceEdit = SourceRange & { text: string };

export type SourceUpdate = {
	document: SourceDocument;
	/** Tree-sitter changed ranges converted to UTF-16 offsets. */
	changedRanges: readonly SourceRange[];
};
