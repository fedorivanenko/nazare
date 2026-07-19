// Shared compiler pass orchestration after parsing/import resolution. Keeps the
// syntax → bind → graph → check → validate sequence in one place so entry-file
// compilation and dependency checking cannot drift.
import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	ArtifactSyntaxNode,
	Diagnostic,
	DiagnosticPhase,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import { type CompilerMode, checkArtifactIR } from "./check.js";
import { checkVanillaSchema } from "./check-vanilla.js";
import { artifactGraphFromIR } from "./graph.js";
import { bindArtifactIR, contractFromIR } from "./symbols.js";
import { syntaxFromAst } from "./syntax.js";
import { validateArtifactGraph, validateArtifactIR } from "./validate.js";

export type ProjectArtifactOptions = {
	mode?: CompilerMode;
	contracts?: ArtifactContract[];
	resolveIssues?: Diagnostic[];
};

export type ProjectIROptions = {
	mode?: CompilerMode;
	contracts?: ArtifactContract[];
	issues?: Diagnostic[];
	contractPath: string;
};

export type ProjectedArtifact = {
	syntax: ArtifactSyntaxNode[];
	ir: ArtifactIR;
	graph: ArtifactGraph;
	issues: Diagnostic[];
	contract: ArtifactContract;
};

export function projectArtifact(
	ast: NazareAst,
	options: ProjectArtifactOptions = {},
): ProjectedArtifact {
	const contracts = options.contracts ?? [];
	const syntax = syntaxFromAst(ast);
	const ir = bindArtifactIR(syntax, { contracts });
	const graph = artifactGraphFromIR(ir);
	const issues = [
		...markDiagnostics(options.resolveIssues ?? [], "resolve"),
		...markDiagnostics(ast.diagnostics, "parse"),
		...markDiagnostics(checkVanillaSchema(ast), "check"),
		...sharedIRIssues(ir, graph, contracts, options.mode),
	];
	const contract = contractFromIR(ir, ast.file, contracts);

	return { syntax, ir, graph, issues, contract };
}

export function projectIR(
	syntax: ArtifactSyntaxNode[],
	ir: ArtifactIR,
	options: ProjectIROptions,
): ProjectedArtifact {
	const contracts = options.contracts ?? [];
	const graph = artifactGraphFromIR(ir);
	const issues = [
		...markDiagnostics(options.issues ?? [], "parse"),
		...sharedIRIssues(ir, graph, contracts, options.mode),
	];
	const contract = contractFromIR(ir, options.contractPath, contracts);

	return { syntax, ir, graph, issues, contract };
}

function sharedIRIssues(
	ir: ArtifactIR,
	graph: ArtifactGraph,
	contracts: ArtifactContract[],
	mode?: CompilerMode,
): Diagnostic[] {
	return [
		...markDiagnostics(checkArtifactIR(ir, contracts, { mode }), "check"),
		...markDiagnostics(validateArtifactIR(ir), "validate"),
		...markDiagnostics(validateArtifactGraph(graph), "validate"),
	];
}

export function markDiagnostics(
	diagnostics: Diagnostic[],
	phase: DiagnosticPhase,
): Diagnostic[] {
	return diagnostics.map((diagnostic) => ({
		...diagnostic,
		phase: diagnostic.phase ?? phase,
	}));
}
