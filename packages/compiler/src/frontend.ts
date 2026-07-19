import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	ArtifactSyntaxNode,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import type { CompilerMode } from "./check.js";
import type { ReadFile } from "./resolver.js";

export type CompileInput = {
	source: string;
	file: string;
	/** Without a reader, every import diagnoses as unreadable. */
	readFile?: ReadFile;
	/** strict is package-author behavior; loose keeps migration checks minimal. */
	strictness?: CompilerMode;
};

export type FrontendCapabilities = {
	/** Contract facts came from explicit source-language syntax, not inference. */
	explicitContract: boolean;
	explicitProps: boolean;
	explicitSchema: boolean;
	explicitImports: boolean;
	explicitBehavior: boolean;
	/** Contract facts include best-effort inference and may need warnings. */
	inferredContract: boolean;
};

export type FrontendResult = {
	/** Frontend-owned AST, if callers need compatibility details. */
	ast?: NazareAst;
	/** Shared syntax/IR facts consumed by graph/check/emit. */
	syntax: ArtifactSyntaxNode[];
	ir: ArtifactIR;
	graph: ArtifactGraph;
	contract: ArtifactContract;
	contracts: ArtifactContract[];
	capabilities: FrontendCapabilities;
	issues: Diagnostic[];
	notes: Diagnostic[];
	/** Source text the current emitter should operate on. */
	sourceForEmit?: string;
};

export type CompilerFrontend = {
	name: string;
	accepts(file: string, source: string): boolean;
	compile(input: CompileInput): FrontendResult;
};

export const NAZARE_LIQUID_CAPABILITIES: FrontendCapabilities = {
	explicitContract: true,
	explicitProps: true,
	explicitSchema: true,
	explicitImports: true,
	explicitBehavior: true,
	inferredContract: false,
};
