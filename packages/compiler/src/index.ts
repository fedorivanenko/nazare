/**
 * Public API of the Nazare compiler.
 *
 * Pipeline: parse → syntax → bind → check → graph → validate. Each pass is
 * exported individually for tooling that needs a single stage;
 * compileNazareArtifact runs the whole pipeline. See README.md for what each
 * pass owns.
 *
 * Files are identified by project-relative paths. All imports are relative
 * paths to real files inside the project — there is no package resolution at
 * compile time (installing a component copies its source into the project).
 * Imported component files are compiled on the spot to derive their
 * contracts; readFile is the only way the compiler touches other files.
 */
import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst, NazareNode } from "./ast.js";
import { checkArtifactIR } from "./check.js";
import { checkVanillaSchema } from "./check-vanilla.js";
import { importCycle, importNotFound } from "./diagnostics.js";
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
export { componentSymbolIdForFile } from "./ids.js";
export { componentKindFromIR } from "./symbols.js";
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

/**
 * Reads a project file by its project-relative path. Undefined means the
 * file does not exist. This is the compiler's entire filesystem: import
 * resolution, contract derivation, and script bundling all go through it.
 */
export type ReadFile = (path: string) => string | undefined;

export type CompileNazareArtifactOptions = {
	/** Without a reader, every import diagnoses as unreadable. */
	readFile?: ReadFile;
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
	/** This artifact's own contract, keyed by its file path. */
	contract: ArtifactContract;
	/** Contracts of the imported component files (needed for hoisting at emit time). */
	contracts: ArtifactContract[];
};

/** Shortcut to a graph when diagnostics and contracts are not needed. */
export function artifactGraphFromAst(ast: NazareAst): ArtifactGraph {
	return artifactGraphFromIR(bindArtifactIR(syntaxFromAst(ast)));
}

/** Compiles one artifact, deriving imported components' contracts via readFile. */
export function compileNazareArtifact(
	source: string,
	file: string,
	options: CompileNazareArtifactOptions = {},
): CompileResult {
	const ast = parseNazareLiquid(source, file);
	const issues: Diagnostic[] = [];
	const contracts = resolveComponentImports(ast, options.readFile, issues);
	resolveAssetImports(ast, options.readFile);

	const syntax = syntaxFromAst(ast);
	const ir = bindArtifactIR(syntax, { contracts });
	const graph = artifactGraphFromIR(ir);
	issues.push(
		...ast.diagnostics,
		...checkVanillaSchema(ast),
		...checkArtifactIR(ir, contracts),
		...validateArtifactIR(ir),
		...validateArtifactGraph(graph),
	);
	const contract = contractFromIR(ir, file, contracts);

	return { ast, ir, graph, issues, contract, contracts };
}

/**
 * Derives a contract for each imported component file by compiling it —
 * parse and bind only, recursively, so transitive hoisted settings surface.
 * Diagnostics inside an imported file are its own compile's business; here
 * only unreadable files and import cycles are reported.
 */
function resolveComponentImports(
	ast: NazareAst,
	readFile: ReadFile | undefined,
	issues: Diagnostic[],
): ArtifactContract[] {
	const cache = new Map<string, ArtifactContract | undefined>();

	const derive = (
		path: string,
		loading: Set<string>,
	): ArtifactContract | undefined => {
		if (cache.has(path)) return cache.get(path);
		const contents = readFile?.(path);
		if (contents === undefined) {
			cache.set(path, undefined);
			return undefined;
		}

		const importedAst = parseNazareLiquid(contents, path);
		loading.add(path);
		const dependencyContracts: ArtifactContract[] = [];
		for (const node of importedAst.nodes) {
			if (node.type !== "NazareImport") continue;
			if (loading.has(node.path)) {
				issues.push(importCycle(node.path, node.span));
				continue;
			}
			const dependency = derive(node.path, loading);
			if (dependency) dependencyContracts.push(dependency);
		}
		loading.delete(path);

		const contract = contractFromIR(
			bindArtifactIR(syntaxFromAst(importedAst), {
				contracts: dependencyContracts,
			}),
			path,
			dependencyContracts,
		);
		cache.set(path, contract);
		return contract;
	};

	const contracts: ArtifactContract[] = [];
	const seen = new Set<string>();
	for (const node of ast.nodes) {
		if (node.type !== "NazareImport" || seen.has(node.path)) continue;
		seen.add(node.path);
		if (node.path === ast.file) {
			issues.push(importCycle(node.path, node.span));
			continue;
		}
		const contract = derive(node.path, new Set([ast.file]));
		if (!contract) {
			issues.push(importNotFound(node.path, node.span));
			continue;
		}
		contracts.push(contract);
	}
	return contracts;
}

/**
 * Replaces each behavior/style import node with the script/style node its
 * file contains, in place — declaration order is mount order, and the
 * import tag's span becomes the synthesized node's span so emission removes
 * it. Imported-file spans (bodySpan, ref accesses) point into that file.
 */
function resolveAssetImports(
	ast: NazareAst,
	readFile: ReadFile | undefined,
): void {
	ast.nodes = ast.nodes.map((node): NazareNode => {
		if (node.type !== "NazareAssetImport") return node;

		const contents = readFile?.(node.path);
		if (contents === undefined) {
			ast.diagnostics.push(importNotFound(node.path, node.span));
			return node;
		}

		const lines = contents.split("\n");
		const bodySpan = {
			file: node.path,
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
				bindingName: node.localName,
				span: node.span,
				bodySpan,
			};
		}

		return {
			type: "NazareScript",
			lang: node.path.endsWith(".ts") ? "ts" : "js",
			source: contents,
			refAccesses: scanRefAccesses(contents, node.path),
			dataAccesses: scanDataAccesses(contents, node.path),
			bindingName: node.localName,
			span: node.span,
			bodySpan,
		};
	});
}
