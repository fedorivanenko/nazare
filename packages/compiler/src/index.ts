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
	NazareManifest,
} from "@nazare/core";
import type { NazareAst, NazareNode } from "./ast.js";
import { checkArtifactIR } from "./check.js";
import {
	assetImportNotFound,
	contractResolutionFailed,
} from "./diagnostics.js";
import { artifactGraphFromIR } from "./graph.js";
import {
	parseNazareLiquid,
	scanDataAccesses,
	scanRefAccesses,
} from "./parser.js";
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
export { checkComponentScripts } from "./check-script.js";
export { artifactGraphFromIR } from "./graph.js";
export { componentSymbolIdForPackage } from "./ids.js";
export { parseNazareLiquid } from "./parser.js";
export {
	type EmitResult,
	type EmitThemeOptions,
	type EmittedFile,
	emitTheme,
} from "./emit.js";
export {
	type ThemeSchemaFromIROptions,
	themeSchemaFromIR,
} from "./schema.js";
export { bindArtifactIR, contractFromIR } from "./symbols.js";
export { syntaxFromAst } from "./syntax.js";
export { validateArtifactGraph, validateArtifactIR } from "./validate.js";

export type CompileNazareArtifactOptions = {
	/** Contracts of imported packages; render sites are checked against them. */
	contracts?: ArtifactContract[];
	/** When set, the artifact's own contract is produced under this package id. */
	packageId?: string;
	/** Manifest kind; enables section/snippet provenance rules in check. */
	kind?: NazareManifest["kind"];
	/**
	 * Reads a sidecar asset referenced by a relative {% import %}, given its
	 * path relative to the component file. Undefined means not found. Without
	 * a reader, relative imports diagnose as unreadable.
	 */
	readAsset?: (relativePath: string) => string | undefined;
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
	kind?: NazareManifest["kind"];
	readAsset?: (relativePath: string) => string | undefined;
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
	const ast = parseNazareLiquid(source, file);
	resolveAssetImports(ast, options.readAsset);
	return compileFromAst(ast, options);
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
	resolveAssetImports(ast, options.readAsset);
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
		kind: options.kind,
	});
	return { ...result, issues: [...resolutionIssues, ...result.issues] };
}

/**
 * Replaces each relative-import node with the script/style node its sidecar
 * file contains, in place — declaration order is mount order, and the
 * import tag's span becomes the synthesized node's span so emission removes
 * it. Sidecar-local spans (bodySpan, ref accesses) point into the sidecar
 * file itself.
 */
function resolveAssetImports(
	ast: NazareAst,
	readAsset: ((relativePath: string) => string | undefined) | undefined,
): void {
	ast.nodes = ast.nodes.map((node): NazareNode => {
		if (node.type !== "NazareAssetImport") return node;

		const contents = readAsset?.(node.path);
		if (contents === undefined) {
			ast.diagnostics.push(assetImportNotFound(node.path, node.span));
			return node;
		}

		const sidecarFile = sidecarPath(ast.file, node.path);
		const lines = contents.split("\n");
		const bodySpan = {
			file: sidecarFile,
			start: { line: 1, column: 1 },
			end: {
				line: lines.length,
				column: (lines.at(-1)?.length ?? 0) + 1,
			},
		};

		if (node.path.endsWith(".css")) {
			return {
				type: "NazareStyle",
				source: contents,
				span: node.span,
				bodySpan,
			};
		}

		return {
			type: "NazareScript",
			lang: node.path.endsWith(".ts") ? "ts" : "js",
			source: contents,
			refAccesses: scanRefAccesses(contents, sidecarFile),
			dataAccesses: scanDataAccesses(contents, sidecarFile),
			span: node.span,
			bodySpan,
		};
	});
}

function sidecarPath(componentFile: string, relativePath: string): string {
	const directory = componentFile.split("/").slice(0, -1).join("/");
	const local = relativePath.replace(/^\.\//, "");
	return directory ? `${directory}/${local}` : local;
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
		...checkArtifactIR(ir, options.contracts, { kind: options.kind }),
		...validateArtifactIR(ir),
		...validateArtifactGraph(graph),
	];
	const contract = options.packageId
		? contractFromIR(ir, options.packageId)
		: undefined;

	return { ast, ir, graph, issues, contract };
}
