import {
	createDefaultSourceFrontendRegistry,
	createProjectSession,
	createSourceProductRegistrar,
	defineInputProvider,
	defineProjectHost,
	fingerprintProductKey,
	type ProjectFileId,
	type ProjectSession,
	projectFileId,
} from "@nazare/compiler";
import {
	type ShopifyBehaviorIndexResult,
	type ShopifyImpactResult,
	type ShopifyMetafieldIndexResult,
	type ShopifyProjectGraphResult,
	type ShopifyProjectModelResult,
	type ShopifyUnusedFilesResult,
	shopifyQueryProducts,
	shopifySemanticTarget,
} from "@nazare/target-shopify";

export type ShopifyQueryInputFile = { path: string; contents: string };

export class ShopifyQuerySession {
	readonly session: ProjectSession;
	private readonly files: Map<string, ShopifyQueryInputFile>;

	private constructor(
		session: ProjectSession,
		files: Map<string, ShopifyQueryInputFile>,
	) {
		this.session = session;
		this.files = files;
	}

	static async create(
		inputs: readonly ShopifyQueryInputFile[],
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
		const host = defineProjectHost({
			files: provider,
			async discover() {
				return [...files.keys()].sort().map(fileId);
			},
		});
		const session = await createProjectSession({ host });
		createSourceProductRegistrar({
			host,
			frontends: createDefaultSourceFrontendRegistry(),
		}).registerComputations(session.graph);
		shopifySemanticTarget().registerComputations(session.graph);
		return new ShopifyQuerySession(session, files);
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

	async impact(paths: readonly string[]): Promise<ShopifyImpactResult> {
		return this.session.get(
			shopifyQueryProducts.impact.product({
				files: this.fileIds(),
				changed: paths.map(fileId),
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
