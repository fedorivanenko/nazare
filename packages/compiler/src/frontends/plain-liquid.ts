import type { Diagnostic } from "@nazare/core";
import type { PlainLiquidAst, PlainLiquidOptions } from "../plain-liquid.js";

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

export function plainLiquidOptions(
	frontendOptions: Record<string, unknown> | undefined,
): { options: PlainLiquidOptions; issues: Diagnostic[] } {
	const parseMode = frontendOptions?.parseMode;
	if (parseMode === undefined) return { options: {}, issues: [] };
	if (parseMode === "strict" || parseMode === "liquid-only") {
		return { options: { parseMode }, issues: [] };
	}
	return {
		options: {},
		issues: [
			{
				severity: "error",
				code: "PLAIN_LIQUID_INVALID_FRONTEND_OPTION",
				message:
					'Invalid plain Liquid frontend option parseMode; expected "strict" or "liquid-only"',
			},
		],
	};
}
