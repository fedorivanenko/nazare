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

export type SemanticIncrementalReport = {
	changedPaths: readonly string[];
	recompiledPaths: readonly string[];
	reusedPaths: readonly string[];
	removedPaths: readonly string[];
	/** Repository passes currently rerun after any semantic or revision change. */
	fullAssembly: boolean;
	/** Index currently rebuilds after each committed assembly. */
	fullIndex: boolean;
};

export type SemanticCompilation = {
	output: QueryableSemanticOutput;
	query: SemanticQueryIndex;
	inspect: SemanticInspect;
	report: {
		sources: readonly SemanticCompilationSourceReport[];
		incremental: SemanticIncrementalReport;
	};
};

export type SemanticCompilerSessionChange =
	| { kind: "upsert"; source: SemanticCompilerSource }
	| { kind: "remove"; path: string };

export type SemanticCompilerSessionUpdate = {
	changes?: readonly SemanticCompilerSessionChange[];
	revision?: SemanticCompilerRevisionInput;
	repositoryScope?: { status: "complete" | "partial" };
	/** Supplying limits replaces prior limits; omitted fields use defaults. */
	limits?: Partial<FrontendLimits>;
};

export type SemanticCompilerSessionOptions = {
	maxChangesPerUpdate?: number;
	maxSources?: number;
	maxSourceBytes?: number;
	maxTotalSourceBytes?: number;
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

const DEFAULT_SESSION_OPTIONS = {
	maxChangesPerUpdate: 1_000,
	maxSources: 50_000,
	maxSourceBytes: 16 * 1024 * 1024,
	maxTotalSourceBytes: 256 * 1024 * 1024,
} as const;

type SourceCompilation = {
	contribution: SemanticContribution;
	report: SemanticCompilationSourceReport;
};

type SourceCacheEntry = {
	fingerprint: string;
	compilation: SourceCompilation;
};

type CompilationState = {
	compilation: SemanticCompilation;
	cache: Map<string, SourceCacheEntry>;
	sources: readonly SemanticCompilerSource[];
	limits: FrontendLimits;
};

/** Deterministic orchestration from in-memory repository sources to Inspect. */
export class SemanticCompiler {
	constructor(readonly options: SemanticCompilerOptions) {}

	compile(input: SemanticCompilerInput): SemanticCompilation {
		return compileState(this.options, input).compilation;
	}

	createSession(
		input: SemanticCompilerInput,
		options: SemanticCompilerSessionOptions = {},
	): SemanticCompilerSession {
		return new SemanticCompilerSession(this.options, input, options);
	}
}

/** Current-repository cache. No historical source revisions are retained. */
export class SemanticCompilerSession {
	readonly #compilerOptions: SemanticCompilerOptions;
	readonly #options: Required<SemanticCompilerSessionOptions>;
	#sources: Map<string, SemanticCompilerSource>;
	#revision: SemanticCompilerRevisionInput;
	#repositoryScope: SemanticCompilerInput["repositoryScope"];
	#limits: FrontendLimits;
	#cache: Map<string, SourceCacheEntry>;
	#compilation: SemanticCompilation;

	constructor(
		compilerOptions: SemanticCompilerOptions,
		input: SemanticCompilerInput,
		options: SemanticCompilerSessionOptions = {},
	) {
		this.#compilerOptions = compilerOptions;
		this.#options = sessionOptions(options);
		validateCompilationInput(input);
		const normalizedSources = normalizeSources(input.sources);
		validateSessionSourceLimits(normalizedSources, this.#options);
		const initial = compileState(compilerOptions, input);
		this.#sources = new Map(
			initial.sources.map((source) => [source.path, source]),
		);
		this.#revision = structuredClone(input.revision);
		this.#repositoryScope = structuredClone(input.repositoryScope);
		this.#limits = initial.limits;
		this.#cache = initial.cache;
		this.#compilation = initial.compilation;
	}

	snapshot(): SemanticCompilation {
		return this.#compilation;
	}

	apply(update: SemanticCompilerSessionUpdate): SemanticCompilation {
		validateSessionUpdate(update, this.#options);
		const candidateSources = new Map(this.#sources);
		const changedPaths = new Set<string>();
		const removedPaths = new Set<string>();
		const seenPaths = new Set<string>();
		for (const change of update.changes ?? []) {
			if (change.kind === "upsert") {
				const source = normalizeSources([change.source])[0];
				if (!source)
					throw new SemanticCompilerInputError("Missing upsert source");
				if (seenPaths.has(source.path)) {
					throw new SemanticCompilerInputError(
						`Duplicate session change path: ${source.path}`,
					);
				}
				seenPaths.add(source.path);
				const current = candidateSources.get(source.path);
				candidateSources.set(source.path, source);
				if (!current || !sameSource(current, source))
					changedPaths.add(source.path);
				continue;
			}
			if (change.kind === "remove") {
				const path = normalizePath(change.path);
				if (seenPaths.has(path)) {
					throw new SemanticCompilerInputError(
						`Duplicate session change path: ${path}`,
					);
				}
				seenPaths.add(path);
				if (candidateSources.delete(path)) {
					changedPaths.add(path);
					removedPaths.add(path);
				}
			}
		}
		validateSessionSourceLimits([...candidateSources.values()], this.#options);
		const revision = update.revision ?? this.#revision;
		const repositoryScope = update.repositoryScope ?? this.#repositoryScope;
		const limits = update.limits ? compilerLimits(update.limits) : this.#limits;
		const metadataChanged =
			canonicalJson(revision) !== canonicalJson(this.#revision) ||
			canonicalJson(repositoryScope) !== canonicalJson(this.#repositoryScope) ||
			canonicalJson(limits) !== canonicalJson(this.#limits);
		if (changedPaths.size === 0 && !metadataChanged) {
			this.#compilation = withIncrementalReport(this.#compilation, {
				changedPaths: [],
				recompiledPaths: [],
				reusedPaths: [...candidateSources.keys()].sort(),
				removedPaths: [],
				fullAssembly: false,
				fullIndex: false,
			});
			return this.#compilation;
		}

		const candidateInput: SemanticCompilerInput = {
			sources: [...candidateSources.values()],
			revision,
			repositoryScope,
			limits,
		};
		// Build candidate state first. Any parser/projection/assembly failure leaves
		// current session state and cache untouched.
		const candidate = compileState(
			this.#compilerOptions,
			candidateInput,
			this.#cache,
			[...changedPaths].sort(),
			[...removedPaths].sort(),
		);
		this.#sources = new Map(
			candidate.sources.map((source) => [source.path, source]),
		);
		this.#revision = structuredClone(revision);
		this.#repositoryScope = structuredClone(repositoryScope);
		this.#limits = candidate.limits;
		this.#cache = candidate.cache;
		this.#compilation = candidate.compilation;
		return this.#compilation;
	}
}

function compileState(
	options: SemanticCompilerOptions,
	input: SemanticCompilerInput,
	previousCache?: ReadonlyMap<string, SourceCacheEntry>,
	changedPaths?: readonly string[],
	removedPaths: readonly string[] = [],
): CompilationState {
	validateCompilationInput(input);
	const sources = normalizeSources(input.sources);
	const limits = compilerLimits(input.limits);
	const signature = compilerSignature(options);
	const cache = new Map<string, SourceCacheEntry>();
	const sourceCompilations: SourceCompilation[] = [];
	const recompiledPaths: string[] = [];
	const reusedPaths: string[] = [];
	for (const source of sources) {
		const fingerprint = sourceCompilationFingerprint(source, limits, signature);
		const cached = previousCache?.get(source.path);
		if (cached?.fingerprint === fingerprint) {
			cache.set(source.path, cached);
			sourceCompilations.push(cached.compilation);
			reusedPaths.push(source.path);
			continue;
		}
		const compilation = compileSource(options, source, limits);
		const entry = { fingerprint, compilation };
		cache.set(source.path, entry);
		sourceCompilations.push(compilation);
		recompiledPaths.push(source.path);
	}
	const repositoryFingerprint = fingerprintSources(sources);
	const revision: SemanticRevision = {
		...input.revision,
		repositoryFingerprint,
		id: revisionId(repositoryFingerprint, input.revision, {
			compiler: signature,
			limits,
			repositoryScope: input.repositoryScope,
		}),
	};
	const snapshot = options.assembler.assemble({
		revision,
		contributions: sourceCompilations.map(({ contribution }) => contribution),
		repositoryScope: input.repositoryScope,
	});
	const output = createQueryableSemanticOutput(snapshot);
	const query = openQueryableSemanticOutput(output);
	const sourceByPath = new Map(
		sources.map((source) => [source.path, source.source]),
	);
	const compilation: SemanticCompilation = {
		output,
		query,
		inspect: new SemanticInspect(query, {
			source: (path) => sourceByPath.get(path),
		}),
		report: {
			sources: sourceCompilations.map(({ report }) => report),
			incremental: {
				changedPaths: changedPaths ?? sources.map(({ path }) => path),
				recompiledPaths,
				reusedPaths,
				removedPaths,
				fullAssembly: true,
				fullIndex: true,
			},
		},
	};
	return { compilation, cache, sources, limits };
}

function compileSource(
	options: SemanticCompilerOptions,
	source: SemanticCompilerSource,
	limits: FrontendLimits,
): SourceCompilation {
	const provider = options.parserProviders.find((candidate) =>
		candidate.accepts(source.path, source.language),
	);
	if (!provider) {
		const language = source.language ?? inferLanguage(source.path);
		return {
			contribution: options.fallbackProjector.project({
				...source,
				language,
				parserDiagnostics: [],
			}),
			report: {
				path: source.path,
				language,
				semanticSupport: "source-only",
			},
		};
	}
	const parsed = provider.parse(source);
	if (!parsed.ok) {
		const language = source.language ?? provider.languages[0] ?? "unknown";
		return {
			contribution: options.fallbackProjector.project({
				...source,
				language,
				parserDiagnostics: parsed.diagnostics,
			}),
			report: {
				path: source.path,
				language,
				parser: provider.id,
				semanticSupport: "source-only",
			},
		};
	}
	const pipelines = options.pipelines.filter((pipeline) =>
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
		return {
			contribution: pipeline.project(parsed.document, limits),
			report: {
				path: source.path,
				language: parsed.document.language,
				parser: provider.id,
				pipeline: pipeline.id,
				semanticSupport: "projected",
			},
		};
	}
	return {
		contribution: options.fallbackProjector.project({
			...source,
			language: parsed.document.language,
			parserDiagnostics: parsed.document.diagnostics,
		}),
		report: {
			path: source.path,
			language: parsed.document.language,
			parser: provider.id,
			semanticSupport: "source-only",
		},
	};
}

function withIncrementalReport(
	compilation: SemanticCompilation,
	incremental: SemanticIncrementalReport,
): SemanticCompilation {
	return {
		...compilation,
		report: { ...compilation.report, incremental },
	};
}

function validateCompilationInput(input: SemanticCompilerInput): void {
	if (!input || typeof input !== "object" || !Array.isArray(input.sources)) {
		throw new SemanticCompilerInputError(
			"Compiler input requires sources array",
		);
	}
	validateRevision(input.revision);
	validateRepositoryScope(input.repositoryScope);
}

function validateRevision(revision: SemanticCompilerRevisionInput): void {
	if (
		!revision ||
		typeof revision.compilerVersion !== "string" ||
		!revision.compilerVersion ||
		!revision.externalInputs ||
		typeof revision.externalInputs !== "object" ||
		Array.isArray(revision.externalInputs) ||
		Object.values(revision.externalInputs).some(
			(value) => typeof value !== "string",
		)
	) {
		throw new SemanticCompilerInputError(
			"Compiler revision requires compilerVersion and string externalInputs",
		);
	}
}

function validateRepositoryScope(
	scope: SemanticCompilerInput["repositoryScope"],
): void {
	if (scope?.status !== "complete" && scope?.status !== "partial") {
		throw new SemanticCompilerInputError(
			"repositoryScope.status must be complete or partial",
		);
	}
}

function validateSessionUpdate(
	update: SemanticCompilerSessionUpdate,
	options: Required<SemanticCompilerSessionOptions>,
): void {
	if (!update || typeof update !== "object") {
		throw new SemanticCompilerInputError("Session update must be an object");
	}
	if (update.changes !== undefined && !Array.isArray(update.changes)) {
		throw new SemanticCompilerInputError("Session changes must be an array");
	}
	if ((update.changes?.length ?? 0) > options.maxChangesPerUpdate) {
		throw new SemanticCompilerInputError(
			`Session change limit exceeded: ${update.changes?.length ?? 0} > ${options.maxChangesPerUpdate}`,
		);
	}
	for (const change of update.changes ?? []) {
		if (!change || (change.kind !== "upsert" && change.kind !== "remove")) {
			throw new SemanticCompilerInputError(
				"Session change kind must be upsert or remove",
			);
		}
	}
	if (update.revision) validateRevision(update.revision);
	if (update.repositoryScope) validateRepositoryScope(update.repositoryScope);
	if (update.limits) compilerLimits(update.limits);
}

function sessionOptions(
	input: SemanticCompilerSessionOptions,
): Required<SemanticCompilerSessionOptions> {
	const options = { ...DEFAULT_SESSION_OPTIONS, ...input };
	for (const [name, value] of Object.entries(options)) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new SemanticCompilerInputError(
				`${name} must be a positive safe integer`,
			);
		}
	}
	return options;
}

function validateSessionSourceLimits(
	sources: readonly SemanticCompilerSource[],
	options: Required<SemanticCompilerSessionOptions>,
): void {
	if (sources.length > options.maxSources) {
		throw new SemanticCompilerInputError(
			`Session source limit exceeded: ${sources.length} > ${options.maxSources}`,
		);
	}
	let totalBytes = 0;
	for (const source of sources) {
		const bytes = Buffer.byteLength(source.source);
		if (bytes > options.maxSourceBytes) {
			throw new SemanticCompilerInputError(
				`Session source byte limit exceeded for ${source.path}: ${bytes} > ${options.maxSourceBytes}`,
			);
		}
		totalBytes += bytes;
	}
	if (totalBytes > options.maxTotalSourceBytes) {
		throw new SemanticCompilerInputError(
			`Session total source byte limit exceeded: ${totalBytes} > ${options.maxTotalSourceBytes}`,
		);
	}
}

function normalizeSources(
	inputs: readonly SemanticCompilerSource[],
): SemanticCompilerSource[] {
	const paths = new Set<string>();
	const sources = inputs.map((input) => {
		if (
			typeof input?.path !== "string" ||
			typeof input?.source !== "string" ||
			(input?.language !== undefined &&
				(typeof input.language !== "string" || !input.language))
		) {
			throw new SemanticCompilerInputError(
				"Compiler sources require string path, source, and optional language fields",
			);
		}
		const path = normalizePath(input.path);
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

function normalizePath(input: string): string {
	if (typeof input !== "string") {
		throw new SemanticCompilerInputError("Source path must be a string");
	}
	const path = input.replaceAll("\\", "/").replace(/^\.\//u, "");
	if (
		!path ||
		path.startsWith("/") ||
		path.split("/").some((part) => !part || part === "." || part === "..")
	) {
		throw new SemanticCompilerInputError(
			`Source path must be canonical and repository-relative: ${input}`,
		);
	}
	return path;
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

function sameSource(
	left: SemanticCompilerSource,
	right: SemanticCompilerSource,
): boolean {
	return (
		left.path === right.path &&
		left.source === right.source &&
		left.language === right.language
	);
}

function sourceCompilationFingerprint(
	source: SemanticCompilerSource,
	limits: FrontendLimits,
	signature: unknown,
): string {
	return hashJson({ source, limits, signature });
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
	return hashJson({
		repositoryFingerprint,
		compilerVersion: revision.compilerVersion,
		compilerInputs,
		git: revision.git ?? null,
		externalInputs: Object.fromEntries(
			Object.entries(revision.externalInputs).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
	});
}

function hashJson(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, canonicalValue(child)]),
	);
}

function inferLanguage(path: string): string {
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return extension && extension !== path ? extension : "unknown";
}
