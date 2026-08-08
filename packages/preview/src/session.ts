import {
	createFileSystemProjectHost,
	createProjectSession,
	type ProjectFileId,
	type ProjectSession,
	type ProjectSessionUpdate,
	projectFileId,
} from "@nazare/compiler/project";
import {
	createDefaultSourceFrontendRegistry,
	createSourceProductRegistrar,
} from "@nazare/compiler/source-products";
import {
	createPreviewProductRegistrar,
	type PreviewModel,
	type PreviewRenderPlanQuery,
	previewProducts,
} from "./products.js";
import type { RenderedComponent } from "./render.js";

export class PreviewProjectSession {
	readonly project: ProjectSession;
	readonly workspace: string;
	readonly package: string;

	private constructor(
		project: ProjectSession,
		workspace: string,
		packageName: string,
	) {
		this.project = project;
		this.workspace = workspace;
		this.package = packageName;
	}

	static async open(
		root: string,
		options: { workspace?: string; package?: string } = {},
	): Promise<PreviewProjectSession> {
		const workspace = options.workspace ?? "preview";
		const packageName = options.package ?? "theme";
		const host = createFileSystemProjectHost({
			root,
			workspace,
			package: packageName,
		});
		const project = await createProjectSession({ host });
		createSourceProductRegistrar({
			host,
			frontends: createDefaultSourceFrontendRegistry(),
		}).registerComputations(project.graph);
		createPreviewProductRegistrar().registerComputations(project.graph);
		return new PreviewProjectSession(project, workspace, packageName);
	}

	get revision(): number {
		return this.project.snapshot().revision;
	}

	file(path: string): ProjectFileId {
		return projectFileId({
			workspace: this.workspace,
			package: this.package,
			path,
		});
	}

	files(): readonly ProjectFileId[] {
		return this.project.snapshot().fileIds;
	}

	model(componentPath: string, storyPath: string): Promise<PreviewModel> {
		return this.project.get(
			previewProducts.model.product({
				component: this.file(componentPath),
				story: this.file(storyPath),
				files: this.files(),
			}),
		);
	}

	render(
		componentPath: string,
		storyPath: string,
		options: Omit<PreviewRenderPlanQuery, "model"> = {},
	): Promise<RenderedComponent> {
		return this.project.get(
			previewProducts.renderPlan.product({
				model: {
					component: this.file(componentPath),
					story: this.file(storyPath),
					files: this.files(),
				},
				...options,
			}),
		);
	}

	watch(): AsyncIterable<ProjectSessionUpdate> {
		return this.project.watch();
	}
}
