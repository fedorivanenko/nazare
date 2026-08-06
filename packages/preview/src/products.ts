import {
	type ComputationGraph,
	type ComputationRegistrar,
	defineComputation,
	defineComputationRegistrar,
	defineProduct,
	productKeyValueCodec,
} from "@nazare/compiler/computation";
import { type ProjectFileId, projectFileId } from "@nazare/compiler/project";
import { sourceProducts } from "@nazare/compiler/source-products";
import type { Diagnostic, NazareManifestStory } from "@nazare/core";
import {
	type PreviewComponent,
	previewComponentFromSource,
} from "./component.js";
import {
	type RenderedComponent,
	type RenderedStory,
	renderComponentStories,
} from "./render.js";
import { type PreviewStory, storiesFor } from "./stories.js";
import { parseStoryFile } from "./story-file.js";

export type PreviewStoryDiscovery = {
	file: ProjectFileId;
	componentCandidates: readonly ProjectFileId[];
	stories: readonly NazareManifestStory[];
	diagnostics: readonly Diagnostic[];
};

export type PreviewFixtureInput = {
	file: ProjectFileId;
	value?: unknown;
	diagnostics: readonly Diagnostic[];
};

export type PreviewModelQuery = {
	component: ProjectFileId;
	story: ProjectFileId;
	files: readonly ProjectFileId[];
};

export type PreviewModel = {
	component: PreviewComponent;
	stories: readonly PreviewStory[];
	storyFile: ProjectFileId;
	dependencies: readonly ProjectFileId[];
	diagnostics: readonly Diagnostic[];
};

export type PreviewStoryRenderQuery = {
	model: PreviewModelQuery;
	storyName: string;
	snippets?: Readonly<Record<string, string>>;
};

export type PreviewRenderPlanQuery = {
	model: PreviewModelQuery;
	snippets?: Readonly<Record<string, string>>;
};

export const previewProducts = {
	story: defineProduct<ProjectFileId, PreviewStoryDiscovery>({
		namespace: "nazare.preview",
		id: "story-discovery",
		version: 1,
	}),
	fixture: defineProduct<ProjectFileId, PreviewFixtureInput>({
		namespace: "nazare.preview",
		id: "fixture-input",
		version: 1,
	}),
	model: defineProduct<PreviewModelQuery, PreviewModel>({
		namespace: "nazare.preview",
		id: "preview-model",
		version: 1,
	}),
	renderStory: defineProduct<PreviewStoryRenderQuery, RenderedStory>({
		namespace: "nazare.preview",
		id: "render-story",
		version: 1,
	}),
	renderPlan: defineProduct<PreviewRenderPlanQuery, RenderedComponent>({
		namespace: "nazare.preview",
		id: "render-plan",
		version: 1,
	}),
};

export function createPreviewProductRegistrar(): ComputationRegistrar {
	return defineComputationRegistrar(
		{ id: "nazare.preview-products", version: 1 },
		registerPreviewProducts,
	);
}

function registerPreviewProducts(graph: ComputationGraph): void {
	graph.register(
		defineComputation(
			previewProducts.story,
			async (context, file) => {
				const source = await context.get(
					sourceProducts.classified.product(file),
				);
				const diagnostics: Diagnostic[] = [];
				let stories: readonly NazareManifestStory[] = [];
				try {
					stories = parseStoryFile(
						JSON.parse(source.contents),
						file.path,
					).stories;
				} catch (error) {
					diagnostics.push(
						previewDiagnostic(file, "PREVIEW_STORY_INVALID", error),
					);
				}
				return {
					file,
					componentCandidates: componentCandidates(file),
					stories,
					diagnostics,
				};
			},
			{
				cache: productKeyValueCodec<PreviewStoryDiscovery>(),
				diagnostics: (result) => result.diagnostics,
			},
		),
	);
	graph.register(
		defineComputation(
			previewProducts.fixture,
			async (context, file) => {
				const source = await context.get(
					sourceProducts.classified.product(file),
				);
				try {
					return { file, value: JSON.parse(source.contents), diagnostics: [] };
				} catch (error) {
					return {
						file,
						diagnostics: [
							previewDiagnostic(file, "PREVIEW_FIXTURE_INVALID", error),
						],
					};
				}
			},
			{
				cache: productKeyValueCodec<PreviewFixtureInput>(),
				diagnostics: (result) => result.diagnostics,
			},
		),
	);
	graph.register(
		defineComputation(
			previewProducts.model,
			async (context, query) => {
				const [story, closure] = await Promise.all([
					context.get(previewProducts.story.product(query.story)),
					context.get(
						sourceProducts.closure.product({
							roots: [query.component],
							files: query.files,
						}),
					),
				]);
				const sources = await Promise.all(
					closure.files.map((file) =>
						context.get(sourceProducts.classified.product(file)),
					),
				);
				const sourceByPath = new Map(
					sources.map((source) => [source.id.path, source.contents]),
				);
				const fixtures = await Promise.all(
					collectFixturePaths(story.stories).map((path) =>
						context.get(
							previewProducts.fixture.product(
								projectFileId({ ...query.story, path }),
							),
						),
					),
				);
				const fixtureByPath = new Map(
					fixtures.map((fixture) => [fixture.file.path, fixture.value]),
				);
				const component = previewComponentFromSource(
					sourceByPath.get(query.component.path) ?? "",
					query.component.path,
					{ readFile: (path) => sourceByPath.get(path) },
				);
				const diagnostics = [
					...story.diagnostics,
					...closure.diagnostics,
					...fixtures.flatMap((fixture) => fixture.diagnostics),
					...component.issues,
				];
				return {
					component,
					stories: storiesFor({
						sidecar: { stories: [...story.stories] },
						readFixture: (path) => fixtureByPath.get(path),
					}),
					storyFile: query.story,
					dependencies: closure.files,
					diagnostics,
				};
			},
			{
				cache: productKeyValueCodec<PreviewModel>(),
				diagnostics: (result) => result.diagnostics,
			},
		),
	);
	graph.register(
		defineComputation(
			previewProducts.renderStory,
			async (context, query) => {
				const model = await context.get(
					previewProducts.model.product(query.model),
				);
				const story = model.stories.find(
					(candidate) => candidate.name === query.storyName,
				);
				if (!story) {
					throw new Error(
						`Unknown preview story ${JSON.stringify(query.storyName)}`,
					);
				}
				const rendered = await renderComponentStories(
					model.component,
					[story],
					query.snippets ? { snippets: { ...query.snippets } } : {},
				);
				const result = rendered.stories[0];
				if (!result)
					throw new Error("Preview story renderer returned no result");
				return result;
			},
			{ cache: productKeyValueCodec<RenderedStory>() },
		),
	);
	graph.register(
		defineComputation(
			previewProducts.renderPlan,
			async (context, query) => {
				const model = await context.get(
					previewProducts.model.product(query.model),
				);
				const stories = await Promise.all(
					model.stories.map((story) =>
						context.get(
							previewProducts.renderStory.product({
								model: query.model,
								storyName: story.name,
								...(query.snippets ? { snippets: query.snippets } : {}),
							}),
						),
					),
				);
				return { component: model.component, stories };
			},
			{ cache: productKeyValueCodec<RenderedComponent>() },
		),
	);
}

function collectFixturePaths(
	stories: readonly NazareManifestStory[],
): string[] {
	const paths = new Set<string>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if (typeof record.$file === "string") paths.add(record.$file);
		for (const nested of Object.values(record)) visit(nested);
	};
	for (const story of stories) visit(story.props);
	return [...paths].sort();
}

function componentCandidates(file: ProjectFileId): readonly ProjectFileId[] {
	const stem = file.path.replace(/\.stories\.json$/, "");
	return [
		{ ...file, path: `${stem}.nz.liquid` },
		{ ...file, path: `${stem}.liquid` },
	];
}

function previewDiagnostic(
	file: ProjectFileId,
	code: string,
	error: unknown,
): Diagnostic {
	const position = { line: 1, column: 1 };
	return {
		severity: "error",
		phase: "parse",
		code,
		message: error instanceof Error ? error.message : String(error),
		span: { file: file.path, start: position, end: position },
	};
}
