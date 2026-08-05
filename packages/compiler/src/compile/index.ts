import type {
	ArtifactContract,
	ArtifactGraph,
	ArtifactIR,
	ArtifactSyntaxNode,
	Diagnostic,
} from "@nazare/core";
import type { NazareAst } from "../ast.js";
import { DEFAULT_COMPILER_MODE } from "../check.js";
import type {
	CompileInput,
	CompilerFrontend,
	ContractProvenance,
	FrontendResult,
	FrontendSupport,
} from "../frontend.js";
import type { PlainLiquidFrontendMetadata } from "../frontends/plain-liquid.js";
import { treeSitterNazareLiquidFrontend } from "../frontends/tree-sitter-nazare-liquid.js";
import { treeSitterPlainLiquidFrontend } from "../frontends/tree-sitter-plain-liquid.js";
import { artifactGraphFromIR } from "../graph.js";
import {
	type ProjectedArtifact,
	projectArtifact,
	projectIR,
} from "../pipeline.js";
import type {
	BuildPlainLiquidOptions,
	BuildPlainLiquidResult,
	CompilePlainLiquidResult,
	PlainLiquidAst,
} from "../plain-liquid.js";
import { bindArtifactIR } from "../symbols.js";
import { syntaxFromAst } from "../syntax.js";

export type CompileNazareArtifactOptions = Pick<
	CompileInput,
	"readFile" | "strictness" | "dependencyResolver"
>;

export type CompileArtifactOptions = CompileInput & {
	frontend?: CompilerFrontend;
	frontends?: CompilerFrontend[];
};

export type CompileArtifactSuccess = {
	ok: true;
	frontend: string;
	ast?: NazareAst;
	syntax: ArtifactSyntaxNode[];
	ir: ArtifactIR;
	graph: ArtifactGraph;
	issues: Diagnostic[];
	notes: Diagnostic[];
	canEmit: boolean;
	contract: ArtifactContract;
	contracts: ArtifactContract[];
	frontendSupport: FrontendSupport;
	contractProvenance: ContractProvenance;
	sourceForEmit: string;
	frontendMetadata?: unknown;
};

export type CompileArtifactFailure = {
	ok: false;
	frontend?: string;
	issues: Diagnostic[];
	notes: Diagnostic[];
	canEmit: false;
};

export type CompileArtifactResult =
	| CompileArtifactSuccess
	| CompileArtifactFailure;

export type CompileResult = CompileArtifactSuccess & { ast: NazareAst };

export function artifactGraphFromAst(ast: NazareAst): ArtifactGraph {
	return artifactGraphFromIR(bindArtifactIR(syntaxFromAst(ast)));
}

export function compileArtifact(
	options: CompileArtifactOptions,
): CompileArtifactResult {
	const frontend = selectFrontend(options);
	if (!frontend) return unsupportedInput(options);
	const strictness = options.strictness ?? DEFAULT_COMPILER_MODE;
	const normalizedOptions = { ...options, strictness };
	const frontendResult = frontend.compile(normalizedOptions);
	switch (frontendResult.kind) {
		case "nazare-ast": {
			const projected = projectArtifact(frontendResult.ast, {
				contracts: frontendResult.contracts,
				mode: strictness,
				resolveIssues: frontendResult.resolveIssues,
			});
			return compileSuccess(frontend.name, frontendResult, projected);
		}
		case "direct-ir": {
			const projected = projectIR(frontendResult.syntax, frontendResult.ir, {
				contracts: frontendResult.contracts,
				mode: strictness,
				contractPath: frontendResult.contractPath,
				issues: frontendResult.issues,
			});
			return compileSuccess(frontend.name, frontendResult, projected);
		}
		case "failure":
			return {
				ok: false,
				frontend: frontend.name,
				issues: frontendResult.issues,
				notes: frontendResult.notes,
				canEmit: false,
			};
	}
}

export function compileNazareArtifact(
	source: string,
	file: string,
	options: CompileNazareArtifactOptions = {},
): CompileResult {
	const compiled = compileArtifact({ source, file, ...options });
	if (!compiled.ok) {
		throw new Error(
			compiled.issues.map((issue) => issue.message).join("\n") ||
				"Nazare Liquid compile failed",
		);
	}
	if (!compiled.ast) {
		throw new Error("Nazare Liquid frontend did not return an AST");
	}
	return { ...compiled, ast: compiled.ast };
}

export function compilePlainLiquid(
	source: string,
	file: string,
	options: Pick<BuildPlainLiquidOptions, "parseMode"> = {},
): CompilePlainLiquidResult {
	const compiled = compileArtifact({
		source,
		file,
		frontendOptions: options,
	});
	if (!compiled.ok) {
		throw new Error(
			compiled.issues[0]?.message ?? "Plain Liquid compile failed",
		);
	}
	const metadata = plainLiquidMetadata(compiled.frontendMetadata);
	return {
		ast: metadata.ast,
		issues: compiled.issues,
		dependencies: metadata.ast.dependencies,
		canEmit: compiled.canEmit,
	};
}

export function buildPlainLiquid(
	source: string,
	file: string,
	options: BuildPlainLiquidOptions = {},
): BuildPlainLiquidResult {
	const compiled = compilePlainLiquid(source, file, {
		parseMode: options.parseMode,
	});
	const emittedOnError = !compiled.canEmit && (options.emitOnError ?? false);
	const shouldEmit = compiled.canEmit || emittedOnError;
	return {
		...compiled,
		emitted: {
			files: shouldEmit ? [{ path: file, contents: source }] : [],
			issues: [],
		},
		issues: compiled.issues,
		emittedOnError,
	};
}

function plainLiquidMetadata(metadata: unknown): PlainLiquidFrontendMetadata {
	const candidate = metadata as PlainLiquidFrontendMetadata | undefined;
	if (candidate && isPlainLiquidAst(candidate.ast)) return candidate;
	throw new Error("Plain Liquid frontend did not return its metadata shape");
}

function isPlainLiquidAst(value: unknown): value is PlainLiquidAst {
	const ast = value as PlainLiquidAst | undefined;
	return (
		!!ast &&
		typeof ast.file === "string" &&
		Array.isArray(ast.dependencies) &&
		(ast.parseMode === "strict" || ast.parseMode === "liquid-only")
	);
}

function compileSuccess(
	frontend: string,
	frontendResult: Exclude<FrontendResult, { kind: "failure" }>,
	projected: ProjectedArtifact,
): CompileArtifactSuccess {
	return {
		ok: true,
		frontend,
		ast: frontendResult.kind === "nazare-ast" ? frontendResult.ast : undefined,
		syntax: projected.syntax,
		ir: projected.ir,
		graph: projected.graph,
		issues: projected.issues,
		notes: frontendResult.notes,
		canEmit: !hasErrors(projected.issues),
		contract: projected.contract,
		contracts: frontendResult.contracts,
		frontendSupport: frontendResult.frontendSupport,
		contractProvenance: frontendResult.contractProvenance,
		sourceForEmit: frontendResult.sourceForEmit,
		frontendMetadata: frontendResult.metadata,
	};
}

function selectFrontend(
	options: CompileArtifactOptions,
): CompilerFrontend | undefined {
	if (options.frontend) return options.frontend;
	for (const frontend of options.frontends ?? []) {
		if (frontend.accepts(options.file, options.source)) return frontend;
	}
	if (treeSitterNazareLiquidFrontend.accepts(options.file, options.source)) {
		return treeSitterNazareLiquidFrontend;
	}
	if (treeSitterPlainLiquidFrontend.accepts(options.file, options.source)) {
		return treeSitterPlainLiquidFrontend;
	}
	return undefined;
}

function unsupportedInput(
	options: CompileArtifactOptions,
): CompileArtifactFailure {
	return {
		ok: false,
		frontend: undefined,
		issues: [
			{
				severity: "error",
				code: "UNSUPPORTED_COMPILER_INPUT",
				message: `No compiler frontend accepts ${options.file}`,
				phase: "parse",
			},
		],
		notes: [],
		canEmit: false,
	};
}

function hasErrors(issues: Diagnostic[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}

export {
	type CompiledComponent,
	type EmitResult,
	type EmitThemeOptions,
	type EmittedFile,
	emitTheme,
} from "../emit.js";
export { collectPlainLiquidThemeFacts } from "../liquid-facts.js";
export { themeSchemaFromIR } from "../schema.js";
