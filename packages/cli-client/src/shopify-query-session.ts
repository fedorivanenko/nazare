import {
	createDefaultSourceFrontendRegistry,
	createProjectMetadataInputProvider,
	createProjectSession,
	createSourceProductRegistrar,
	defineInputProvider,
	defineProjectHost,
	fingerprintProductKey,
	type InputChange,
	PROJECT_METADATA_KEYS,
	type ProductKey,
	type ProjectFileId,
	type ProjectMetadataInputProvider,
	type ProjectMetadataKey,
	type ProjectSession,
	projectFileId,
} from "@nazare/compiler";
import {
	type ShopifyAffectedPagesResult,
	type ShopifyBehaviorIndexResult,
	type ShopifyDependencyIndexResult,
	type ShopifyImpactResult,
	type ShopifyMetafieldIndexResult,
	type ShopifyProjectGraphResult,
	type ShopifyProjectModelResult,
	type ShopifyUnusedFilesResult,
	shopifyQueryProducts,
	shopifySemanticTarget,
} from "@nazare/target-shopify";

export type ShopifyQueryInputFile = { path: string; contents: string };
export type ShopifyQueryExternalInputs = Partial<
	Readonly<Record<ProjectMetadataKey, ProductKey>>
>;

export { PROJECT_METADATA_KEYS };

export class ShopifyQuerySession {
	readonly session: ProjectSession;
	private readonly files: Map<string, ShopifyQueryInputFile>;
	private readonly metadata: ProjectMetadataInputProvider;
	private readonly metadataChanges: AsyncIterator<
		readonly InputChange<string>[]
	>;

	private constructor(
		session: ProjectSession,
		files: Map<string, ShopifyQueryInputFile>,
		metadata: ProjectMetadataInputProvider,
	) {
		this.session = session;
		this.files = files;
		this.metadata = metadata;
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
		return new ShopifyQuerySession(session, files, metadata);
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

	private fileIds(): readonly ProjectFileId[] {
		return this.session.snapshot().fileIds;
	}
}

function fileId(path: string): ProjectFileId {
	return projectFileId({ workspace: "graph-server", package: "theme", path });
}
