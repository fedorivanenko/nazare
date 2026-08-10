import { createHash } from "node:crypto";
import type { FrontendLimits } from "../frontends/frontend.js";
import { SemanticInspect } from "../inspect/semantic-inspect.js";
import {
	createQueryableSemanticOutput,
	openQueryableSemanticOutput,
	type QueryableSemanticOutput,
} from "../outputs/queryable-output.js";
import type { SemanticRevision } from "../outputs/semantic-graph-snapshot.js";
import type {
	ParsedDocument,
	ParserDiagnostic,
	ParserProvider,
} from "../parsers/parser.js";
import type { SemanticQueryIndex } from "../query/semantic-query.js";
import type { SemanticContribution } from "./semantic-contribution.js";
import type { SemanticGraphAssembler } from "./semantic-graph-assembler.js";

export type SemanticCompilerSource = {
	path: string;
	source: string;
	language?: string;
};

export type SemanticCompilerRevisionInput = Omit<
	SemanticRevision,
	"id" | "repositoryFingerprint"
>;

export type SemanticCompilerInput = {
	sources: readonly SemanticCompilerSource[];
	revision: SemanticCompilerRevisionInput;
	repositoryScope: { status: "complete" | "partial" };
	limits?: Partial<FrontendLimits>;
};

export type SemanticSourcePipeline = {
	id: string;
	version: number;
	accepts(document: ParsedDocument<unknown>): boolean;
	project(
		document: ParsedDocument<unknown>,
		limits: FrontendLimits,
	): SemanticContribution;
};

export type SemanticFallbackProjectorInput = {
	path: string;
	source: string;
	language: string;
	parserDiagnostics: readonly ParserDiagnostic[];
};

export type SemanticFallbackProjector = {
	id: string;
	version: number;
	project(input: SemanticFallbackProjectorInput): SemanticContribution;
};

export type SemanticCompilerOptions = {
	assembler: SemanticGraphAssembler;
	parserProviders: readonly ParserProvider<ParsedDocument<unknown>>[];
	pipelines: readonly SemanticSourcePipeline[];
	fallbackProjector: SemanticFallbackProjector;
};

export type SemanticCompilationSourceReport = {
	path: string;
	language: string;
	parser?: string;
	pipeline?: string;
	semanticSupport: "projected" | "source-only";
};

export type SemanticCompilation = {
	output: QueryableSemanticOutput;
	query: SemanticQueryIndex;
	inspect: SemanticInspect;
	report: {
		sources: readonly SemanticCompilationSourceReport[];
	};
};

export class SemanticCompilerInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SemanticCompilerInputError";
	}
}

export const DEFAULT_SEMANTIC_COMPILER_LIMITS: FrontendLimits = {
	maxFacts: 10_000,
	maxWork: 100_000,
};

/** Deterministic orchestration from in-memory repository sources to Inspect. */
export class SemanticCompiler {
	constructor(readonly options: SemanticCompilerOptions) {}

	compile(input: SemanticCompilerInput): SemanticCompilation {
		validateCompilationInput(input);
		const sources = normalizeSources(input.sources);
		const limits = compilerLimits(input.limits);
		const contributions: SemanticContribution[] = [];
		const report: SemanticCompilationSourceReport[] = [];
		const sourceByPath = new Map<string, string>();
		for (const source of sources) {
			sourceByPath.set(source.path, source.source);
			const provider = this.options.parserProviders.find((candidate) =>
				candidate.accepts(source.path, source.language),
			);
			if (!provider) {
				const language = source.language ?? inferLanguage(source.path);
				contributions.push(
					this.options.fallbackProjector.project({
						...source,
						language,
						parserDiagnostics: [],
					}),
				);
				report.push({
					path: source.path,
					language,
					semanticSupport: "source-only",
				});
				continue;
			}
			const parsed = provider.parse(source);
			if (!parsed.ok) {
				const language = source.language ?? provider.languages[0] ?? "unknown";
				contributions.push(
					this.options.fallbackProjector.project({
						...source,
						language,
						parserDiagnostics: parsed.diagnostics,
					}),
				);
				report.push({
					path: source.path,
					language,
					parser: provider.id,
					semanticSupport: "source-only",
				});
				continue;
			}
			const pipelines = this.options.pipelines.filter((pipeline) =>
				pipeline.accepts(parsed.document),
			);
			if (pipelines.length > 1) {
				throw new SemanticCompilerInputError(
					`Multiple semantic pipelines accept ${source.path}: ${pipelines
						.map(({ id }) => id)
						.join(", ")}`,
				);
			}
			const pipeline = pipelines[0];
			if (pipeline) {
				contributions.push(pipeline.project(parsed.document, limits));
				report.push({
					path: source.path,
					language: parsed.document.language,
					parser: provider.id,
					pipeline: pipeline.id,
					semanticSupport: "projected",
				});
			} else {
				contributions.push(
					this.options.fallbackProjector.project({
						...source,
						language: parsed.document.language,
						parserDiagnostics: parsed.document.diagnostics,
					}),
				);
				report.push({
					path: source.path,
					language: parsed.document.language,
					parser: provider.id,
					semanticSupport: "source-only",
				});
			}
		}
		const repositoryFingerprint = fingerprintSources(sources);
		const revision: SemanticRevision = {
			...input.revision,
			repositoryFingerprint,
			id: revisionId(repositoryFingerprint, input.revision, {
				compiler: compilerSignature(this.options),
				limits,
				repositoryScope: input.repositoryScope,
			}),
		};
		const snapshot = this.options.assembler.assemble({
			revision,
			contributions,
			repositoryScope: input.repositoryScope,
		});
		const output = createQueryableSemanticOutput(snapshot);
		const query = openQueryableSemanticOutput(output);
		return {
			output,
			query,
			inspect: new SemanticInspect(query, {
				source: (path) => sourceByPath.get(path),
			}),
			report: { sources: report },
		};
	}
}

function validateCompilationInput(input: SemanticCompilerInput): void {
	if (!input || typeof input !== "object" || !Array.isArray(input.sources)) {
		throw new SemanticCompilerInputError(
			"Compiler input requires sources array",
		);
	}
	if (
		!input.revision ||
		typeof input.revision.compilerVersion !== "string" ||
		!input.revision.compilerVersion ||
		!input.revision.externalInputs ||
		typeof input.revision.externalInputs !== "object" ||
		Array.isArray(input.revision.externalInputs) ||
		Object.values(input.revision.externalInputs).some(
			(value) => typeof value !== "string",
		)
	) {
		throw new SemanticCompilerInputError(
			"Compiler revision requires compilerVersion and string externalInputs",
		);
	}
	if (
		input.repositoryScope?.status !== "complete" &&
		input.repositoryScope?.status !== "partial"
	) {
		throw new SemanticCompilerInputError(
			"repositoryScope.status must be complete or partial",
		);
	}
}

function normalizeSources(
	inputs: readonly SemanticCompilerSource[],
): SemanticCompilerSource[] {
	const paths = new Set<string>();
	const sources = inputs.map((input) => {
		if (
			typeof input.path !== "string" ||
			typeof input.source !== "string" ||
			(input.language !== undefined &&
				(typeof input.language !== "string" || !input.language))
		) {
			throw new SemanticCompilerInputError(
				"Compiler sources require string path, source, and optional language fields",
			);
		}
		const path = input.path.replaceAll("\\", "/").replace(/^\.\//u, "");
		if (
			!path ||
			path.startsWith("/") ||
			path.split("/").some((part) => !part || part === "." || part === "..")
		) {
			throw new SemanticCompilerInputError(
				`Source path must be canonical and repository-relative: ${input.path}`,
			);
		}
		if (paths.has(path)) {
			throw new SemanticCompilerInputError(`Duplicate source path: ${path}`);
		}
		paths.add(path);
		return {
			path,
			source: input.source,
			...(input.language ? { language: input.language } : {}),
		};
	});
	return sources.sort((left, right) => left.path.localeCompare(right.path));
}

function compilerLimits(input?: Partial<FrontendLimits>): FrontendLimits {
	const limits = { ...DEFAULT_SEMANTIC_COMPILER_LIMITS, ...input };
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new SemanticCompilerInputError(
				`${name} must be a positive safe integer`,
			);
		}
	}
	return limits;
}

function fingerprintSources(
	sources: readonly SemanticCompilerSource[],
): string {
	const hash = createHash("sha256");
	for (const source of sources) {
		hash.update(
			JSON.stringify([source.path, source.language ?? null, source.source]),
		);
	}
	return `sha256:${hash.digest("hex")}`;
}

function compilerSignature(options: SemanticCompilerOptions): unknown {
	return {
		ontologies: options.assembler.contract.ontologies
			.map(({ namespace, version }) => ({ namespace, version }))
			.sort((left, right) => left.namespace.localeCompare(right.namespace)),
		parsers: options.parserProviders
			.map(({ id, version }) => ({ id, version }))
			.sort((left, right) => left.id.localeCompare(right.id)),
		pipelines: options.pipelines
			.map(({ id, version }) => ({ id, version }))
			.sort((left, right) => left.id.localeCompare(right.id)),
		fallbackProjector: {
			id: options.fallbackProjector.id,
			version: options.fallbackProjector.version,
		},
		assemblyPasses: options.assembler.passes.map(({ id }) => id).sort(),
	};
}

function revisionId(
	repositoryFingerprint: string,
	revision: SemanticCompilerRevisionInput,
	compilerInputs: unknown,
): string {
	const hash = createHash("sha256");
	hash.update(
		JSON.stringify({
			repositoryFingerprint,
			compilerVersion: revision.compilerVersion,
			compilerInputs,
			git: revision.git ?? null,
			externalInputs: Object.fromEntries(
				Object.entries(revision.externalInputs).sort(([left], [right]) =>
					left.localeCompare(right),
				),
			),
		}),
	);
	return `sha256:${hash.digest("hex")}`;
}

function inferLanguage(path: string): string {
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return extension && extension !== path ? extension : "unknown";
}
