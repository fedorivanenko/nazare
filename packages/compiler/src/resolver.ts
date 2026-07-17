// Resolver passes that need project files. Parse is pure over one source file;
// this module is the explicit boundary where imports become contracts or inline
// behavior/style nodes. All filesystem access goes through ReadFile.
import type { ArtifactContract, Diagnostic, SourceSpan } from "@nazare/core";
import type {
	NazareAst,
	NazareNode,
	NazareScriptNode,
	NazareStyleNode,
} from "./ast.js";
import type { CompilerMode } from "./check.js";
import { importCycle, importNotFound } from "./diagnostics.js";
import {
	parseNazareLiquid,
	scanDataAccesses,
	scanRefAccesses,
} from "./parser.js";
import { markDiagnostics, projectArtifact } from "./pipeline.js";
import { bindArtifactIR, contractFromIR } from "./symbols.js";
import { syntaxFromAst } from "./syntax.js";

export type ReadFile = (path: string) => string | undefined;

export type ComponentContractResolution = {
	contracts: ArtifactContract[];
	issues: Diagnostic[];
};

export type AssetImportResolution = {
	ast: NazareAst;
	issues: Diagnostic[];
};

type DependencyContext = {
	loadAst: (path: string) => NazareAst | undefined;
	resolveComponentContracts: (ast: NazareAst) => ComponentContractResolution;
};

type ContractDerivation = {
	contract: ArtifactContract | undefined;
	/** False when this derivation saw an import cycle in its active stack. */
	cacheable: boolean;
};

function createDependencyContext(
	readFile: ReadFile | undefined,
): DependencyContext {
	const astCache = new Map<string, NazareAst | undefined>();
	const contractCache = new Map<string, ArtifactContract | undefined>();

	const loadAst = (path: string): NazareAst | undefined => {
		if (astCache.has(path)) return astCache.get(path);
		const contents = readFile?.(path);
		const ast =
			contents === undefined ? undefined : parseNazareLiquid(contents, path);
		astCache.set(path, ast);
		return ast;
	};

	const deriveContract = (
		path: string,
		loading: Set<string>,
		issues: Diagnostic[],
	): ContractDerivation => {
		if (contractCache.has(path)) {
			return { contract: contractCache.get(path), cacheable: true };
		}
		const importedAst = loadAst(path);
		if (!importedAst) {
			contractCache.set(path, undefined);
			return { contract: undefined, cacheable: true };
		}

		loading.add(path);
		let cacheable = true;
		const dependencyContracts: ArtifactContract[] = [];
		for (const node of importedAst.nodes) {
			if (node.type !== "NazareImport") continue;
			if (loading.has(node.path)) {
				issues.push(importCycle(node.path, node.span));
				cacheable = false;
				continue;
			}
			const dependency = deriveContract(node.path, loading, issues);
			if (!dependency.cacheable) cacheable = false;
			if (dependency.contract) {
				dependencyContracts.push(dependency.contract);
			} else {
				issues.push(importNotFound(node.path, node.span));
			}
		}
		loading.delete(path);

		const importedIr = bindArtifactIR(syntaxFromAst(importedAst), {
			contracts: dependencyContracts,
		});
		const contract = contractFromIR(importedIr, path, dependencyContracts);
		if (cacheable) contractCache.set(path, contract);
		return { contract, cacheable };
	};

	const resolveContractsForAst = (
		ast: NazareAst,
	): ComponentContractResolution => {
		const issues: Diagnostic[] = [];
		const contracts: ArtifactContract[] = [];
		const seen = new Set<string>();
		for (const node of ast.nodes) {
			if (node.type !== "NazareImport" || seen.has(node.path)) continue;
			seen.add(node.path);
			if (node.path === ast.file) {
				issues.push(importCycle(node.path, node.span));
				continue;
			}
			const dependency = deriveContract(node.path, new Set([ast.file]), issues);
			if (!dependency.contract) {
				issues.push(importNotFound(node.path, node.span));
				continue;
			}
			contracts.push(dependency.contract);
		}
		return { contracts, issues };
	};

	return { loadAst, resolveComponentContracts: resolveContractsForAst };
}

/**
 * Derives contracts for imported component files by parsing/binding them
 * recursively. This pass does one thing: contracts. It reports only import
 * graph failures for the requesting file (missing files, cycles) — never the
 * imported files' own diagnostics. Checking those is checkDependencies, an
 * explicit call the build makes and a plain compile does not.
 */
export function resolveComponentContracts(
	ast: NazareAst,
	readFile: ReadFile | undefined,
): ComponentContractResolution {
	return createDependencyContext(readFile).resolveComponentContracts(ast);
}

/**
 * Fully checks every transitively-imported component file and returns their
 * diagnostics (deduped per path). This is the explicit opt-in the build makes
 * to validate its dependencies; a plain compile checks only the entry file.
 * Unreadable imports are silent here — resolveComponentContracts reports them.
 */
export function checkDependencies(
	ast: NazareAst,
	readFile: ReadFile | undefined,
	options: { mode?: CompilerMode } = {},
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const checked = new Set<string>();
	const dependencies = createDependencyContext(readFile);

	const visit = (path: string): void => {
		if (checked.has(path)) return;
		checked.add(path);
		const importedAst = dependencies.loadAst(path);
		if (!importedAst) return;

		const { contracts, issues: contractIssues } =
			dependencies.resolveComponentContracts(importedAst);
		const projected = projectArtifact(importedAst, {
			contracts,
			mode: options.mode,
			resolveIssues: contractIssues,
		});
		issues.push(...projected.issues);

		for (const node of importedAst.nodes) {
			if (node.type === "NazareImport") visit(node.path);
		}
	};

	for (const node of ast.nodes) {
		if (node.type === "NazareImport" && node.path !== ast.file)
			visit(node.path);
	}

	return issues;
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

	const resolvedIssues = markDiagnostics(issues, "resolve");
	return {
		ast: {
			...ast,
			nodes,
			diagnostics: [...ast.diagnostics, ...resolvedIssues],
		},
		issues: resolvedIssues,
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
