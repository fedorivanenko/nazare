import type { Diagnostic, SourceSpan } from "@nazare/core";
import type { DependencyResolver, ReadFile } from "./resolver.js";
import type { ThemeBuiltArtifact, ThemeFact } from "./theme-facts.js";
import type { ThemeFileKind } from "./theme-file-classifier.js";

export type ThemeSourceLanguage =
	| "nazare-liquid"
	| "liquid"
	| "json"
	| "asset"
	| "other";

export type ThemeSourceCompleteness = "complete" | "partial" | "failed";

export type ThemeSourceUncertainty = {
	code: string;
	message: string;
	span?: SourceSpan;
};

export type ThemeSourceInput = {
	path: string;
	contents: string;
	fileKind: ThemeFileKind;
};

export type ThemeSourceFrontendContext = {
	readFile?: ReadFile;
	dependencyResolver?: DependencyResolver;
	strictness: "strict" | "loose";
	plainLiquidParseMode: "strict" | "liquid-only";
};

export type ThemeSourceAnalysis = {
	version: 1;
	frontend: string;
	path: string;
	language: ThemeSourceLanguage;
	completeness: ThemeSourceCompleteness;
	uncertainty: ThemeSourceUncertainty[];
	facts: ThemeFact[];
	issues: Diagnostic[];
	artifact?: ThemeBuiltArtifact;
};

/**
 * A whole-theme compiler frontend projects one native source language into
 * file-owned Shopify semantic facts. Cross-file resolution belongs to the
 * theme linker, not to a frontend.
 */
export type ThemeSourceFrontend = {
	name: string;
	accepts(input: ThemeSourceInput): boolean;
	analyze(
		input: ThemeSourceInput,
		context: ThemeSourceFrontendContext,
	): ThemeSourceAnalysis;
};
