import type { Diagnostic } from "@nazare/core";
import type { ThemeFact } from "./theme-facts.js";
import {
	themeAssetNameFromPath,
	themeNameFromPath,
} from "./theme-file-classifier.js";
import { collectJsonThemeFacts } from "./theme-json-facts.js";
import { collectPlainLiquidThemeFacts } from "./theme-liquid-facts.js";
import { collectNazareThemeFacts } from "./theme-nazare-facts.js";
import type {
	ThemeSourceAnalysis,
	ThemeSourceFrontend,
	ThemeSourceFrontendContext,
	ThemeSourceInput,
	ThemeSourceLanguage,
} from "./theme-source-frontend.js";

export const nazareLiquidThemeSourceFrontend: ThemeSourceFrontend = {
	name: "nazare-liquid-theme-source",
	accepts: (input) => input.fileKind === "nazareComponent",
	analyze(input, context) {
		const result = collectNazareThemeFacts(input.path, input.contents, {
			readFile: context.readFile,
			dependencyResolver: context.dependencyResolver,
			strictness: context.strictness,
		});
		return analysis(input, this.name, "nazare-liquid", result);
	},
};

export const plainLiquidThemeSourceFrontend: ThemeSourceFrontend = {
	name: "plain-liquid-theme-source",
	accepts: (input) =>
		input.fileKind !== "nazareComponent" && input.path.endsWith(".liquid"),
	analyze(input, context) {
		const result = collectPlainLiquidThemeFacts(input.path, input.contents, {
			parseMode: context.plainLiquidParseMode,
		});
		return analysis(input, this.name, "liquid", result);
	},
};

export const jsonThemeSourceFrontend: ThemeSourceFrontend = {
	name: "json-theme-source",
	accepts: (input) =>
		input.fileKind !== "asset" && input.path.endsWith(".json"),
	analyze(input) {
		return analysis(
			input,
			this.name,
			"json",
			collectJsonThemeFacts(input.path, input.contents),
		);
	},
};

export const assetThemeSourceFrontend: ThemeSourceFrontend = {
	name: "asset-theme-source",
	accepts: (input) => input.fileKind === "asset",
	analyze(input) {
		return analysis(input, this.name, "asset", { facts: [], issues: [] });
	},
};

export const opaqueThemeSourceFrontend: ThemeSourceFrontend = {
	name: "opaque-theme-source",
	accepts: (input) =>
		input.fileKind === "other" &&
		!input.path.endsWith(".liquid") &&
		!input.path.endsWith(".json"),
	analyze(input) {
		return analysis(input, this.name, "other", { facts: [], issues: [] });
	},
};

export const DEFAULT_THEME_SOURCE_FRONTENDS: readonly ThemeSourceFrontend[] = [
	nazareLiquidThemeSourceFrontend,
	plainLiquidThemeSourceFrontend,
	jsonThemeSourceFrontend,
	assetThemeSourceFrontend,
	opaqueThemeSourceFrontend,
];

export function analyzeThemeSource(
	input: ThemeSourceInput,
	context: ThemeSourceFrontendContext,
	frontends: readonly ThemeSourceFrontend[] = DEFAULT_THEME_SOURCE_FRONTENDS,
): ThemeSourceAnalysis {
	const matches = frontends.filter((frontend) => frontend.accepts(input));
	if (matches.length === 0) {
		return frontendFailure(
			input,
			"THEME_SOURCE_FRONTEND_UNSUPPORTED",
			`No theme source frontend accepts ${input.path}`,
		);
	}
	if (matches.length > 1) {
		return frontendFailure(
			input,
			"THEME_SOURCE_FRONTEND_AMBIGUOUS",
			`Multiple theme source frontends accept ${input.path}: ${matches
				.map((frontend) => frontend.name)
				.sort((a, b) => a.localeCompare(b))
				.join(", ")}`,
		);
	}
	const frontend = matches[0];
	if (!frontend) {
		throw new Error("Theme source frontend selection lost its only match");
	}
	return frontend.analyze(input, context);
}

function analysis(
	input: ThemeSourceInput,
	frontend: string,
	language: ThemeSourceLanguage,
	result: {
		facts: ThemeFact[];
		issues: Diagnostic[];
		artifact?: ThemeSourceAnalysis["artifact"];
	},
): ThemeSourceAnalysis {
	const facts = [...baseFacts(input), ...result.facts];
	const completeness = sourceCompleteness(result.issues);
	return {
		version: 1,
		frontend,
		path: input.path,
		language,
		completeness,
		uncertainty:
			completeness === "complete"
				? []
				: result.issues
						.filter((issue) => issue.phase === "parse")
						.map((issue) => ({ code: issue.code, message: issue.message })),
		facts,
		issues: result.issues,
		...(result.artifact ? { artifact: result.artifact } : {}),
	};
}

function baseFacts(input: ThemeSourceInput): ThemeFact[] {
	const facts: ThemeFact[] = [
		{ kind: "file", path: input.path, fileKind: input.fileKind },
	];
	if (input.fileKind === "asset") {
		facts.push({
			kind: "declaresAsset",
			path: input.path,
			name: themeAssetNameFromPath(input.path),
		});
	}
	if (input.fileKind === "layout") {
		facts.push({
			kind: "declaresLayout",
			path: input.path,
			name: themeNameFromPath(input.path),
		});
	}
	if (input.fileKind === "sectionGroup") {
		facts.push({
			kind: "declaresSectionGroup",
			path: input.path,
			name: themeNameFromPath(input.path),
		});
	}
	if (input.fileKind === "themeBlock") {
		facts.push({
			kind: "declaresThemeBlock",
			path: input.path,
			name: themeNameFromPath(input.path),
		});
	}
	return facts;
}

function sourceCompleteness(
	issues: Diagnostic[],
): ThemeSourceAnalysis["completeness"] {
	const parseIssues = issues.filter((issue) => issue.phase === "parse");
	if (parseIssues.some((issue) => issue.severity === "error")) return "failed";
	if (parseIssues.length > 0) return "partial";
	return "complete";
}

function frontendFailure(
	input: ThemeSourceInput,
	code: string,
	message: string,
): ThemeSourceAnalysis {
	return {
		version: 1,
		frontend: "none",
		path: input.path,
		language: "other",
		completeness: "failed",
		uncertainty: [{ code, message }],
		facts: baseFacts(input),
		issues: [
			{
				severity: "error",
				code,
				message,
				phase: "parse",
			},
		],
	};
}
