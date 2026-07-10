/**
 * Public API of the Nazare compiler.
 *
 * Pipeline: parse → syntax → bind → check → graph → validate. Each pass is
 * exported individually for tooling that needs a single stage; the
 * compileNazareArtifact* functions run the whole pipeline. See README.md for
 * what each pass owns.
 */
import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import { checkArtifactIR } from "./check.js";
import { contractResolutionFailed } from "./diagnostics.js";
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
	/** Contracts of imported packages; render sites are checked against them. */
	contracts?: ArtifactContract[];
	/** When set, the artifact's own contract is produced under this package id. */
	packageId?: string;
};

/**
 * Supplies the compiled contract for an imported package, or undefined when
 * the package is unknown. Thrown errors surface as compile diagnostics.
 */
export type ContractResolver = (
	packageId: string,
) => Promise<ArtifactContract | undefined> | ArtifactContract | undefined;

export type CompileWithResolverOptions = {
	resolver?: ContractResolver;
	packageId?: string;
};

export type CompileResult = {
	/** Nazare nodes plus the full LiquidHTML AST (unsupported syntax preserved). */
	ast: NazareAst;
	/** Flat syntax nodes, symbols, and resolutions — facts only, no judgments. */
	ir: ArtifactIR;
	/** IR projected into nodes and typed edges for queries and visualization. */
	graph: ArtifactGraph;
	/** All diagnostics from every pass; any "error" severity fails the compile. */
	issues: Diagnostic[];
	/** Present only when options.packageId was given. */
	contract?: ArtifactContract;
};

/** Shortcut to a graph when diagnostics and contracts are not needed. */
export function artifactGraphFromAst(ast: NazareAst): ArtifactGraph {
	return artifactGraphFromIR(bindArtifactIR(syntaxFromAst(ast)));
}

/** Compiles one artifact with contracts already in hand (sync). */
export function compileNazareArtifact(
	source: string,
	file: string,
	options: CompileNazareArtifactOptions = {},
): CompileResult {
	return compileFromAst(parseNazareLiquid(source, file), options);
}

/**
 * Compiles one artifact, fetching each imported package's contract through
 * the resolver first. Resolver failures do not abort the compile; they
 * surface as CONTRACT_RESOLUTION_FAILED and the import degrades to the
 * unresolved-contract warning.
 */
export async function compileNazareArtifactWithResolver(
	source: string,
	file: string,
	options: CompileWithResolverOptions = {},
): Promise<CompileResult> {
	const ast = parseNazareLiquid(source, file);
	const imports = ast.nodes.filter(
		(node) => node.type === "NazareImport",
	);
	const contracts: ArtifactContract[] = [];
	const resolutionIssues: Diagnostic[] = [];
	const seen = new Set<string>();

	for (const node of imports) {
		if (!options.resolver || seen.has(node.packageId)) continue;
		seen.add(node.packageId);
		try {
			const contract = await options.resolver(node.packageId);
			if (contract) contracts.push(contract);
		} catch (error) {
			resolutionIssues.push(
				contractResolutionFailed(
					node.packageId,
					error instanceof Error ? error.message : String(error),
					node.span,
				),
			);
		}
	}

	const result = compileFromAst(ast, {
		contracts,
		packageId: options.packageId,
	});
	return { ...result, issues: [...resolutionIssues, ...result.issues] };
}

function compileFromAst(
	ast: NazareAst,
	options: CompileNazareArtifactOptions,
): CompileResult {
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
