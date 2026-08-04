type Path = string;

type File = {
	path: Path;
	contents: string;
};

type Scope = readonly File[];

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

type ClassifiedScope = readonly ClassifiedFile[];

type SemanticTarget<Role extends string> = {
	classifyRole(file: ClassifiedFile): Role;
	enrichFacts(facts: ProjectFacts): TargetFacts;
};

type TargetFile<Role extends string> = ClassifiedFile & {
	role: Role;
};

type WorkingSet = readonly TargetFile<string>[];

type BuildTarget = {
	validate(analysis: ProjectAnalysis): readonly Diagnostic[];
	emit(analysis: ProjectAnalysis): Promise<readonly File[]>;
};

type InspectTarget = {
	describe(analysis: ProjectAnalysis): unknown;
};

type PreviewTarget = {
	previewComponents(analysis: ProjectAnalysis): readonly PreviewComponent[];
};

type ResolvedTarget =
	| {
			command: "build";
			semantic: SemanticTarget<string>;
			output: BuildTarget;
	  }
	| {
			command: "inspect";
			semantic: SemanticTarget<string>;
			output: InspectTarget;
	  }
	| {
			command: "preview";
			semantic: SemanticTarget<string>;
			output: PreviewTarget;
	  };

type Cache = {
	read<Value>(key: string): Promise<Value | undefined>;
	write<Value>(key: string, value: Value): Promise<void>;
};

type CacheLayers = {
	parses: Cache;
	facts: Cache;
	semantics: Cache;
	outputs: Cache;
};

type SourceFrontend = {
	id: string;
	version: string;
	parse(file: ClassifiedFile): Promise<ParsedFile>;
	extractFacts(
		parsed: ParsedFileResult,
		targetFile: TargetFile<string>,
	): Promise<FileFacts>;
};

type ParsedFileResult = {
	file: AnalyzedFile;
	frontend: SourceFrontend;
	syntax: ParsedFile;
	diagnostics: readonly Diagnostic[];
	uncertainty: readonly Uncertainty[];
};

type ParsedProject = {
	files: readonly AnalyzedFile[];
	results: readonly ParsedFileResult[];
};

type NazareCore = {
	classify(scope: Scope): ClassifiedScope;
};

type SemanticStages = {
	declarations: Declarations;
	references: References;
	resolution: SymbolResolution;
	contracts: ProjectContracts;
	renders: RenderResolution;
	dataFlow: DataFlowResult;
	targetSchema: TargetSchema;
	targetBehavior: TargetBehavior;
	capabilities: Capabilities;
	evidence: Evidence;
};

type ProjectAnalysis = {
	files: readonly AnalyzedFile[];
	targetFiles: readonly TargetFile<string>[];
	facts: ProjectFacts;
	targetFacts: TargetFacts;
	dependencies: DependencyGraph;
	model: SemanticModel;
	targetModel: TargetSemanticModel;
	indexes: ProjectIndexes;
	diagnostics: readonly Diagnostic[];
	uncertainty: readonly Uncertainty[];
};

type EngineSnapshot = {
	scope: ClassifiedScope;
	targetScope: readonly TargetFile<string>[];
	workingSet: WorkingSet;
};

type UpdateValidation = {
	valid: boolean;
	diagnostics: readonly Diagnostic[];
};

type EngineUpdate = {
	applyFileChanges(changes: NormalizedFileChanges): Promise<ChangedFiles>;
	classifyChangedFiles(files: ChangedFiles): ClassifiedChanges;
	diffFingerprints(changes: ClassifiedChanges): ChangedFingerprints;
	invalidateFacts(changes: ChangedFingerprints): InvalidatedFacts;
	invalidateDependents(facts: InvalidatedFacts): InvalidatedDependencies;
	invalidateSemanticPasses(
		dependencies: InvalidatedDependencies,
	): InvalidatedSemanticPasses;
	rebuildTargetScope(): void;
	rebuildWorkingSet(): void;
	validate(): UpdateValidation;
	commit(): Promise<void>;
	rollback(): Promise<void>;
};

type NazareEngine = {
	core: NazareCore;
	input: CachedInput;
	snapshot(): EngineSnapshot;
	normalizeChanges(changes: FileChanges): NormalizedFileChanges;
	beginUpdate(): EngineUpdate;
	selectFrontend(file: ClassifiedFile): SourceFrontend;
	parseCacheKey(
		file: ClassifiedFile,
		frontend: SourceFrontend,
	): string;
	parseFile(
		file: ClassifiedFile,
		frontend: SourceFrontend,
	): Promise<ParsedFileResult>;
	assembleParsedProject(
		results: readonly ParsedFileResult[],
	): ParsedProject;
	factsCacheKey(
		parsed: ParsedFileResult,
		targetFile: TargetFile<string>,
	): string;
	extractFileFacts(
		parsed: ParsedFileResult,
		targetFile: TargetFile<string>,
	): Promise<FileFacts>;
	assembleProjectFacts(facts: readonly FileFacts[]): ProjectFacts;
	enrichFacts(facts: ProjectFacts): TargetFacts;
	resolveDependencies(
		facts: ProjectFacts,
		targetFacts: TargetFacts,
	): DependencyGraph;
	collectDeclarations(facts: ProjectFacts): Declarations;
	collectReferences(facts: ProjectFacts): References;
	resolveSymbols(
		declarations: Declarations,
		references: References,
		dependencies: DependencyGraph,
	): SymbolResolution;
	buildContracts(
		facts: ProjectFacts,
		resolution: SymbolResolution,
	): ProjectContracts;
	resolveRenderTargets(
		facts: ProjectFacts,
		resolution: SymbolResolution,
	): RenderResolution;
	solveDataFlow(input: {
		facts: ProjectFacts;
		resolution: SymbolResolution;
		renders: RenderResolution;
	}): Promise<DataFlowResult>;
	resolveTargetSchema(
		facts: TargetFacts,
		contracts: ProjectContracts,
	): TargetSchema;
	analyzeTargetBehavior(input: {
		facts: TargetFacts;
		resolution: SymbolResolution;
		dataFlow: DataFlowResult;
		schema: TargetSchema;
	}): TargetBehavior;
	classifyCapabilities(input: {
		facts: ProjectFacts;
		targetFacts: TargetFacts;
		behavior: TargetBehavior;
	}): Capabilities;
	collectEvidence(input: {
		resolution: SymbolResolution;
		dataFlow: DataFlowResult;
		behavior: TargetBehavior;
		capabilities: Capabilities;
	}): Evidence;
	assembleSemanticModels(
		input: SemanticStages,
		options: { projectFingerprint: string; cache: Cache },
	): Promise<{
		model: SemanticModel;
		targetModel: TargetSemanticModel;
	}>;
	validateSemanticModels(
		model: SemanticModel,
		targetModel: TargetSemanticModel,
	): SemanticIntegrity;
	createIndexes(
		model: SemanticModel,
		targetModel: TargetSemanticModel,
	): ProjectIndexes;
	collectDiagnostics(...stages: readonly unknown[]): readonly Diagnostic[];
	collectUncertainty(...stages: readonly unknown[]): readonly Uncertainty[];
};

type EngineOptions = {
	incremental: boolean;
	target: SemanticTarget<string>;
};

type NazareInput = {
	command:
		| "init"
		| "registry"
		| "build" // Validate, then emit configured target; check-only disables emission.
		| "inspect"
		| "preview";
	args: string[];
	entryPoint: Path;
};

type ProjectRequest =
	| { command: "build"; options: BuildOptions }
	| { command: "inspect"; options: InspectOptions }
	| { command: "preview"; options: PreviewOptions };

type ExternalProjectInputs = {
	config: ProjectConfig;
	snapshots: readonly ExternalSnapshot[];
	extensions: readonly ExtensionManifest[];
	targetMetadata: TargetMetadata;
};

type NazareEvent =
	| { kind: "result"; output: NazareOutput }
	| {
			kind: "update-failed";
			error: unknown;
			diagnostics: readonly Diagnostic[];
	  };

// Main Loop
async function* nazare(
	input: NazareInput,
): AsyncGenerator<NazareEvent, void> {
	// Resolve entry point without walking its files.
	const entryPoint = await realpath(input.entryPoint);
	const resolvedInput: ResolvedInput = { ...input, entryPoint };

	// Initialize Nazare project at validated entry point and early return.
	if (resolvedInput.command === "init") {
		yield { kind: "result", output: await nazareInit(resolvedInput) };
		return;
	}

	// Run registry outside local project engine and early return.
	if (resolvedInput.command === "registry") {
		yield { kind: "result", output: await nazareRegistry(resolvedInput) };
		return;
	}

	// Parse raw CLI arguments once into a typed project request.
	const request = parseProjectRequest(resolvedInput);

	// Preview file/network utilities bypass project analysis.
	if (
		request.command === "preview" &&
		(request.options.action === "scaffold" ||
			request.options.action === "fixtures")
	) {
		yield {
			kind: "result",
			output: await nazarePreviewUtility(request.options),
		};
		return;
	}

	// Walk entry point and read every discovered path into concrete File scope.
	const paths = await resolveFilePaths(resolvedInput.entryPoint);
	const scope = await readFiles(paths);
	const scopedInput: ScopedInput = { ...resolvedInput, scope };

	// Create target-neutral Core.
	const core: NazareCore = {
		classify(scope) {
			return scope.map((file) => ({
				...file,
				language: classifyLanguage(file),
			}));
		},
	};

	// Attach target-neutral language to every scoped File.
	const classifiedInput: ClassifiedInput = {
		...scopedInput,
		scope: core.classify(scopedInput.scope),
	};

	// Load non-file inputs participating in analysis and cache identity.
	const externalInputs = await loadExternalProjectInputs(
		classifiedInput.entryPoint,
		request,
	);

	// Resolve target before Engine derives target roles and working set.
	const target = resolveTarget(request);

	// Open persistent cache stores once for the Engine session.
	const cachedInput: CachedInput = {
		entryPoint: classifiedInput.entryPoint,
		scope: classifiedInput.scope,
		request,
		externalInputs,
		cache: {
			parses: await openCache("parses"),
			facts: await openCache("facts"),
			semantics: await openCache("semantics"),
			outputs: await openCache("outputs"),
		},
	};

	// Create one-shot or incremental Engine from same classified project input.
	const incremental = request.options.watch;
	const engine = createNazareEngine(core, cachedInput, {
		incremental,
		target: target.semantic,
	});

	const changes = incremental
		? watchFiles(cachedInput.entryPoint)[Symbol.asyncIterator]()
		: undefined;

	while (true) {
		// Recompute cache identity from current Engine state after every update.
		const snapshot = engine.snapshot();
		const projectFingerprint = fingerprintProject({
			snapshot,
			request,
			target: target.semantic,
			externalInputs,
		});

		// Select a frontend and parse every scoped file with per-file caching.
		const parsedResults: ParsedFileResult[] = [];
		for (const file of snapshot.scope) {
			const frontend = engine.selectFrontend(file);
			const cacheKey = engine.parseCacheKey(file, frontend);
			let parsed = await cachedInput.cache.parses.read<ParsedFileResult>(
				cacheKey,
			);

			if (parsed === undefined) {
				parsed = await engine.parseFile(file, frontend);
				await cachedInput.cache.parses.write(cacheKey, parsed);
			}

			parsedResults.push(parsed);
		}
		const parsed = engine.assembleParsedProject(parsedResults);

		// Extract target-aware per-file facts, then assemble project facts.
		const targetFilesByPath = new Map(
			snapshot.targetScope.map((file) => [file.path, file]),
		);
		const fileFacts: FileFacts[] = [];
		for (const parsedFile of parsed.results) {
			const targetFile = targetFilesByPath.get(parsedFile.file.path);
			if (!targetFile) continue;

			const cacheKey = engine.factsCacheKey(parsedFile, targetFile);
			let facts = await cachedInput.cache.facts.read<FileFacts>(cacheKey);

			if (facts === undefined) {
				facts = await engine.extractFileFacts(parsedFile, targetFile);
				await cachedInput.cache.facts.write(cacheKey, facts);
			}

			fileFacts.push(facts);
		}
		const facts = engine.assembleProjectFacts(fileFacts);
		const targetFacts = engine.enrichFacts(facts);
		const dependencies = engine.resolveDependencies(facts, targetFacts);

		// Ordered semantic passes make declarations, resolution, and evidence explicit.
		const declarations = engine.collectDeclarations(facts);
		const references = engine.collectReferences(facts);
		const resolution = engine.resolveSymbols(
			declarations,
			references,
			dependencies,
		);
		const contracts = engine.buildContracts(facts, resolution);
		const renders = engine.resolveRenderTargets(facts, resolution);
		const dataFlow = await engine.solveDataFlow({
			facts,
			resolution,
			renders,
		});
		const targetSchema = engine.resolveTargetSchema(
			targetFacts,
			contracts,
		);
		const targetBehavior = engine.analyzeTargetBehavior({
			facts: targetFacts,
			resolution,
			dataFlow,
			schema: targetSchema,
		});
		const capabilities = engine.classifyCapabilities({
			facts,
			targetFacts,
			behavior: targetBehavior,
		});
		const evidence = engine.collectEvidence({
			resolution,
			dataFlow,
			behavior: targetBehavior,
			capabilities,
		});
		const semanticStages: SemanticStages = {
			declarations,
			references,
			resolution,
			contracts,
			renders,
			dataFlow,
			targetSchema,
			targetBehavior,
			capabilities,
			evidence,
		};
		const { model, targetModel } = await engine.assembleSemanticModels(
			semanticStages,
			{
				projectFingerprint,
				cache: cachedInput.cache.semantics,
			},
		);
		const integrity = engine.validateSemanticModels(model, targetModel);
		const indexes = engine.createIndexes(model, targetModel);

		const analysis: ProjectAnalysis = {
			files: parsed.files,
			targetFiles: snapshot.targetScope,
			facts,
			targetFacts,
			dependencies,
			model,
			targetModel,
			indexes,
			diagnostics: engine.collectDiagnostics(
				parsed,
				facts,
				targetFacts,
				dependencies,
				semanticStages,
				integrity,
			),
			uncertainty: engine.collectUncertainty(
				parsed,
				facts,
				targetFacts,
				dependencies,
				semanticStages,
			),
		};
		let output: NazareOutput;

		// Project shared analysis into command-specific output.
		if (target.command === "build" && request.command === "build") {
			output = await nazareBuild(
				analysis,
				target.output,
				request.options,
			);
		} else if (
			target.command === "inspect" &&
			request.command === "inspect"
		) {
			output = await nazareInspect(
				analysis,
				target.output,
				request.options,
			);
		} else if (
			target.command === "preview" &&
			request.command === "preview"
		) {
			output = await nazarePreview(
				analysis,
				target.output,
				request.options,
			);
		} else {
			throw commandTargetMismatch(request, target);
		}

		yield { kind: "result", output };
		if (!changes) return;

		const change = await changes.next();
		if (change.done) return;

		// Build a candidate snapshot and commit it only when internally consistent.
		const normalizedChanges = engine.normalizeChanges(change.value);
		const update = engine.beginUpdate();

		try {
			const changedFiles = await update.applyFileChanges(normalizedChanges);
			const classifiedChanges = update.classifyChangedFiles(changedFiles);
			const changedFingerprints =
				update.diffFingerprints(classifiedChanges);
			const invalidatedFacts =
				update.invalidateFacts(changedFingerprints);
			const invalidatedDependencies =
				update.invalidateDependents(invalidatedFacts);
			update.invalidateSemanticPasses(invalidatedDependencies);
			update.rebuildTargetScope();
			update.rebuildWorkingSet();

			const validation = update.validate();
			if (!validation.valid) {
				throw invalidEngineUpdate(validation.diagnostics);
			}

			await update.commit();
		} catch (error) {
			await update.rollback();
			yield {
				kind: "update-failed",
				error,
				diagnostics: diagnosticsFromError(error),
			};
		}
	}
}

async function nazareBuild(
	analysis: ProjectAnalysis,
	target: BuildTarget,
	options: BuildOptions,
): Promise<NazareOutput> {
	const diagnostics = [
		...analysis.diagnostics,
		...target.validate(analysis),
	];

	if (options.checkOnly || hasErrors(diagnostics)) {
		return { diagnostics, files: [] };
	}

	const emitted = await target.emit(analysis);
	const collisions = detectOutputCollisions(emitted);
	if (collisions.length > 0) {
		return { diagnostics: [...diagnostics, ...collisions], files: [] };
	}

	const ownership = await loadOutputOwnership(options.outDir);
	const reconciled = await reconcileOutput(emitted, ownership, options);
	const transaction = await beginOutputTransaction(options.outDir);

	try {
		await transaction.stageWrites(reconciled.writes);
		await transaction.stageDeletes(reconciled.deletes);
		const validation = await transaction.validate();
		if (!validation.valid) {
			throw invalidOutputTransaction(validation.diagnostics);
		}

		const files = await transaction.commit();
		return { diagnostics, files };
	} catch (error) {
		await transaction.rollback();
		throw error;
	}
}

async function nazareInspect(
	analysis: ProjectAnalysis,
	target: InspectTarget,
	options: InspectOptions,
): Promise<NazareOutput> {
	const query = executeInspectQuery(analysis.indexes, options.query);

	return {
		version: INSPECT_OUTPUT_VERSION,
		organization: target.describe(analysis),
		query,
		diagnostics: analysis.diagnostics,
		uncertainty: analysis.uncertainty,
	};
}

async function nazarePreview(
	analysis: ProjectAnalysis,
	target: PreviewTarget,
	options: PreviewOptions,
): Promise<NazareOutput> {
	const components = target.previewComponents(analysis);
	const stories = discoverStories(analysis.files, options);
	const fixtures = await loadFixtures(analysis.files, options);
	const renders = await renderPreviewStories({
		components,
		stories,
		fixtures,
	});
	const diagnostics = validatePreviewRenders(renders, analysis.diagnostics);

	if (options.action === "check" || hasErrors(diagnostics)) {
		return { diagnostics, renders };
	}

	return renderPreviewWorkbench({
		components,
		stories,
		fixtures,
		renders,
		diagnostics,
		options,
	});
}

type ResolvedInput = NazareInput & {
	entryPoint: Path;
};

type ScopedInput = ResolvedInput & {
	scope: Scope;
};

type ClassifiedInput = Omit<ScopedInput, "scope"> & {
	scope: ClassifiedScope;
};

type CachedInput = {
	entryPoint: Path;
	scope: ClassifiedScope;
	request: ProjectRequest;
	externalInputs: ExternalProjectInputs;
	cache: CacheLayers;
};

// Target package ownership:
// @nazare/core: stable contracts, diagnostics, spans, IDs.
// @nazare/source: frontends, parsing, per-file facts.
// @nazare/compiler: Engine snapshots, semantic passes, indexes, invalidation.
// @nazare/theme: build target, reconciliation, output transaction.
// @nazare/preview: stories, fixtures, rendering, workbench publication.
// @nazare/registry: registry operations outside Engine.
// @nazare/cli-client: request parsing, event consumption, text/JSON formatting.
//
// Migration slices:
// 1. Wrap current compiler APIs behind NazareEngine without behavior changes.
// 2. Move current frontend/fact caches behind Engine methods.
// 3. Adapt ThemeComputation indexes to ProjectIndexes.
// 4. Move buildTheme emission/reconciliation behind BuildTarget.
// 5. Move preview compilation onto ProjectAnalysis.
// 6. Replace preview-only watcher with shared EngineUpdate transaction.
// 7. Remove compatibility APIs after CLI consumers migrate.
//
// OPEN: output cache stores pure projection plans only; it never skips required
// filesystem writes, server publication, or other command side effects.

