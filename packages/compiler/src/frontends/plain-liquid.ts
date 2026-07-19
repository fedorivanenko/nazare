import type { ArtifactIR, ArtifactSyntaxNode, Diagnostic } from "@nazare/core";
import { checkVanillaSchema } from "../check-vanilla.js";
import type {
	CompileInput,
	CompilerFrontend,
	FrontendResult,
} from "../frontend.js";
import { fileSyntaxId } from "../ids.js";
import { markDiagnostics } from "../pipeline.js";
import {
	type PlainLiquidAst,
	type PlainLiquidOptions,
	parsePlainLiquid,
} from "../plain-liquid.js";
import { spanFromOffsets } from "../source.js";

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

export const plainLiquidFrontend: CompilerFrontend = {
	name: "plain-liquid",
	accepts(file: string): boolean {
		return file.endsWith(".liquid") && !file.endsWith(".nz.liquid");
	},
	compile(input: CompileInput): FrontendResult {
		const optionResolution = plainLiquidOptions(input.frontendOptions);
		const ast = parsePlainLiquid(
			input.source,
			input.file,
			optionResolution.options,
		);
		const syntax = plainLiquidSyntax(input.source, input.file);
		const ir: ArtifactIR = { syntax, symbols: [], resolutions: [] };

		return {
			kind: "direct-ir",
			syntax,
			ir,
			contractPath: input.file,
			contracts: [],
			issues: [
				...markDiagnostics(optionResolution.issues, "parse"),
				...markDiagnostics(ast.diagnostics, "parse"),
				...markDiagnostics(checkVanillaSchema(ast), "check"),
			],
			notes: [],
			sourceForEmit: input.source,
			frontendSupport: PLAIN_LIQUID_SUPPORT,
			contractProvenance: "none",
			metadata: {
				ast,
				dependencies: ast.dependencies,
				factsCollected: ast.factsCollected,
				parseMode: ast.parseMode,
			} satisfies PlainLiquidFrontendMetadata,
		};
	},
};

function plainLiquidSyntax(source: string, file: string): ArtifactSyntaxNode[] {
	return [
		{
			id: fileSyntaxId(file),
			kind: "file",
			path: file,
			span: spanFromOffsets(source, file, {
				start: 0,
				end: source.length,
			}),
		},
	];
}

function plainLiquidOptions(
	frontendOptions: Record<string, unknown> | undefined,
): { options: PlainLiquidOptions; issues: Diagnostic[] } {
	const parseMode = frontendOptions?.parseMode;
	if (parseMode === undefined) return { options: {}, issues: [] };
	if (parseMode === "strict" || parseMode === "tolerant") {
		return { options: { parseMode }, issues: [] };
	}
	return {
		options: {},
		issues: [
			{
				severity: "error",
				code: "PLAIN_LIQUID_INVALID_FRONTEND_OPTION",
				message:
					'Invalid plain Liquid frontend option parseMode; expected "strict" or "tolerant"',
			},
		],
	};
}
