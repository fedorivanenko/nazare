// The gallery shell: every component, every story, one page.
//
// The layout follows shadcn/ui's registry docs — sidebar, per-component
// Preview/Code tabs, an install command with a copy button, a props table. That
// is deliberate: Nazare's pitch is "shadcn/ui for Shopify", so the workbench
// should read like the thing it is modelled on. Tabs are CSS-only (radio
// inputs), so the page works with JavaScript disabled; the copy buttons, the
// theme toggle, and frame sizing are the only scripted parts, and each degrades
// to an inert control.
//
// Stories render one of two ways. Inline is the single-file mode: one document,
// no I/O, everything visible at once — and one shared cascade, so a component's
// global selector can restyle its neighbour. Passing `storyBase` switches to
// isolated frames, where each story is its own document (see story-document.ts)
// and the shell only embeds it. The rendered model is the same either way.
import { escapeHtml } from "./html.js";
import {
	renderCode,
	renderControlsJson,
	renderControlsTable,
	renderInstall,
	renderIssues,
	renderKindLine,
} from "./panels.js";
import type { RenderedComponent, RenderedStory } from "./render.js";
import { storyBody } from "./story-document.js";
import { componentId, storyFileName } from "./story-id.js";
import { FRAME_MESSAGE, TOKEN_STYLES } from "./theme.js";

const formatProps = (props: Record<string, unknown>): string =>
	Object.entries(props)
		.map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
		.join(", ");

/**
 * The stage: the story itself, inline or framed. A framed stage opens at a
 * placeholder height and is resized by the frame's own measurement, so a story
 * taller than the placeholder is not left clipped once it loads.
 */
function renderStage(rendered: RenderedStory, storyBase?: string): string {
	if (storyBase === undefined) {
		return `<div class="story-stage" id="${escapeHtml(rendered.id)}">${storyBody(rendered)}</div>`;
	}
	const src = `${storyBase}${storyFileName(rendered.id)}`;
	return `<iframe class="story-stage story-stage--frame" id="${escapeHtml(
		rendered.id,
	)}" src="${escapeHtml(src)}" title="${escapeHtml(
		rendered.story.name,
	)}" loading="lazy" data-story-frame="${escapeHtml(rendered.id)}"></iframe>`;
}

function renderStory(rendered: RenderedStory, storyBase?: string): string {
	const open =
		storyBase === undefined
			? ""
			: ` <a class="story-open" href="${escapeHtml(
					`${storyBase}${storyFileName(rendered.id)}`,
				)}" target="_blank" rel="noreferrer" title="Open this story on its own">open</a>`;
	return `
          <figure class="story">
            ${renderStage(rendered, storyBase)}
            <figcaption class="story-caption">
              <span class="story-name">${escapeHtml(rendered.story.name)}${
								rendered.story.fixtures
									? ' <span class="badge badge--fixture" title="Rendered against shared stand-in data, not storefront data">fixture</span>'
									: ""
							}${open}</span>
              ${rendered.story.note ? `<span class="story-note">${escapeHtml(rendered.story.note)}</span>` : ""}
              <code>${escapeHtml(formatProps(rendered.story.props))}</code>
              ${
								rendered.issues.length > 0
									? `<ul class="story-issues">${rendered.issues
											.map(
												(issue) =>
													`<li class="story-issue story-issue--${issue.severity}">${escapeHtml(issue.message)}</li>`,
											)
											.join("")}</ul>`
									: ""
							}
            </figcaption>
          </figure>`;
}

function renderComponent(
	{ component, stories }: RenderedComponent,
	storyBase?: string,
): string {
	const id = componentId(component.name);
	return `
      <section class="component" id="${id}">
        <div class="component-head">
          <h2>${escapeHtml(component.name)}</h2>
          ${renderKindLine(component)}
        </div>
        ${renderInstall(component)}
        ${renderIssues(component.issues)}
        <div class="tabs">
          <input class="tab-input" type="radio" name="tabs-${id}" id="tab-${id}-preview" checked>
          <input class="tab-input" type="radio" name="tabs-${id}" id="tab-${id}-code">
          <div class="tab-list" role="tablist">
            <label class="tab" for="tab-${id}-preview">Preview</label>
            <label class="tab" for="tab-${id}-code">Code</label>
          </div>
          <div class="tab-panel tab-panel--preview">
            <div class="stories">${stories
							.map((rendered) => renderStory(rendered, storyBase))
							.join("")}</div>
          </div>
          <div class="tab-panel tab-panel--code">
            ${renderCode(component)}
          </div>
        </div>
        ${renderControlsTable(component.controls)}
        ${renderControlsJson(component.controls)}
      </section>`;
}

const PAGE_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--background);
    color: var(--foreground);
    font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  code, pre, .type { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
  .muted { color: var(--muted-foreground); }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 1.5rem;
    height: 56px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--background) 88%, transparent);
    backdrop-filter: blur(8px);
  }
  .topbar strong { font-weight: 600; letter-spacing: -0.01em; }
  .topbar .muted { font-size: .8rem; }
  .theme-toggle {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--foreground);
    border-radius: calc(var(--radius) - 2px);
    height: 32px;
    padding: 0 .75rem;
    font-size: .8rem;
    cursor: pointer;
  }
  .theme-toggle:hover { background: var(--accent); }
  .shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 2.5rem; max-width: 1180px; margin: 0 auto; padding: 2rem 1.5rem 6rem; }
  .sidebar { position: sticky; top: 80px; align-self: start; }
  .sidebar h3 { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted-foreground); margin: 0 0 .6rem; }
  .sidebar ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .1rem; }
  .sidebar a { display: block; padding: .3rem .6rem; border-radius: calc(var(--radius) - 3px); color: var(--muted-foreground); text-decoration: none; font-size: .82rem; }
  .sidebar a:hover { background: var(--accent); color: var(--foreground); }
  .intro { margin-bottom: 2.5rem; }
  .intro h1 { font-size: 1.85rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 .5rem; }
  .intro p { margin: 0; color: var(--muted-foreground); max-width: 70ch; }
  .component { padding-top: 1rem; margin-bottom: 3.5rem; scroll-margin-top: 80px; }
  .component-head h2 { font-size: 1.15rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 .4rem; }
  .component-sub { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; margin: 0 0 1rem; font-size: .78rem; }
  .badge {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: .05rem .5rem;
    font-size: .7rem;
    background: var(--muted);
    color: var(--foreground);
  }
  .badge--muted { color: var(--muted-foreground); background: transparent; }
  .badge--fixture { font-size: .62rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted-foreground); background: transparent; }
  .badge--required { border-color: transparent; background: #fee2e2; color: #991b1b; }
  :root[data-theme="dark"] .badge--required { background: #450a0a; color: #fca5a5; }
  .install {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--code-bg);
    padding: .55rem .55rem .55rem .9rem;
    margin-bottom: 1rem;
    font-size: .82rem;
  }
  .copy {
    border: 1px solid var(--border);
    background: var(--background);
    color: var(--muted-foreground);
    border-radius: calc(var(--radius) - 3px);
    height: 28px;
    padding: 0 .6rem;
    font-size: .72rem;
    cursor: pointer;
  }
  .copy:hover { color: var(--foreground); background: var(--accent); }
  .tabs { display: grid; }
  .tab-input { position: absolute; opacity: 0; pointer-events: none; }
  .tab-list { display: flex; gap: .25rem; margin-bottom: .75rem; }
  .tab {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 .7rem;
    border-radius: calc(var(--radius) - 3px);
    font-size: .8rem;
    color: var(--muted-foreground);
    cursor: pointer;
    user-select: none;
  }
  .tab:hover { color: var(--foreground); }
  .tab-panel { display: none; }
  .tab-input:nth-of-type(1):checked ~ .tab-list .tab:nth-child(1),
  .tab-input:nth-of-type(2):checked ~ .tab-list .tab:nth-child(2) {
    background: var(--muted);
    color: var(--foreground);
    font-weight: 500;
  }
  .tab-input:nth-of-type(1):checked ~ .tab-panel--preview,
  .tab-input:nth-of-type(2):checked ~ .tab-panel--code { display: block; }
  .stories {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    padding: 1.25rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1rem;
  }
  .story { margin: 0; display: grid; gap: .6rem; }
  .story-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 150px;
    padding: 1.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    background:
      radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0) 0 0 / 16px 16px;
  }
  /* A frame carries its own padding and background: it is a whole document. */
  .story-stage--frame { display: block; width: 100%; height: 150px; padding: 0; }
  .story-caption { display: grid; gap: .15rem; font-size: .72rem; }
  .story-name { font-weight: 500; }
  .story-open { color: var(--muted-foreground); font-weight: 400; text-decoration: none; border-bottom: 1px dotted var(--border); }
  .story-open:hover { color: var(--foreground); }
  .story-note, .story-caption code { color: var(--muted-foreground); word-break: break-word; }
  .story-empty { color: var(--muted-foreground); font-style: italic; font-size: .78rem; }
  .story-error { color: #b91c1c; font-size: .78rem; }
  .story-issues { list-style: none; margin: .2rem 0 0; padding: 0; display: grid; gap: .15rem; font-size: .68rem; }
  .story-issue--warning { color: var(--muted-foreground); }
  .story-issue--error { color: #b91c1c; }
  .code { position: relative; border: 1px solid var(--border); border-radius: var(--radius); background: var(--code-bg); }
  .code .copy { position: absolute; top: .6rem; right: .6rem; }
  .code pre { margin: 0; padding: 1rem 1.1rem; overflow-x: auto; font-size: .78rem; line-height: 1.55; }
  .props { width: 100%; border-collapse: collapse; margin-top: 1.5rem; font-size: .8rem; }
  .props th, .props td { text-align: left; padding: .55rem .6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  .props th { font-weight: 500; color: var(--muted-foreground); font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; }
  .props .type { color: var(--muted-foreground); font-size: .75rem; }
  .empty-note { margin-top: 1.25rem; font-size: .8rem; color: var(--muted-foreground); }
  .issues { list-style: none; padding: 0; margin: 0 0 1rem; display: grid; gap: .3rem; font-size: .76rem; }
  .issue { border: 1px solid var(--border); border-radius: calc(var(--radius) - 3px); padding: .4rem .65rem; }
  .issue--error { border-color: #fca5a5; color: #b91c1c; }
  .issue--warning { color: var(--muted-foreground); }
  .preview-slot {
    border: 1px dashed var(--border);
    border-radius: calc(var(--radius) - 3px);
    padding: .75rem 1rem;
    color: var(--muted-foreground);
    font-size: .75rem;
  }
  @media (max-width: 860px) {
    .shell { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }
    .sidebar { position: static; }
  }
`;

const PAGE_SCRIPT = `
  const root = document.documentElement;
  const frames = () => document.querySelectorAll('[data-story-frame]');
  const currentTheme = () => root.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const tellFrame = (frame, theme) => {
    frame.contentWindow?.postMessage({ type: ${JSON.stringify(FRAME_MESSAGE.theme)}, theme }, '*');
  };

  const toggle = document.querySelector('[data-theme-toggle]');
  toggle?.addEventListener('click', () => {
    const theme = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    // Each story frame is its own document and cannot see this attribute.
    for (const frame of frames()) tellFrame(frame, theme);
  });

  // A lazily loaded frame arrives after the theme may already have changed.
  for (const frame of frames()) {
    frame.addEventListener('load', () => tellFrame(frame, currentTheme()));
  }

  // A frame measures itself and reports back, because the shell cannot read the
  // layout of a document it does not own.
  addEventListener('message', (event) => {
    if (event.data?.type !== ${JSON.stringify(FRAME_MESSAGE.height)}) return;
    if (!Number.isFinite(event.data.height)) return;
    const frame = document.querySelector('[data-story-frame="' + CSS.escape(String(event.data.id)) + '"]');
    if (frame) frame.style.height = Math.max(150, event.data.height) + 'px';
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const previous = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = previous; }, 1200);
    } catch {
      // Clipboard access can be denied (file:// in some browsers); the command
      // is selectable text either way, so there is nothing to recover.
    }
  });
`;

export type GalleryPageOptions = {
	title?: string;
	/** Stylesheets to link — the emitted assets/*.css the components ship. */
	stylesheets?: string[];
	/** Scripts to load as modules — emitted behaviors and the island runtime. */
	scripts?: string[];
	/**
	 * Where the isolated story documents live, e.g. `./stories/`. Set it and
	 * stories embed as frames instead of rendering into this document; leave it
	 * off for the single-file page. The trailing slash is the caller's, so a
	 * frontend can point at a server route (`/story/`) just as easily as a folder.
	 */
	storyBase?: string;
};

export function galleryPage(
	components: RenderedComponent[],
	options: GalleryPageOptions = {},
): string {
	const title = options.title ?? "Nazare preview";
	const links = (options.stylesheets ?? [])
		.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
		.join("\n");
	const scripts = (options.scripts ?? [])
		.map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`)
		.join("\n");
	const nav = components
		.map(
			({ component }) =>
				`<li><a href="#${componentId(component.name)}">${escapeHtml(component.name)}</a></li>`,
		)
		.join("");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${links}
<style>${TOKEN_STYLES}${PAGE_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <strong>${escapeHtml(title)}</strong>
    <button class="theme-toggle" type="button" data-theme-toggle>Theme</button>
  </header>
  <div class="shell">
    <nav class="sidebar">
      <h3>Components</h3>
      <ul>${nav}</ul>
    </nav>
    <main>
      <div class="intro">
        <h1>Components</h1>
        <p>
          Each story is the <strong>emitted</strong> Liquid rendered by liquidjs and styled by the
          emitted CSS — the Code tab shows exactly what a storefront receives. liquidjs is not
          Shopify's Liquid runtime, so this is a design-system workbench, not a substitute for a
          theme preview. Stories marked <span class="badge badge--fixture">fixture</span> render
          against shared stand-in data — a tidy catalogue with no missing fields and no long titles,
          which a real one will have.
        </p>
      </div>
      ${components
				.map((component) => renderComponent(component, options.storyBase))
				.join("")}
    </main>
  </div>
${scripts}
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}
