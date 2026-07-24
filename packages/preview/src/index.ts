/**
 * Public API of the Nazare preview.
 *
 * Explicit flow:
 * source → compile (real compiler) → emitted template + contract → controls
 * → stories → render (Liquid) → gallery. Every pass is pure over its input, so
 * a frontend (static site, local server, editor panel) picks the passes it
 * needs and owns its own I/O.
 */
export {
	type PreviewAsset,
	type PreviewComponent,
	type PreviewComponentOptions,
	previewComponentFromSource,
	snippetLibrary,
} from "./component.js";
export {
	controlsFromContract,
	defaultProps,
	type PreviewControl,
} from "./controls.js";
export {
	createPreviewEngine,
	type PreviewEngineOptions,
	renderPreview,
} from "./engine.js";
export {
	formatMoney,
	resolveFixtures,
	shopifyFixtures,
	usesFixtures,
} from "./fixtures.js";
export {
	type GalleryPageOptions,
	galleryPage,
	type RenderedComponent,
	type RenderedStory,
	type RenderStoriesOptions,
	renderComponentStories,
} from "./gallery.js";
export {
	changedProps,
	defaultStory,
	generatedStories,
	manifestStories,
	type PreviewStory,
	storiesFor,
	variantStories,
} from "./stories.js";
