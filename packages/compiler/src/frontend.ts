import type {
	ArtifactContract,
	ArtifactIR,
	ArtifactSyntaxNode,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import type { CompilerMode } from "./check.js";
import type { DependencyResolver, ReadFile } from "./resolver.js";

export type CompileInput = {
	source: string;
	file: string;
	/** Without a reader, every import diagnoses as unreadable. */
	readFile?: ReadFile;
	/**
	 * Caller-owned dependency caches. A build creates one resolver and passes
	 * it here and to checkDependencies so dependencies parse once, not per
	 * phase; omitted, the frontend creates a private one.
	 */
	dependencyResolver?: DependencyResolver;
	/** strict is package-author behavior; loose keeps migration checks minimal. */
	strictness?: CompilerMode;
	/** Frontend-owned options, validated by the selected frontend. */
	frontendOptions?: Record<string, unknown>;
};

export type FrontendSupport = {
	explicitPropsSyntax: boolean;
	explicitSchemaSyntax: boolean;
	explicitImportsSyntax: boolean;
	explicitBehaviorSyntax: boolean;
	rawInference: boolean;
};

export type ContractProvenance = "explicit" | "inferred" | "mixed" | "none";

type FrontendResultBase = {
	/** Dependency contracts discovered while resolving frontend imports. */
	contracts: ArtifactContract[];
	/** Frontend notes, already phase-marked if needed by the frontend. */
	notes: Diagnostic[];
	/** Source text the current emitter should operate on. */
	sourceForEmit: string;
	frontendSupport: FrontendSupport;
	contractProvenance: ContractProvenance;
	/** Frontend-owned metadata for typed compatibility wrappers and tooling. */
	metadata?: unknown;
};

export type NazareAstFrontendResult = FrontendResultBase & {
	kind: "nazare-ast";
	/** Frontend-owned parse tree; shared projection happens in compileArtifact(). */
	ast: NazareAst;
	/** Resolve-phase diagnostics; compileArtifact() phase-marks and projects them. */
	resolveIssues: Diagnostic[];
};

export type DirectIRFrontendResult = FrontendResultBase & {
	kind: "direct-ir";
	/** Source-language frontend syntax facts; graph/contract/checks happen centrally. */
	syntax: ArtifactSyntaxNode[];
	ir: ArtifactIR;
	/** Contract key to use when deriving the artifact contract from IR. */
	contractPath: string;
	/** Frontend diagnostics that are not emitted by shared IR checks; compileArtifact() defaults unphased entries to parse. */
	issues: Diagnostic[];
};

export type FrontendResult = NazareAstFrontendResult | DirectIRFrontendResult;

export type CompilerFrontend = {
	name: string;
	accepts(file: string, source: string): boolean;
	compile(input: CompileInput): FrontendResult;
};

export const NAZARE_LIQUID_SUPPORT: FrontendSupport = {
	explicitPropsSyntax: true,
	explicitSchemaSyntax: true,
	explicitImportsSyntax: true,
	explicitBehaviorSyntax: true,
	rawInference: false,
};
