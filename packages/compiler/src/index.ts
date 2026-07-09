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
export { artifactGraphFromAst } from "./graph.js";
export { parseNazareLiquid } from "./parser.js";
export { validateArtifactGraph } from "./validate.js";

export function compilerPackageName(): string {
	return "@nazare/compiler";
}
