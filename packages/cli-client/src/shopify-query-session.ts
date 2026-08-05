import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
	createDefaultSourceFrontendRegistry,
	createOwnedOutputPlan,
	createProjectMetadataInputProvider,
	createProjectSession,
	createSourceProductRegistrar,
	defineInputProvider,
	defineProjectHost,
	type ExistingOutputState,
	executeOutputTransaction,
	FileSystemAtomicOutputStore,
	fingerprintProductKey,
	type InputChange,
	OutputPlanValidationError,
	type OwnedOutputFile,
	type OwnedOutputPlan,
	PROJECT_METADATA_KEYS,
	type ProductKey,
	type ProjectFileId,
	type ProjectMetadataInputProvider,
	type ProjectMetadataKey,
	type ProjectSession,
	projectFileId,
	readExistingOutputState,
} from "@nazare/compiler";
import type { Diagnostic } from "@nazare/core";
import {
	parseShopifyMigrations,
	type ShopifyAffectedPagesResult,
	type ShopifyBehaviorIndexResult,
	type ShopifyBuildModel,
	type ShopifyBuildPlan,
	type ShopifyBuildScope,
	type ShopifyDependencyIndexResult,
	type ShopifyEmissionPlan,
	type ShopifyImpactResult,
	type ShopifyMetafieldIndexResult,
	type ShopifyMigration,
	type ShopifyProjectGraphResult,
	type ShopifyProjectModelResult,
	type ShopifySchemaLock,
	type ShopifyUnusedFilesResult,
	shopifyBuildOutput,
	shopifyBuildProducts,
	shopifyPortableTransform,
	shopifyQueryProducts,
	shopifySemanticTarget,
} from "@nazare/target-shopify";

export type ShopifyQueryInputFile = { path: string; contents: string };
export type ShopifyQueryExternalInputs = Partial<
	Readonly<Record<ProjectMetadataKey, ProductKey>>
>;

export type ShopifyBuildRequest = {
	scope:
		| { kind: "workspace" }
		| { kind: "closure"; root: string }
		| { kind: "file"; file: string }
		| { kind: "files"; files: readonly string[] };
	emitOnError?: boolean;
	checkOnly?: boolean;
	previouslyOwnedPaths?: readonly string[];
	existingOutput?: ExistingOutputState;
	priorSchemaLock?: ShopifySchemaLock;
	migrations?: readonly ShopifyMigration[];
	appliedMigrationIds?: readonly string[];
	localeBase?: Readonly<Record<string, ProductKey>>;
	additionalOutputFiles?: readonly OwnedOutputFile[];
	strictness?: "loose" | "strict";
	additionalDiagnostics?: readonly Diagnostic[];
};

export type ShopifyMetafieldImpact = {
	version: 2;
	identity: { owner: string; namespace: string; key: string };
	scope: { excluded: readonly string[] };
	definition?: { id: string; type?: string };
	reads: readonly { fromPath: string }[];
	apiReads: readonly {
		fromPath: string;
		transport: string;
		endpoint?: string;
	}[];
	affectedSources: readonly string[];
	affectedPages: readonly string[];
	snapshot: { state: "present" | "missing"; path: string; pulledAt?: string };
	certainty: "complete" | "partial";
	uncertainty: readonly string[];
	uncertainSources: readonly { path: string; reasons: readonly string[] }[];
	localNetworkAccessCount: number;
	issues: readonly Diagnostic[];
};

export type ShopifyFileImpact = {
	version: 1;
	path: string;
	fileKind: string;
	usage: "used" | "unused";
	certainty: "complete" | "partial";
	dependencies: readonly string[];
	dependents: readonly string[];
	affectedPages: readonly string[];
	uncertainty: readonly string[];
	issues: readonly Diagnostic[];
};

export type ShopifyBuildPersistenceOptions = {
	projectRoot: string;
	outputRoot: string;
	targetId: string;
	schemaLockPath?: string;
	migrationsPath?: string;
	migrationLedgerPath?: string;
	localeBasePath?: string;
};

export type ShopifyBuildProductsResult = {
	revision: number;
	plan: ShopifyBuildPlan;
	model: ShopifyBuildModel;
	emission: ShopifyEmissionPlan;
	ownedOutput: OwnedOutputPlan;
};

export { PROJECT_METADATA_KEYS };

export class ShopifyQuerySession {
	readonly session: ProjectSession;
	private readonly files: Map<string, ShopifyQueryInputFile>;
	private readonly metadata: ProjectMetadataInputProvider;
	private readonly externalInputs: Map<ProjectMetadataKey, ProductKey>;
	private readonly metadataChanges: AsyncIterator<
		readonly InputChange<string>[]
	>;

	private constructor(
		session: ProjectSession,
		files: Map<string, ShopifyQueryInputFile>,
		metadata: ProjectMetadataInputProvider,
		externalInputs: Map<ProjectMetadataKey, ProductKey>,
	) {
		this.session = session;
		this.files = files;
		this.metadata = metadata;
		this.externalInputs = externalInputs;
		this.metadataChanges = metadata.provider
			.watch?.()
			[Symbol.asyncIterator]() as AsyncIterator<readonly InputChange<string>[]>;
	}

	static async create(
		inputs: readonly ShopifyQueryInputFile[],
		externalInputs: ShopifyQueryExternalInputs = {},
	): Promise<ShopifyQuerySession> {
		const files = new Map(inputs.map((file) => [file.path, { ...file }]));
		const provider = defineInputProvider({
			id: "nazare.graph-server.files",
			version: 1,
			async read(id: ProjectFileId) {
				const file = files.get(id.path);
				if (!file) throw new Error(`Missing graph-server file: ${id.path}`);
				return {
					value: { id, contents: file.contents },
					fingerprint: fingerprintProductKey(file.contents),
				};
			},
		});
		const externalValues = new Map<ProjectMetadataKey, ProductKey>(
			Object.entries(externalInputs).filter(
				(entry): entry is [ProjectMetadataKey, ProductKey] =>
					entry[1] !== undefined,
			),
		);
		const metadata = createProjectMetadataInputProvider(externalInputs);
		const host = defineProjectHost({
			files: provider,
			async discover() {
				return [...files.keys()].sort().map(fileId);
			},
			externalInputs: [metadata],
		});
		const session = await createProjectSession({ host });
		createSourceProductRegistrar({
			host,
			frontends: createDefaultSourceFrontendRegistry(),
		}).registerComputations(session.graph);
		shopifySemanticTarget().registerComputations(session.graph);
		shopifyPortableTransform().registerComputations(session.graph);
		shopifyBuildOutput().registerComputations(session.graph);
		return new ShopifyQuerySession(session, files, metadata, externalValues);
	}

	async buildProducts(
		request: ShopifyBuildRequest,
	): Promise<ShopifyBuildProductsResult> {
		const revision = this.session.snapshot().revision;
		const plan = this.buildPlan(request);
		const model = await this.session.graph.get(
			shopifyBuildProducts.model.product(plan),
			{ revision },
		);
		const emission = await this.session.graph.get(
			shopifyBuildProducts.emission.product(plan),
			{ revision },
		);
		const ownedOutput = await this.session.graph.get(
			shopifyBuildProducts.ownedOutput.product(plan),
			{ revision },
		);
		return { revision, plan, model, emission, ownedOutput };
	}

	async publishBuild(
		request: ShopifyBuildRequest,
		outputRoot: string,
	): Promise<ShopifyBuildProductsResult> {
		if (request.checkOnly) {
			throw new Error("Check-only builds cannot publish output");
		}
		const products = await this.buildProducts({
			...request,
			existingOutput: await readExistingOutputState(outputRoot),
		});
		await executeOutputTransaction({
			plan: products.ownedOutput,
			expectedRevision: products.revision,
			currentRevision: () => this.session.snapshot().revision,
			store: new FileSystemAtomicOutputStore(outputRoot),
		});
		return products;
	}

	async publishPersistentBuild(
		request: ShopifyBuildRequest,
		options: ShopifyBuildPersistenceOptions,
	): Promise<ShopifyBuildProductsResult> {
		if (request.checkOnly) {
			throw new Error("Check-only builds cannot publish output");
		}
		const paths = {
			schemaLock: options.schemaLockPath ?? "nazare.schema-lock.json",
			migrations: options.migrationsPath ?? "nazare.migrations.json",
			ledger: options.migrationLedgerPath ?? "nazare.migrations-applied.json",
			localeBase: options.localeBasePath ?? "nazare.locales-base.json",
		};
		const [priorSchemaLock, migrationsRaw, ledger, localeBase] =
			await Promise.all([
				readOptionalJson<ShopifySchemaLock>(
					options.projectRoot,
					paths.schemaLock,
				),
				readOptionalText(options.projectRoot, paths.migrations),
				readOptionalJson<MigrationLedger>(options.projectRoot, paths.ledger),
				readOptionalJson<Record<string, ProductKey>>(
					options.projectRoot,
					paths.localeBase,
				),
			]);
		const parsedMigrations = migrationsRaw
			? parseShopifyMigrations(migrationsRaw, paths.migrations)
			: { migrations: [], diagnostics: [] };
		if (parsedMigrations.diagnostics.length > 0) {
			throw new OutputPlanValidationError(parsedMigrations.diagnostics);
		}
		const products = await this.buildProducts({
			...request,
			existingOutput: await readExistingOutputState(options.outputRoot),
			priorSchemaLock,
			migrations: parsedMigrations.migrations,
			appliedMigrationIds: ledger?.applied[options.targetId] ?? [],
			localeBase: localeBase ?? {},
		});
		const outputPrefix = projectRelativeOutputPath(
			options.projectRoot,
			options.outputRoot,
		);
		const nextLedger: MigrationLedger = {
			version: 1,
			applied: {
				...(ledger?.applied ?? {}),
				[options.targetId]: [
					...new Set([
						...(ledger?.applied[options.targetId] ?? []),
						...products.emission.appliedMigrationIds,
					]),
				],
			},
		};
		const projectWrites = [
			projectMetadataWrite(paths.schemaLock, products.model.schemaLock),
			projectMetadataWrite(paths.localeBase, products.emission.nextLocaleBase),
			...(products.emission.appliedMigrationIds.length > 0
				? [projectMetadataWrite(paths.ledger, nextLedger)]
				: []),
		];
		const combined = createOwnedOutputPlan({
			writes: [
				...products.ownedOutput.writes.map((file) => ({
					...file,
					path: `${outputPrefix}/${file.path}`,
				})),
				...projectWrites,
			],
		});
		await executeOutputTransaction({
			plan: {
				...combined,
				deletes: products.ownedOutput.deletes.map(
					(path) => `${outputPrefix}/${path}`,
				),
				diagnostics: [
					...products.ownedOutput.diagnostics,
					...combined.diagnostics,
				],
			},
			expectedRevision: products.revision,
			currentRevision: () => this.session.snapshot().revision,
			store: new FileSystemAtomicOutputStore(options.projectRoot),
		});
		return products;
	}

	async projectModel(): Promise<ShopifyProjectModelResult> {
		return this.session.get(
			shopifyQueryProducts.projectModel.product({ files: this.fileIds() }),
		);
	}

	async projectGraph(): Promise<ShopifyProjectGraphResult> {
		return this.session.get(
			shopifyQueryProducts.projectGraph.product({ files: this.fileIds() }),
		);
	}

	async dependencyIndex(
		targetPath: string | null = null,
	): Promise<ShopifyDependencyIndexResult> {
		return this.session.get(
			shopifyQueryProducts.dependencyIndex.product({
				files: this.fileIds(),
				target: targetPath ? fileId(targetPath) : null,
			}),
		);
	}

	async fileImpact(path: string): Promise<ShopifyFileImpact | undefined> {
		const file = this.fileIds().find((candidate) => candidate.path === path);
		if (!file) return undefined;
		const files = this.fileIds();
		const [dependencies, dependents, affectedPages] = await Promise.all([
			this.dependencyIndex(),
			this.dependencyIndex(path),
			this.affectedPages(path),
		]);
		const product = shopifyQueryProducts.affectedPages.product({
			files,
			changed: [file],
		});
		const revision = this.session.snapshot().revision;
		const [metadata, modelMetadata] = await Promise.all([
			this.session.graph.metadata(product, { revision }),
			this.session.graph.metadata(
				shopifyQueryProducts.projectModel.product({ files }),
				{ revision },
			),
		]);
		const uncertainty = [
			...new Set([
				...dependencies.uncertainty,
				...affectedPages.impact.uncertainty,
				...metadata.uncertainty.map((item) => item.message),
			]),
		];
		const dependencyPaths = dependencies.records
			.filter((record) => record.from.path === path)
			.map((record) => record.to.path)
			.sort();
		const dependentPaths = dependents.records
			.map((record) => record.from.path)
			.sort();
		const pages = affectedPages.pages.map((page) => page.path).sort();
		return {
			version: 1,
			path,
			fileKind: shopifyFileKind(path),
			usage: dependentPaths.length > 0 || pages.length > 0 ? "used" : "unused",
			certainty: uncertainty.length > 0 ? "partial" : "complete",
			dependencies: dependencyPaths,
			dependents: dependentPaths,
			affectedPages: pages,
			uncertainty,
			issues: [...metadata.diagnostics, ...modelMetadata.diagnostics],
		};
	}

	async impact(paths: readonly string[]): Promise<ShopifyImpactResult> {
		return this.session.get(
			shopifyQueryProducts.impact.product({
				files: this.fileIds(),
				changed: paths.map(fileId),
			}),
		);
	}

	async affectedPages(path: string): Promise<ShopifyAffectedPagesResult> {
		return this.session.get(
			shopifyQueryProducts.affectedPages.product({
				files: this.fileIds(),
				changed: [fileId(path)],
			}),
		);
	}

	async behaviorIndex(input: {
		behaviorKind: string | null;
	}): Promise<ShopifyBehaviorIndexResult> {
		return this.session.get(
			shopifyQueryProducts.behaviorIndex.product({
				files: this.fileIds(),
				behaviorKind: input.behaviorKind,
			}),
		);
	}

	async metafieldImpact(identity: {
		owner: string;
		namespace: string;
		key: string;
	}): Promise<ShopifyMetafieldImpact> {
		const index = await this.metafieldIndex({
			ownerType: identity.owner,
			namespace: identity.namespace,
		});
		const records = index.records.filter(
			(record) => record.key === identity.key,
		);
		const affectedSources = [
			...new Set(records.map((record) => record.owner.path)),
		].sort();
		const pages = await Promise.all(
			affectedSources.map((path) => this.affectedPages(path)),
		);
		const affectedPages = [
			...new Set(
				pages.flatMap((result) => result.pages.map((page) => page.path)),
			),
		].sort();
		const apiReads = records
			.filter(
				(record): record is typeof record & { transport: string } =>
					typeof record.transport === "string",
			)
			.map((record) => ({
				fromPath: record.owner.path,
				transport: record.transport,
				...(record.endpoint ? { endpoint: record.endpoint } : {}),
			}));
		const reads = records
			.filter((record) => !record.transport)
			.map((record) => ({ fromPath: record.owner.path }));
		const uncertainty = [
			...new Set([
				...index.records
					.filter((record) => record.dynamic)
					.map(
						(record) => `Dynamic metafield identity in ${record.owner.path}`,
					),
			]),
		];
		const snapshot = this.externalInputs.get(PROJECT_METADATA_KEYS.metafields);
		const definition = findMetafieldDefinition(snapshot, identity);
		return {
			version: 2,
			identity,
			scope: {
				excluded: [
					"remoteAppRuntime",
					"runtimeNetworkResponses",
					"appProxyResponses",
					"serverSideAppData",
				],
			},
			...(definition ? { definition } : {}),
			reads,
			apiReads,
			affectedSources,
			affectedPages,
			snapshot: {
				state: snapshot === undefined ? "missing" : "present",
				path: ".shopify/metafields.json",
			},
			certainty: uncertainty.length > 0 ? "partial" : "complete",
			uncertainty,
			uncertainSources: [],
			localNetworkAccessCount: apiReads.length,
			issues: [],
		};
	}

	async metafieldIndex(input: {
		ownerType: string | null;
		namespace: string | null;
	}): Promise<ShopifyMetafieldIndexResult> {
		return this.session.get(
			shopifyQueryProducts.metafieldIndex.product({
				files: this.fileIds(),
				ownerType: input.ownerType,
				namespace: input.namespace,
			}),
		);
	}

	async unusedFiles(
		roots: readonly string[],
	): Promise<ShopifyUnusedFilesResult> {
		return this.session.get(
			shopifyQueryProducts.unusedFiles.product({
				files: this.fileIds(),
				roots: roots.map(fileId),
			}),
		);
	}

	async replaceFiles(
		inputs: readonly ShopifyQueryInputFile[],
	): Promise<number> {
		const next = new Map(inputs.map((file) => [file.path, file]));
		let revision = this.session.snapshot().revision;
		for (const path of [...this.files.keys()].sort()) {
			if (!next.has(path)) revision = await this.removeFile(path);
		}
		for (const file of [...next.values()].sort((left, right) =>
			left.path.localeCompare(right.path),
		)) {
			const current = this.files.get(file.path);
			if (current?.contents !== file.contents)
				revision = await this.updateFile(file);
		}
		return revision;
	}

	async updateExternalInput(
		key: ProjectMetadataKey,
		value: ProductKey | null,
	): Promise<number> {
		const change =
			value === null
				? this.metadata.remove(key)
				: this.metadata.set(key, value);
		if (value === null) this.externalInputs.delete(key);
		else this.externalInputs.set(key, value);
		if (!change) return this.session.snapshot().revision;
		const next = await this.metadataChanges.next();
		if (next.done) throw new Error("Project metadata watcher closed");
		const update = await this.session.apply({
			kind: "external",
			providerId: this.metadata.provider.id,
			changes: next.value,
		});
		if (!update.committed)
			throw update.error ?? new Error("External query update rejected");
		return update.revision;
	}

	async updateFile(file: ShopifyQueryInputFile): Promise<number> {
		const previous = this.files.get(file.path);
		const exists = previous !== undefined;
		this.files.set(file.path, { ...file });
		const update = await this.session.apply({
			kind: "files",
			changes: [
				{
					kind: exists ? "changed" : "added",
					key: fileId(file.path),
					fingerprint: fingerprintProductKey(file.contents),
				},
			],
		});
		if (!update.committed) {
			if (previous) this.files.set(file.path, previous);
			else this.files.delete(file.path);
			throw update.error ?? new Error("Query update rejected");
		}
		return update.revision;
	}

	async removeFile(path: string): Promise<number> {
		const previous = this.files.get(path);
		this.files.delete(path);
		const update = await this.session.apply({
			kind: "files",
			changes: [{ kind: "removed", key: fileId(path) }],
		});
		if (!update.committed) {
			if (previous) this.files.set(path, previous);
			throw update.error ?? new Error("Query update rejected");
		}
		return update.revision;
	}

	private buildPlan(request: ShopifyBuildRequest): ShopifyBuildPlan {
		let scope: ShopifyBuildScope;
		switch (request.scope.kind) {
			case "workspace":
				scope = request.scope;
				break;
			case "closure":
				scope = { kind: "closure", root: fileId(request.scope.root) };
				break;
			case "file":
				scope = { kind: "file", file: fileId(request.scope.file) };
				break;
			case "files":
				scope = { kind: "files", files: request.scope.files.map(fileId) };
				break;
		}
		return {
			scope,
			files: this.fileIds(),
			emitOnError: request.emitOnError ?? false,
			checkOnly: request.checkOnly ?? false,
			previouslyOwnedPaths: request.previouslyOwnedPaths ?? [],
			existingOutput: request.existingOutput ?? null,
			priorSchemaLock: request.priorSchemaLock ?? null,
			migrations: request.migrations ?? [],
			appliedMigrationIds: request.appliedMigrationIds ?? [],
			localeBase: request.localeBase ?? {},
			additionalOutputFiles: request.additionalOutputFiles ?? [],
			...(request.strictness ? { strictness: request.strictness } : {}),
			additionalDiagnostics: request.additionalDiagnostics ?? [],
		};
	}

	private fileIds(): readonly ProjectFileId[] {
		return this.session.snapshot().fileIds;
	}
}

function findMetafieldDefinition(
	snapshot: ProductKey | undefined,
	identity: { owner: string; namespace: string; key: string },
): { id: string; type?: string } | undefined {
	let value: unknown = snapshot;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const definitions = (value as Record<string, unknown>)[identity.owner];
	if (!Array.isArray(definitions)) return undefined;
	for (const candidate of definitions) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
			continue;
		const record = candidate as Record<string, unknown>;
		if (record.namespace !== identity.namespace || record.key !== identity.key)
			continue;
		const nestedType =
			record.type &&
			typeof record.type === "object" &&
			!Array.isArray(record.type)
				? (record.type as Record<string, unknown>).name
				: undefined;
		const type =
			typeof record.type === "string"
				? record.type
				: typeof nestedType === "string"
					? nestedType
					: undefined;
		return {
			id: `${identity.owner}.${identity.namespace}.${identity.key}`,
			...(type ? { type } : {}),
		};
	}
	return undefined;
}

function shopifyFileKind(path: string): string {
	if (/^sections\/[^/]+\.liquid$/.test(path)) return "section";
	if (/^snippets\/[^/]+\.liquid$/.test(path)) return "snippet";
	if (/^blocks\/[^/]+\.liquid$/.test(path)) return "themeBlock";
	if (/^templates\/.+\.json$/.test(path)) return "templateJson";
	if (/^templates\/.+\.liquid$/.test(path)) return "templateLiquid";
	if (/^layout\/[^/]+\.liquid$/.test(path)) return "layout";
	if (/^locales\/[^/]+\.json$/.test(path)) return "locale";
	if (path.startsWith("assets/")) return "asset";
	if (path.endsWith(".nz.liquid")) return "nazareComponent";
	return "other";
}

function fileId(path: string): ProjectFileId {
	return projectFileId({ workspace: "graph-server", package: "theme", path });
}

type MigrationLedger = {
	version: 1;
	applied: Record<string, string[]>;
};

async function readOptionalText(
	root: string,
	path: string,
): Promise<string | undefined> {
	try {
		return await readFile(join(root, path), "utf8");
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		)
			return undefined;
		throw error;
	}
}

async function readOptionalJson<Value>(
	root: string,
	path: string,
): Promise<Value | undefined> {
	const raw = await readOptionalText(root, path);
	if (raw === undefined) return undefined;
	try {
		return JSON.parse(raw) as Value;
	} catch (error) {
		throw new Error(
			`${path}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function projectRelativeOutputPath(
	projectRoot: string,
	outputRoot: string,
): string {
	const path = relative(projectRoot, outputRoot).split(sep).join("/");
	if (!path || path === ".." || path.startsWith("../")) {
		throw new Error("Build output root must be a child of project root");
	}
	return path;
}

function projectMetadataWrite(
	path: string,
	value: ProductKey,
): OwnedOutputFile {
	return {
		path,
		contents: `${JSON.stringify(value, null, 2)}\n`,
		ownerId: "nazare:build-metadata",
	};
}
