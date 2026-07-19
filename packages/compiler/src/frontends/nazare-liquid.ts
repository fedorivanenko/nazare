import {
	type CompileInput,
	type CompilerFrontend,
	type FrontendResult,
	NAZARE_LIQUID_CAPABILITIES,
} from "../frontend.js";
import { parseNazareLiquid } from "../parser.js";
import { markDiagnostics, projectArtifact } from "../pipeline.js";
import { resolveAssetImports, resolveComponentContracts } from "../resolver.js";

export const nazareLiquidFrontend: CompilerFrontend = {
	name: "nazare-liquid",
	accepts(file: string): boolean {
		return file.endsWith(".nz.liquid");
	},
	compile(input: CompileInput): FrontendResult {
		const parsedAst = parseNazareLiquid(input.source, input.file);
		const contractResolution = resolveComponentContracts(
			parsedAst,
			input.readFile,
		);
		const assetResolution = resolveAssetImports(parsedAst, input.readFile);
		const ast = assetResolution.ast;
		const contracts = contractResolution.contracts;

		const projected = projectArtifact(ast, {
			contracts,
			mode: input.strictness,
			resolveIssues: contractResolution.issues,
		});

		return {
			ast,
			syntax: projected.syntax,
			ir: projected.ir,
			graph: projected.graph,
			issues: projected.issues,
			notes: markDiagnostics(ast.notes, "parse"),
			contract: projected.contract,
			contracts,
			capabilities: NAZARE_LIQUID_CAPABILITIES,
			sourceForEmit: input.source,
		};
	},
};
