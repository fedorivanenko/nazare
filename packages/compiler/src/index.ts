import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import { checkArtifactIR } from "./check.js";
import { artifactGraphFromIR } from "./graph.js";
import { parseNazareLiquid } from "./parser.js";
import { bindArtifactIR, contractFromIR } from "./symbols.js";
import { syntaxFromAst } from "./syntax.js";
import { validateArtifactGraph, validateArtifactIR } from "./validate.js";

export type {
	NazareAst,
	NazareImportNode,
	NazareNode,
	NazareOpaqueNode,
	NazarePassedProp,
	NazarePropDeclaration,
	NazarePropsNode,
	NazareRenderNode,
	ParseDiagnostic,
} from "./ast.js";
export { checkArtifactIR } from "./check.js";
export { artifactGraphFromIR } from "./graph.js";
export { componentSymbolIdForPackage } from "./ids.js";
export { parseNazareLiquid } from "./parser.js";
export { bindArtifactIR, contractFromIR } from "./symbols.js";
export { syntaxFromAst } from "./syntax.js";
export { validateArtifactGraph, validateArtifactIR } from "./validate.js";

export type CompileNazareArtifactOptions = {
	contracts?: ArtifactContract[];
	packageId?: string;
};

export type CompileResult = {
	ast: NazareAst;
	ir: ArtifactIR;
	graph: ArtifactGraph;
	issues: Diagnostic[];
	contract?: ArtifactContract;
};

export function artifactGraphFromAst(ast: NazareAst): ArtifactGraph {
	return artifactGraphFromIR(bindArtifactIR(syntaxFromAst(ast)));
}

export function compileNazareArtifact(
	source: string,
	file: string,
	options: CompileNazareArtifactOptions = {},
): CompileResult {
	const ast = parseNazareLiquid(source, file);
	const syntax = syntaxFromAst(ast);
	const ir = bindArtifactIR(syntax, { contracts: options.contracts });
	const graph = artifactGraphFromIR(ir);
	const issues = [
		...ast.diagnostics,
		...checkArtifactIR(ir, options.contracts),
		...validateArtifactIR(ir),
		...validateArtifactGraph(graph),
	];
	const contract = options.packageId
		? contractFromIR(ir, options.packageId)
		: undefined;

	return { ast, ir, graph, issues, contract };
}
