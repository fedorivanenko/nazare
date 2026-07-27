/**
 * Public API of the Nazare preview.
 *
 * Explicit flow:
 * source → compile (real compiler) → emitted template + contract → controls
 * → stories → render (Liquid) → story documents / gallery. Every pass is pure
 * over its input, so a frontend (static site, local server, editor panel) picks
 * the passes it needs and owns its own I/O.
 *
 * The Liquid declares the interface; a story file declares the cases. Nothing
 * here derives a story at render time — `scaffoldStories` writes a first draft
 * for an author to edit and commit, and that file is the only source of cases.
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
export { type GalleryPageOptions, galleryPage } from "./gallery.js";
export {
	controlsFromDocParams,
	controlsFromSchemaSource,
	plainLiquidControls,
} from "./plain-controls.js";
export {
	type RenderedComponent,
	type RenderedStory,
	type RenderStoriesOptions,
	renderComponentStories,
} from "./render.js";
export {
	changedProps,
	declaredStories,
	defaultStory,
	manifestStories,
	type PreviewStory,
	scaffoldStories,
	storiesFor,
	storyProps,
	variantStories,
} from "./stories.js";
export {
	type StoryDocumentFile,
	type StoryDocumentOptions,
	storyBody,
	storyDocument,
	storyDocuments,
} from "./story-document.js";
export { parseStoryFile, type StoryDeclaration } from "./story-file.js";
export { componentId, slug, storyFileName, storyId } from "./story-id.js";
export {
	type StoryIssue,
	validateStory,
} from "./story-validation.js";
export { type WorkbenchPageOptions, workbenchPage } from "./workbench.js";
