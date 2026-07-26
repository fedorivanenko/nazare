// Stories → rendered stories. The model pass: it produces HTML per story and
// nothing about a page, so a static gallery, a dev server, and a snapshot test
// all consume the same result.
import type { PreviewComponent } from "./component.js";
import { createPreviewEngine, renderContext, renderPreview } from "./engine.js";
import {
	changedProps,
	generatedStories,
	type PreviewStory,
} from "./stories.js";
import { storyId } from "./story-id.js";

export type RenderedStory = {
	/** `component--story`; addresses this story's document and deep link. */
	id: string;
	story: PreviewStory;
	html: string;
	/** Prop names this story changed from the component's defaults. */
	changed: string[];
	/** Set when rendering threw — a broken story is reported, not swallowed. */
	error?: string;
};

export type RenderedComponent = {
	component: PreviewComponent;
	stories: RenderedStory[];
};

export type RenderStoriesOptions = {
	/** Emitted snippets by name, so a story can render a composing component. */
	snippets?: Record<string, string>;
	assetBase?: string;
};

export async function renderComponentStories(
	component: PreviewComponent,
	stories: PreviewStory[] = generatedStories(component),
	options: RenderStoriesOptions = {},
): Promise<RenderedComponent> {
	const engine = createPreviewEngine(options);
	const rendered: RenderedStory[] = [];
	for (const story of stories) {
		const id = storyId(component.name, story.name);
		const changed = changedProps(story, component.controls);
		try {
			rendered.push({
				id,
				story,
				changed,
				html: await renderPreview(
					engine,
					component.template,
					renderContext(story.props, component.componentKind, component.name),
				),
			});
		} catch (error) {
			rendered.push({
				id,
				story,
				changed,
				html: "",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { component, stories: rendered };
}
