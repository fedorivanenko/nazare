import type { NazareAst } from "../ast.js";
import {
	type CompileInput,
	type CompilerFrontend,
	type ContractProvenance,
	type FrontendResult,
	NAZARE_LIQUID_SUPPORT,
} from "../frontend.js";
import { parseNazareLiquid } from "../parser.js";
import { markDiagnostics } from "../pipeline.js";
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
			input.dependencyResolver,
		);
		const assetResolution = resolveAssetImports(parsedAst, input.readFile);

		return {
			kind: "nazare-ast",
			ast: assetResolution.ast,
			contracts: contractResolution.contracts,
			resolveIssues: contractResolution.issues,
			notes: markDiagnostics(assetResolution.ast.notes, "parse"),
			sourceForEmit: input.source,
			frontendSupport: NAZARE_LIQUID_SUPPORT,
			contractProvenance: contractProvenance(assetResolution.ast),
		};
	},
};

function contractProvenance(ast: NazareAst): ContractProvenance {
	const hasExplicitContractSyntax =
		ast.schema !== undefined ||
		ast.nodes.some(
			(node) => node.type === "NazareComponent" || node.type === "NazareProps",
		);
	return hasExplicitContractSyntax ? "explicit" : "none";
}
