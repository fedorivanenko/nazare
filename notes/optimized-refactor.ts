// Optimized Nazare architecture blueprint.
//
// Invariants:
// - File contents are read lazily; commands begin from roots, not every file.
// - Parsing and source facts are target-neutral and cached per file.
// - Computations declare dependencies by reading other products.
// - A changed input invalidates only its downstream computation nodes.
// - Commands compute only requested products and lazy indexes.
// - Failed updates never replace the last internally consistent revision.
// - Filesystem writes and server publication are side effects, never cached.

type Path = string;

type ProjectFileId = {
	workspace: string;
	package: string;
	path: Path;
};

type File = {
	id: ProjectFileId;
	path: Path;
	contents: string;
};

type FileLanguage =
	| "nazare-liquid"
	| "liquid"
	| "json"
	| "css"
	| "javascript"
	| "binary"
	| "unknown";

type ClassifiedFile = File & {
	language: FileLanguage;
};

type TargetFile<Role extends string> = ClassifiedFile & {
	role: Role;
};

type NazareInput = {
	command: "init" | "registry" | "build" | "inspect" | "preview";
	args: string[];
	entryPoint: Path;
};

type ProjectRequest =
	| { command: "build"; options: BuildOptions }
	| { command: "inspect"; options: InspectOptions }
	| { command: "preview"; options: PreviewOptions };

type NazareOutput = BuildOutput | InspectOutput | PreviewOutput | DirectOutput;

type NazareEvent =
	| { kind: "result"; revision: number; output: NazareOutput }
	| {
			kind: "update-failed";
			revision: number;
			error: unknown;
			diagnostics: readonly Diagnostic[];
	  };

// Product keys remain structured until the graph serializes them. Namespace,
// computation version, arguments, and direct dependency hashes form cache IDs.
type Product<Key, Result> = {
	namespace: string;
	id: string;
	version: number;
	key: Key;
};

type ComputationContext = {
	get<Key, Result>(product: Product<Key, Result>): Promise<Result>;
	input<Result>(key: string): Promise<Result>;
	dependOn(identity: string): void;
};

type Computation<Key, Result> = {
	namespace: string;
	id: string;
	version: number;
	serializeKey(key: Key): string;
	compute(context: ComputationContext, key: Key): Promise<Result>;
	diagnostics?(result: Result): readonly Diagnostic[];
	uncertainty?(result: Result): readonly Uncertainty[];
};

type ComputationGraph = {
	register<Key, Result>(computation: Computation<Key, Result>): void;
	get<Key, Result>(product: Product<Key, Result>): Promise<Result>;
	beginUpdate(): GraphUpdate;
};

type GraphUpdate = {
	setInput(key: string, value: unknown): void;
	removeInput(key: string): void;
	validate(): readonly Diagnostic[];
	commit(): Promise<number>;
	rollback(): Promise<void>;
};

type InputProvider<Key, Value> = {
	id: string;
	version: number;
	read(key: Key): Promise<Value>;
	watch?(): AsyncIterable<InputChange<Key>>;
};

// Host owns filesystem/network I/O. Engine and computations consume versioned
// input nodes, so tests can supply in-memory providers.
type ProjectHost = {
	entryPoint: Path;
	files: InputProvider<ProjectFileId, File>;
	externalInputs: InputProvider<ProjectRequest, ExternalProjectInputs>;
	discoverFileIds(): Promise<readonly ProjectFileId[]>;
	watch(): AsyncIterable<FileChanges>;
};

type ProjectSnapshot = {
	revision: number;
	fileIds: readonly ProjectFileId[];
	externalInputs: ExternalProjectInputs;
};

type AnalysisPlan = {
	roots: readonly ProjectFileId[];
};

type SemanticSccKey = {
	plan: AnalysisPlan;
	members: readonly ProjectFileId[];
	pass: string;
};

// Source frontend boundary. Facts remain independent of Shopify/React/etc.
type SourceFrontend = {
	id: string;
	version: number;
	accepts(file: ClassifiedFile): boolean;
	parse(file: ClassifiedFile): Promise<ParsedFile>;
	extractFacts(parsed: ParsedFile): Promise<SourceFacts>;
};

type SemanticTarget<Role extends string> = {
	id: string;
	version: number;
	classifyRole(file: ClassifiedFile): Role;
	enrichFileFacts(
		facts: SourceFacts,
		file: TargetFile<Role>,
	): Promise<TargetFileFacts>;
	registerComputations(graph: ComputationGraph): void;
};

type ComputationRegistrar = {
	id: string;
	version: number;
	registerComputations(graph: ComputationGraph): void;
};

type CapabilityExecution<Options> = {
	session: ProjectSession;
	plan: AnalysisPlan;
	options: Options;
	execution: {
		revision: number;
		priority: ComputationPriority;
		signal: AbortSignal;
	};
};

// Capability-owned execution keeps target-specific model types inside the
// capability; the central registry never needs a BuildModel union.
type BuildCapability = ComputationRegistrar & {
	run(input: CapabilityExecution<BuildOptions>): Promise<BuildOutput>;
};

type InspectCapability = ComputationRegistrar & {
	run(input: CapabilityExecution<InspectOptions>): Promise<InspectOutput>;
};

type PreviewCapability = ComputationRegistrar & {
	run(input: CapabilityExecution<PreviewOptions>): Promise<PreviewOutput>;
};

type BuildEmitter<Model> = {
	validate(model: Model): readonly Diagnostic[];
	emit(model: Model): Promise<readonly EmittedFile[]>;
};

type InspectProjector<Result> = {
	project(result: Result, options: InspectOptions): InspectOutput;
};

type PreviewCompiler<Model> = {
	compile(model: Model): Promise<readonly PreviewComponent[]>;
};

type Capability<Value> = {
	id: string;
};

type CapabilityRegistry = {
	require<Value>(capability: Capability<Value>): Value;
	has<Value>(capability: Capability<Value>): boolean;
	registerComputations(graph: ComputationGraph): void;
};

const buildCapability: Capability<BuildCapability> = capability("build");
const inspectCapability: Capability<InspectCapability> = capability("inspect");
const previewCapability: Capability<PreviewCapability> = capability("preview");

// Source semantics and output platform are independently composable.
// Example: Shopify Liquid source → portable application model → Hydrogen output.
type NazarePipeline = {
	id: string;
	version: number;
	source: SemanticTarget<string>;
	transforms: readonly ComputationRegistrar[];
	output: CapabilityRegistry;
};

type PortableApplicationModel = {
	components: readonly PortableComponent[];
	renderTrees: readonly PortableRenderTree[];
	routes: readonly PortableRoute[];
	contracts: readonly PortableContract[];
	dataRequirements: readonly PortableDataRequirement[];
	assets: readonly PortableAsset[];
	uncertainty: readonly Uncertainty[];
};

// Architectural expansion test: the source and output platforms differ.
const liquidToHydrogenPipeline: NazarePipeline = {
	id: "shopify-liquid-to-hydrogen",
	version: 1,
	source: shopifyLiquidSemanticTarget(),
	transforms: [portableApplicationTransform(), hydrogenLoweringTransform()],
	output: capabilities([hydrogenBuildCapability()]),
};

type ComputationPriority = "interactive" | "background";

type ProjectSession = {
	host: ProjectHost;
	graph: ComputationGraph;
	pipeline: NazarePipeline;
	snapshot(): ProjectSnapshot;
	get<Key, Result>(
		product: Product<Key, Result>,
		options: {
			revision: number;
			priority: ComputationPriority;
			signal: AbortSignal;
		},
	): Promise<Result>;
	apply(changes: FileChanges): Promise<SessionUpdate>;
};

type SessionUpdate =
	| { committed: true; revision: number }
	| {
			committed: false;
			revision: number;
			diagnostics: readonly Diagnostic[];
			error?: unknown;
	  };

// Product constructors keep cache identity local to each computation. Product
// versions, direct dependency identities, frontend versions, target versions,
// and relevant configuration contribute to graph cache keys.
const products = {
	file(fileId: ProjectFileId): Product<ProjectFileId, File> {
		return product("nazare.input", "file", 1, fileId);
	},

	classifiedFile(
		fileId: ProjectFileId,
	): Product<ProjectFileId, ClassifiedFile> {
		return product("nazare.source", "classified-file", 1, fileId);
	},

	parsedFile(fileId: ProjectFileId): Product<ProjectFileId, ParsedFile> {
		return product("nazare.source", "parsed-file", 1, fileId);
	},

	sourceFacts(fileId: ProjectFileId): Product<ProjectFileId, SourceFacts> {
		return product("nazare.source", "source-facts", 1, fileId);
	},

	targetFacts(fileId: ProjectFileId): Product<ProjectFileId, TargetFileFacts> {
		return product("nazare.target", "target-facts", 1, fileId);
	},

	dependencyEdges(
		fileId: ProjectFileId,
	): Product<ProjectFileId, readonly DependencyEdge[]> {
		return product("nazare.compiler", "dependency-edges", 1, fileId);
	},

	declarations(fileId: ProjectFileId): Product<ProjectFileId, Declarations> {
		return product("nazare.compiler", "declarations", 1, fileId);
	},

	references(fileId: ProjectFileId): Product<ProjectFileId, References> {
		return product("nazare.compiler", "references", 1, fileId);
	},

	semanticScc(key: SemanticSccKey): Product<SemanticSccKey, SemanticSccResult> {
		return product("nazare.compiler", "semantic-scc", 1, key);
	},

	reachableClosure(plan: AnalysisPlan): Product<AnalysisPlan, ReachableClosure> {
		return product("nazare.compiler", "reachable-closure", 1, plan);
	},

	projectModel(plan: AnalysisPlan): Product<AnalysisPlan, ProjectModel> {
		return product("nazare.compiler", "project-model", 1, plan);
	},

};

function registerCoreComputations(
	graph: ComputationGraph,
	host: ProjectHost,
	frontends: readonly SourceFrontend[],
	target: SemanticTarget<string>,
): void {
	graph.register({
		namespace: "nazare.input",
		id: "file",
		version: 1,
		serializeKey: serializeProjectFileId,
		async compute(context, fileId) {
			const revision = await context.input<string>(
				`file-revision:${serializeProjectFileId(fileId)}`,
			);
			context.dependOn(`file-provider:${host.files.id}@${host.files.version}`);
			context.dependOn(revision);
			return host.files.read(fileId);
		},
	});

	graph.register({
		namespace: "nazare.source",
		id: "classified-file",
		version: 1,
		serializeKey: serializeProjectFileId,
		async compute(context, fileId) {
			const file = await context.get(products.file(fileId));
			return { ...file, language: classifyLanguage(file) };
		},
	});

	graph.register({
		namespace: "nazare.source",
		id: "parsed-file",
		version: 1,
		serializeKey: serializeProjectFileId,
		async compute(context, fileId) {
			const file = await context.get(products.classifiedFile(fileId));
			const frontend = selectFrontend(frontends, file);
			context.dependOn(`frontend:${frontend.id}@${frontend.version}`);
			return frontend.parse(file);
		},
	});

	graph.register({
		namespace: "nazare.source",
		id: "source-facts",
		version: 1,
		serializeKey: serializeProjectFileId,
		async compute(context, fileId) {
			const file = await context.get(products.classifiedFile(fileId));
			const frontend = selectFrontend(frontends, file);
			const parsed = await context.get(products.parsedFile(fileId));
			context.dependOn(`frontend:${frontend.id}@${frontend.version}`);
			return frontend.extractFacts(parsed);
		},
	});

	graph.register({
		namespace: "nazare.target",
		id: "target-facts",
		version: 1,
		serializeKey: serializeProjectFileId,
		async compute(context, fileId) {
			const file = await context.get(products.classifiedFile(fileId));
			const facts = await context.get(products.sourceFacts(fileId));
			const targetFile = {
				...file,
				role: target.classifyRole(file),
			};
			context.dependOn(`target:${target.id}@${target.version}`);
			return target.enrichFileFacts(facts, targetFile);
		},
	});

	graph.register({
		namespace: "nazare.compiler",
		id: "dependency-edges",
		version: 1,
		serializeKey: serializeProjectFileId,
		async compute(context, fileId) {
			const source = await context.get(products.sourceFacts(fileId));
			const targetFacts = await context.get(products.targetFacts(fileId));
			return resolveFileDependencyEdges(source, targetFacts);
		},
	});

	graph.register({
		namespace: "nazare.compiler",
		id: "reachable-closure",
		version: 1,
		serializeKey: fingerprintPlan,
		async compute(context, plan) {
			return resolveClosureByDemand(plan.roots, async (fileId) =>
				context.get(products.dependencyEdges(fileId)),
			);
		},
	});

	// Declarations, references, resolution, contracts, render resolution,
	// SCC-local data flow, target schema/behavior, capabilities, and evidence
	// are separate computations. Each reads only direct prerequisite products.
	// Adding a pass registers one computation; execution, caching, diagnostics,
	// uncertainty, and invalidation do not require editing a central Engine API.
	for (const computation of coreSemanticComputations) {
		graph.register(computation);
	}
	target.registerComputations(graph);
}

async function createProjectSession(input: {
	host: ProjectHost;
	request: ProjectRequest;
	pipeline: NazarePipeline;
	frontends: readonly SourceFrontend[];
	cache: Cache;
}): Promise<ProjectSession> {
	const graph = createComputationGraph(input.cache);
	registerCoreComputations(
		graph,
		input.host,
		input.frontends,
		input.pipeline.source,
	);
	for (const transform of input.pipeline.transforms) {
		transform.registerComputations(graph);
	}
	input.pipeline.output.registerComputations(graph);

	const fileIds = await input.host.discoverFileIds();
	const externalInputs = await input.host.externalInputs.read(input.request);
	const update = graph.beginUpdate();

	for (const fileId of fileIds) {
		// Revision identity changes when provider content changes; contents stay lazy.
		update.setInput(
			`file-revision:${serializeProjectFileId(fileId)}`,
			await inputRevision(input.host.files, fileId),
		);
	}
	update.setInput("external-inputs", externalInputs);
	update.setInput("request", input.request);
	update.setInput("pipeline", {
		id: input.pipeline.id,
		version: input.pipeline.version,
		source: {
			id: input.pipeline.source.id,
			version: input.pipeline.source.version,
		},
		transforms: input.pipeline.transforms.map(({ id, version }) => ({
			id,
			version,
		})),
	});

	const diagnostics = update.validate();
	if (hasErrors(diagnostics)) {
		await update.rollback();
		throw invalidProjectInputs(diagnostics);
	}
	await update.commit();

	return projectSession({
		host: input.host,
		graph,
		pipeline: input.pipeline,
		fileIds,
		externalInputs,
	});
}

async function projectRequest(
	session: ProjectSession,
	request: ProjectRequest,
	pipeline: NazarePipeline,
	execution: {
		revision: number;
		priority: ComputationPriority;
		signal: AbortSignal;
	},
): Promise<NazareOutput> {
	const plan = planAnalysis(session.snapshot(), request, pipeline.source);

	if (request.command === "build") {
		const builder = pipeline.output.require(buildCapability);
		return builder.run({ session, plan, options: request.options, execution });
	}

	if (request.command === "inspect") {
		const inspector = pipeline.output.require(inspectCapability);
		return inspector.run({
			session,
			plan,
			options: request.options,
			execution,
		});
	}

	if (request.command === "preview") {
		const previewer = pipeline.output.require(previewCapability);
		return previewer.run({
			session,
			plan,
			options: request.options,
			execution,
		});
	}

	return assertNever(request);
}

async function* runProjectRequest(input: {
	session: ProjectSession;
	request: ProjectRequest;
	pipeline: NazarePipeline;
}): AsyncGenerator<NazareEvent, void> {
	const watcher = input.request.options.watch
		? input.session.host.watch()[Symbol.asyncIterator]()
		: undefined;
	let pendingChange = watcher?.next();

	while (true) {
		const revision = input.session.snapshot().revision;
		const controller = new AbortController();
		const computation = projectRequest(
			input.session,
			input.request,
			input.pipeline,
			{
				revision,
				priority: "interactive",
				signal: controller.signal,
			},
		).then((output) => ({ kind: "output" as const, output }));
		const next = pendingChange
			? await Promise.race([
					computation,
					pendingChange.then((change) => ({
						kind: "change" as const,
						change,
					})),
				])
			: await computation;

		if (next.kind === "change") {
			controller.abort();
			if (next.change.done) return;
			pendingChange = watcher?.next();

			const update = await input.session.apply(next.change.value);
			if (!update.committed) {
				yield {
					kind: "update-failed",
					revision: update.revision,
					error: update.error,
					diagnostics: update.diagnostics,
				};
			}
			continue;
		}

		// Never publish a result computed for an obsolete revision.
		if (input.session.snapshot().revision === revision) {
			yield { kind: "result", revision, output: next.output };
		}
		if (!watcher) return;

		const change = await pendingChange;
		if (!change || change.done) return;
		pendingChange = watcher.next();
		const update = await input.session.apply(change.value);
		if (!update.committed) {
			yield {
				kind: "update-failed",
				revision: update.revision,
				error: update.error,
				diagnostics: update.diagnostics,
			};
		}
	}
}

async function* nazare(
	input: NazareInput,
): AsyncGenerator<NazareEvent, void> {
	const entryPoint = resolveEntryPoint(input.entryPoint);

	if (input.command === "init") {
		yield directEvent(await nazareInit({ ...input, entryPoint }));
		return;
	}

	if (input.command === "registry") {
		yield directEvent(await nazareRegistry({ ...input, entryPoint }));
		return;
	}

	const request = parseProjectRequest(input);
	if (isDirectPreviewUtility(request)) {
		yield directEvent(await nazarePreviewUtility(request.options));
		return;
	}

	const host = createProjectHost(entryPoint);
	const pipeline = resolvePipeline(request);
	const session = await createProjectSession({
		host,
		request,
		pipeline,
		frontends: sourceFrontends(),
		cache: await openComputationCache(),
	});

	yield* runProjectRequest({ session, request, pipeline });
}

async function nazareBuild<Model>(
	model: Model,
	target: BuildEmitter<Model>,
	options: BuildOptions,
): Promise<BuildOutput> {
	const diagnostics = target.validate(model);
	if (options.checkOnly || hasErrors(diagnostics)) {
		return { diagnostics, files: [] };
	}

	const emitted = await target.emit(model);
	const plan = await planOwnedOutputTransaction(emitted, options);
	const transaction = await beginOutputTransaction(plan);

	try {
		const files = await transaction.commit();
		return { diagnostics, files };
	} catch (error) {
		await transaction.rollback();
		throw error;
	}
}

async function nazareInspect<Result>(
	result: Result,
	target: InspectProjector<Result>,
	options: InspectOptions,
): Promise<InspectOutput> {
	return target.project(result, options);
}

async function nazarePreview<Model>(
	model: Model,
	target: PreviewCompiler<Model>,
	options: PreviewOptions,
): Promise<PreviewOutput> {
	const components = await target.compile(model);
	const renders = await renderPreviewStories(components, model, options);
	return publishPreview({ model, components, renders, options });
}

// Package ownership:
// @nazare/core       Product/diagnostic/span/stable-ID contracts.
// @nazare/source     Frontends, parsing, target-neutral source facts.
// @nazare/compiler   Computation graph, sessions, semantic products, indexes.
// @nazare/target-shopify Shopify source semantics and Shopify output capabilities.
// @nazare/target-hydrogen Hydrogen lowering and output capabilities (future).
// @nazare/preview        Preview products, rendering, workbench publication.
// @nazare/registry   Registry operations outside project sessions.
// @nazare/cli-client Request parsing and NazareEvent formatting.

// Migration order:
// 1. Put Product facade over ThemeProgram/ThemeComputation without behavior change.
// 2. Adapt existing per-file parse/fact caches into computation nodes.
// 3. Expose current lazy ThemeComputation indexes as products.
// 4. Move buildTheme behind BuildCapability and preserve reconciliation invariants.
// 5. Move preview workspace compilation behind PreviewModel.
// 6. Route preview watcher and graph-server updates through ProjectSession.apply.
// 7. Remove old direct compiler APIs after all consumers migrate.
