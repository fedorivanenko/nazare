import type { Diagnostic } from "@nazare/core";
import type { PlainLiquidAst, PlainLiquidParseMode } from "../plain-liquid.js";

export type PlainLiquidFrontendMetadata = {
	ast: PlainLiquidAst;
	dependencies: PlainLiquidAst["dependencies"];
	factsCollected: boolean;
	parseMode: PlainLiquidAst["parseMode"];
};

export const PLAIN_LIQUID_SUPPORT = {
	explicitPropsSyntax: false,
	explicitSchemaSyntax: true,
	explicitImportsSyntax: false,
	explicitBehaviorSyntax: false,
	rawInference: true,
};

export const DEFAULT_PLAIN_LIQUID_PARSE_MODE: PlainLiquidParseMode = "strict";

type PlainLiquidOptionResolution =
	| { valid: true; options: { parseMode: PlainLiquidParseMode } }
	| { valid: false; issues: Diagnostic[] };

export function resolvePlainLiquidOptions(
	frontendOptions: Record<string, unknown> | undefined,
): PlainLiquidOptionResolution {
	if (frontendOptions === undefined) {
		return {
			valid: true,
			options: { parseMode: DEFAULT_PLAIN_LIQUID_PARSE_MODE },
		};
	}

	const unknownOptions = Object.keys(frontendOptions).filter(
		(name) => name !== "parseMode",
	);
	const parseMode = frontendOptions.parseMode;
	const issues: Diagnostic[] = unknownOptions.map((name) => ({
		severity: "error",
		code: "PLAIN_LIQUID_UNKNOWN_FRONTEND_OPTION",
		message: `Unknown plain Liquid frontend option ${JSON.stringify(name)}`,
	}));
	if (
		parseMode !== undefined &&
		parseMode !== "strict" &&
		parseMode !== "liquid-only"
	) {
		issues.push({
			severity: "error",
			code: "PLAIN_LIQUID_INVALID_FRONTEND_OPTION",
			message:
				'Invalid plain Liquid frontend option parseMode; expected "strict" or "liquid-only"',
		});
	}
	if (issues.length > 0) return { valid: false, issues };

	if (parseMode === undefined) {
		return {
			valid: true,
			options: { parseMode: DEFAULT_PLAIN_LIQUID_PARSE_MODE },
		};
	}
	if (parseMode === "strict" || parseMode === "liquid-only") {
		return { valid: true, options: { parseMode } };
	}
	throw new Error("Plain Liquid option validation reached an invalid state");
}
