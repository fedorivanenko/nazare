// One story, one document.
//
// Storybook renders a story in an iframe, and the reason is not presentation:
// forty components in one document share a cascade, so a global selector in one
// component's stylesheet silently restyles another's story, and an id collision
// in emitted markup lands in the same DOM. Isolating each story makes the page
// show what a storefront would show, and gives every story a URL that opens on
// its own — the workbench equivalent of Storybook's `?path=/story`.
//
// The document is standalone: it links the emitted stylesheets, carries the
// shared tokens, and executes the emitted behavior scripts the template itself
// wrote out. It talks to a host page only to report its height and to follow a
// theme, and renders correctly opened directly with no host at all.
import type { PreviewComponent } from "./component.js";
import { escapeHtml } from "./html.js";
import type { RenderedStory } from "./render.js";
import { CANVAS_STYLES, FRAME_MESSAGE, TOKEN_STYLES } from "./theme.js";

export type StoryDocumentOptions = {
	/**
	 * Extra stylesheets every story links — a theme's global CSS, say. The
	 * component's *own* emitted stylesheets are linked without being asked for;
	 * handing the whole registry's CSS to every story would undo the isolation.
	 */
	stylesheets?: string[];
	/** Where emitted assets live, matching the render's. Default `./assets`. */
	assetBase?: string;
	/** Extra module scripts, for a frontend that wires behaviors itself. */
	scripts?: string[];
	/**
	 * Resolves the document's relative URLs. Story documents are written to a
	 * subfolder, so the assets an emitted template asks for (`./assets/x.js`)
	 * and the stylesheets the shell links sit one level up. Default `../`.
	 */
	base?: string;
	title?: string;
};

const STORY_STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--background);
    color: var(--foreground);
    font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    padding: 1.5rem 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Not 100vh: the body is what the host measures to size the frame, so a
     * body that fills the frame reports the height it was already given and
     * every story stays stuck at the placeholder. The floor matches the shell's
     * minimum stage height, so a short story is centred rather than hugging the
     * top. */
    min-height: 150px;
  }
  .story-error { color: #b91c1c; font-size: .78rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .story-empty { color: var(--muted-foreground); font-style: italic; font-size: .78rem; }
  .preview-slot {
    border: 1px dashed var(--border);
    border-radius: calc(var(--radius) - 3px);
    padding: .75rem 1rem;
    color: var(--muted-foreground);
    font-size: .75rem;
  }
`;

// The frame is a separate document: the shell cannot measure it and cannot set
// its theme by reaching in. Both cross by message. Height goes out on every
// resize so a story that reflows (a behavior that expands a disclosure) keeps
// its frame the right size.
const STORY_SCRIPT = `
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const initial = params.get('theme');
  if (initial === 'dark' || initial === 'light') root.setAttribute('data-theme', initial);

  const report = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    parent.postMessage({ type: ${JSON.stringify(FRAME_MESSAGE.height)}, id: root.dataset.storyId, height }, '*');
  };
  addEventListener('load', report);
  new ResizeObserver(report).observe(document.body);

  addEventListener('message', (event) => {
    if (event.data?.type === ${JSON.stringify(FRAME_MESSAGE.theme)}) {
      const theme = event.data.theme;
      if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
      else root.removeAttribute('data-theme');
      return;
    }
    // How the story is shown, not what it is: the ground it sits on, whether
    // every box is outlined, and how large it is drawn. All three belong to the
    // frame because the frame owns this document's rendering.
    if (event.data?.type !== ${JSON.stringify(FRAME_MESSAGE.canvas)}) return;
    const body = document.body;
    const background = event.data.background;
    if (background) {
      body.style.setProperty('--canvas-background', background);
      body.setAttribute('data-canvas-background', '');
    } else {
      body.style.removeProperty('--canvas-background');
      body.removeAttribute('data-canvas-background');
    }
    body.toggleAttribute('data-canvas-outline', Boolean(event.data.outline));
    // Zoom rather than transform: the body keeps reporting a real height, so
    // the frame still sizes itself. It does change layout width, which is why
    // zoom and the viewport presets answer different questions.
    body.style.zoom = event.data.zoom && event.data.zoom !== 1 ? event.data.zoom : '';
  });
`;

/** The body of a story: its markup, or why there is none. */
export function storyBody(rendered: RenderedStory): string {
	if (rendered.error) {
		return `<span class="story-error">render failed: ${escapeHtml(rendered.error)}</span>`;
	}
	return rendered.html || '<span class="story-empty">renders nothing</span>';
}

/**
 * The component's own emitted stylesheets. A Nazare component's template links
 * its own — `{{ 'x.css' | asset_url | stylesheet_tag }}` is part of the emitted
 * output — so those are left to the markup and not linked twice; a plain-Liquid
 * component ships CSS the template never references, and that one needs linking
 * or the story renders unstyled.
 */
function ownStylesheets(
	component: PreviewComponent,
	rendered: RenderedStory,
	assetBase: string,
): string[] {
	return component.assets
		.filter((asset) => asset.path.endsWith(".css"))
		.map((asset) => `${assetBase}/${asset.path.split("/").pop()}`)
		.filter((href) => !rendered.html.includes(href));
}

export function storyDocument(
	component: PreviewComponent,
	rendered: RenderedStory,
	options: StoryDocumentOptions = {},
): string {
	const base = options.base ?? "../";
	const title =
		options.title ?? `${component.name} — ${rendered.story.name} — Nazare`;
	const links = [
		...ownStylesheets(component, rendered, options.assetBase ?? "./assets"),
		...(options.stylesheets ?? []),
	]
		.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
		.join("\n");
	const scripts = (options.scripts ?? [])
		.map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`)
		.join("\n");
	return `<!doctype html>
<html lang="en" data-story-id="${escapeHtml(rendered.id)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<base href="${escapeHtml(base)}">
${links}
<style>${TOKEN_STYLES}${STORY_STYLES}${CANVAS_STYLES}</style>
</head>
<body>
${storyBody(rendered)}
${scripts}
<script>${STORY_SCRIPT}</script>
</body>
</html>
`;
}

export type StoryDocumentFile = { path: string; contents: string };

/**
 * Every story of every component as a standalone document, named by story id.
 * Returned rather than written: the package stays pure over its input and the
 * caller owns its I/O — a build writes files, a dev server serves them from
 * memory.
 */
export function storyDocuments(
	components: { component: PreviewComponent; stories: RenderedStory[] }[],
	options: StoryDocumentOptions = {},
): StoryDocumentFile[] {
	return components.flatMap(({ component, stories }) =>
		stories.map((rendered) => ({
			path: `${rendered.id}.html`,
			contents: storyDocument(component, rendered, options),
		})),
	);
}
