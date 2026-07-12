// Resolver passes that need project files. Parse is pure over one source file;
// this module is the explicit boundary where imports become contracts or inline
// behavior/style nodes. All filesystem access goes through ReadFile.
import type {
	ArtifactContract,
	ArtifactIR,
	Diagnostic,
	SourceSpan,
} from "@nazare/core";
import type {
	NazareAst,
	NazareNode,
	NazareScriptNode,
	NazareStyleNode,
} from "./ast.js";
import { type CompilerMode, checkArtifactIR } from "./check.js";
import { checkVanillaSchema } from "./check-vanilla.js";
import { importCycle, importNotFound } from "./diagnostics.js";
import {
	parseNazareLiquid,
	scanDataAccesses,
	scanRefAccesses,
} from "./parser.js";
import { bindArtifactIR, contractFromIR } from "./symbols.js";
import { syntaxFromAst } from "./syntax.js";
import { validateArtifactIR } from "./validate.js";

export type ReadFile = (path: string) => string | undefined;

export type DependencyDiagnosticsPolicy = "hidden" | "surface";

export type ResolveComponentContractsOptions = {
	dependencyDiagnostics?: DependencyDiagnosticsPolicy;
	mode?: CompilerMode;
};

export type ComponentContractResolution = {
	contracts: ArtifactContract[];
	issues: Diagnostic[];
};

export type AssetImportResolution = {
	ast: NazareAst;
	issues: Diagnostic[];
};

/**
 * Derives contracts for imported component files by parsing/binding them
 * recursively. Imported-file diagnostics are not surfaced here; this pass only
 * reports import graph failures for the requesting file.
 */
export function resolveComponentContracts(
	ast: NazareAst,
	readFile: ReadFile | undefined,
	options: ResolveComponentContractsOptions = {},
): ComponentContractResolution {
	const issues: Diagnostic[] = [];
	const surfaceDependencyDiagnostics =
		options.dependencyDiagnostics === "surface";
	const cache = new Map<string, ArtifactContract | undefined>();
	const reportedDiagnostics = new Set<string>();

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

		const importedIr = bindArtifactIR(syntaxFromAst(importedAst), {
			contracts: dependencyContracts,
		});
		const contract = contractFromIR(importedIr, path, dependencyContracts);
		if (surfaceDependencyDiagnostics) {
			issues.push(
				...diagnosticsForImportedFile(
					path,
					importedAst,
					importedIr,
					dependencyContracts,
					reportedDiagnostics,
					options.mode,
				),
			);
		}
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

	return { contracts, issues };
}

function diagnosticsForImportedFile(
	path: string,
	ast: NazareAst,
	ir: ArtifactIR,
	contracts: ArtifactContract[],
	reported: Set<string>,
	mode: CompilerMode | undefined,
): Diagnostic[] {
	if (reported.has(path)) return [];
	reported.add(path);
	return [
		...ast.diagnostics,
		...checkVanillaSchema(ast),
		...checkArtifactIR(ir, contracts, { mode }),
		...validateArtifactIR(ir),
	];
}

/**
 * Replaces asset import nodes with synthesized script/style nodes in a cloned
 * AST. Declaration order is preserved by the parser's sorted node list.
 */
export function resolveAssetImports(
	ast: NazareAst,
	readFile: ReadFile | undefined,
): AssetImportResolution {
	const issues: Diagnostic[] = [];
	const nodes = ast.nodes.map((node): NazareNode => {
		if (node.type !== "NazareAssetImport") return node;

		const contents = readFile?.(node.path);
		if (contents === undefined) {
			issues.push(importNotFound(node.path, node.span));
			return node;
		}

		if (node.path.endsWith(".css")) {
			return styleNodeFromAsset(node.path, contents, node.localName, node.span);
		}

		return scriptNodeFromAsset(node.path, contents, node.localName, node.span);
	});

	return {
		ast: {
			...ast,
			nodes,
			diagnostics: [...ast.diagnostics, ...issues],
		},
		issues,
	};
}

function styleNodeFromAsset(
	path: string,
	contents: string,
	bindingName: string,
	span: SourceSpan,
): NazareStyleNode {
	return {
		type: "NazareStyle",
		source: contents,
		bindingName,
		span,
		bodySpan: wholeFileSpan(path, contents),
	};
}

function scriptNodeFromAsset(
	path: string,
	contents: string,
	bindingName: string,
	span: SourceSpan,
): NazareScriptNode {
	return {
		type: "NazareScript",
		lang: path.endsWith(".ts") ? "ts" : "js",
		source: contents,
		refAccesses: scanRefAccesses(contents, path),
		dataAccesses: scanDataAccesses(contents, path),
		bindingName,
		span,
		bodySpan: wholeFileSpan(path, contents),
	};
}

function wholeFileSpan(file: string, source: string): SourceSpan {
	const lines = source.split("\n");
	return {
		file,
		start: { line: 1, column: 1 },
		end: {
			line: lines.length,
			column: (lines.at(-1)?.length ?? 0) + 1,
		},
	};
}
