import type { NazareAst } from "../ast.js";
import {
	type CompileInput,
	type CompilerFrontend,
	type ContractProvenance,
	type FrontendResult,
	NAZARE_LIQUID_SUPPORT,
} from "../frontend.js";
import { markDiagnostics } from "../pipeline.js";
import {
	createDependencyResolver,
	resolveAssetImports,
	resolveComponentContracts,
} from "../resolver.js";
import { projectTreeSitterNazareAst } from "../tree-sitter-nazare-projector.js";

export const treeSitterNazareLiquidFrontend: CompilerFrontend = {
	name: "tree-sitter-nazare-liquid",
	accepts(file: string): boolean {
		return file.endsWith(".nz.liquid");
	},
	compile(input: CompileInput): FrontendResult {
		const projection = projectTreeSitterNazareAst(input.source, input.file);
		const dependencyResolver =
			input.dependencyResolver?.sourceFrontend === "tree-sitter"
				? input.dependencyResolver
				: createDependencyResolver(input.readFile, {
						sourceFrontend: "tree-sitter",
					});
		const contractResolution = resolveComponentContracts(
			projection.ast,
			input.readFile,
			dependencyResolver,
		);
		const assetResolution = resolveAssetImports(projection.ast, input.readFile);

		return {
			kind: "nazare-ast",
			ast: assetResolution.ast,
			contracts: contractResolution.contracts,
			resolveIssues: contractResolution.issues,
			notes: markDiagnostics(assetResolution.ast.notes, "parse"),
			sourceForEmit: input.source,
			frontendSupport: NAZARE_LIQUID_SUPPORT,
			contractProvenance: contractProvenance(assetResolution.ast),
			metadata: {
				authoritative: projection.authoritative,
				factCount: projection.factCount,
			},
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
