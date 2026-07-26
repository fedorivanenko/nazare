// The workbench shell: a story list on the left, one story in the canvas.
//
// The gallery renders every story of every component into one long page, which
// is a fine catalogue and a poor place to look at a component: a section gets a
// 260px grid cell, and forty stories compete for the same screen. Storybook's
// shape — pick a story, see that story — is the one that suits work, so this
// shell shows exactly one story at a time, full width, in a frame.
//
// Selection is a URL fragment (`#button--scheme-outline`), so a story survives
// reload and can be linked. Without JavaScript the sidebar is still a list of
// links to the story documents themselves: clicking one leaves the shell and
// opens the story on its own, which is the honest degraded behaviour rather
// than a dead page.
import type { PreviewComponent } from "./component.js";
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
import { componentId, storyFileName } from "./story-id.js";
import { FRAME_MESSAGE, TOKEN_STYLES } from "./theme.js";

export type WorkbenchPageOptions = {
	title?: string;
	/**
	 * Where the story documents live, e.g. `./stories/`. Required in spirit: the
	 * workbench has nothing to show without them, so it defaults to the layout
	 * `storyDocuments()` writes.
	 */
	storyBase?: string;
	/** Stylesheets for the shell itself, not for the stories. */
	stylesheets?: string[];
};

function navStory(
	component: PreviewComponent,
	rendered: RenderedStory,
	storyBase: string,
): string {
	const href = `${storyBase}${storyFileName(rendered.id)}`;
	return `<li><a class="nav-story" href="${escapeHtml(href)}" data-story="${escapeHtml(
		rendered.id,
	)}" data-component="${escapeHtml(componentId(component.name))}" data-name="${escapeHtml(
		rendered.story.name,
	)}">${escapeHtml(rendered.story.name)}${
		rendered.error
			? ' <span class="nav-flag" title="This story failed to render">!</span>'
			: ""
	}</a></li>`;
}

function navComponent(
	{ component, stories }: RenderedComponent,
	storyBase: string,
): string {
	return `
      <div class="nav-group">
        <p class="nav-component">${escapeHtml(component.name)}</p>
        <ul>${stories
					.map((rendered) => navStory(component, rendered, storyBase))
					.join("")}</ul>
      </div>`;
}

/** One component's documentation, shown when a story of it is selected. */
function panel({ component }: RenderedComponent): string {
	const id = componentId(component.name);
	return `
        <section class="panel" data-panel="${escapeHtml(id)}" hidden>
          ${renderKindLine(component)}
          ${renderInstall(component)}
          ${renderIssues(component.issues)}
          ${renderControlsTable(component.controls)}
          <details class="code-details">
            <summary>Emitted Liquid</summary>
            ${renderCode(component)}
          </details>
          ${renderControlsJson(component.controls)}
        </section>`;
}

const WORKBENCH_STYLES = `
  * { box-sizing: border-box; }
  html, body { height: 100%; }
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 1rem;
    height: 52px;
    border-bottom: 1px solid var(--border);
  }
  .topbar strong { font-weight: 600; letter-spacing: -0.01em; }
  .theme-toggle, .canvas-open {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--foreground);
    border-radius: calc(var(--radius) - 2px);
    height: 30px;
    padding: 0 .7rem;
    font-size: .78rem;
    line-height: 28px;
    text-decoration: none;
    cursor: pointer;
  }
  .theme-toggle:hover, .canvas-open:hover { background: var(--accent); }
  .workbench { display: grid; grid-template-columns: 240px minmax(0, 1fr); height: calc(100% - 52px); }
  .sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 1rem .75rem 3rem; }
  .nav-group { margin-bottom: .9rem; }
  .nav-component {
    margin: 0 0 .25rem;
    padding: 0 .5rem;
    font-size: .72rem;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--muted-foreground);
  }
  .sidebar ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .05rem; }
  .nav-story {
    display: block;
    padding: .25rem .5rem;
    border-radius: calc(var(--radius) - 3px);
    color: var(--muted-foreground);
    text-decoration: none;
    font-size: .82rem;
  }
  .nav-story:hover { background: var(--accent); color: var(--foreground); }
  .nav-story[aria-current="true"] { background: var(--muted); color: var(--foreground); font-weight: 500; }
  .nav-flag { color: #b91c1c; font-weight: 600; }
  .main { overflow-y: auto; display: flex; flex-direction: column; }
  .canvas-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: .6rem 1.25rem;
    border-bottom: 1px solid var(--border);
    font-size: .82rem;
  }
  .canvas-title { font-weight: 500; }
  .canvas-title .muted { font-weight: 400; }
  .canvas { flex: 0 0 auto; width: 100%; min-height: 320px; border: 0; display: block; background: var(--background); }
  .story-props { padding: .5rem 1.25rem; font-size: .72rem; color: var(--muted-foreground); border-top: 1px solid var(--border); word-break: break-word; }
  .panels { border-top: 1px solid var(--border); padding: 1.25rem 1.25rem 4rem; }
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
    max-width: 640px;
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
  .props { width: 100%; max-width: 860px; border-collapse: collapse; font-size: .8rem; }
  .props th, .props td { text-align: left; padding: .55rem .6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  .props th { font-weight: 500; color: var(--muted-foreground); font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; }
  .props .type { color: var(--muted-foreground); font-size: .75rem; }
  .empty-note { font-size: .8rem; color: var(--muted-foreground); }
  .issues { list-style: none; padding: 0; margin: 0 0 1rem; display: grid; gap: .3rem; font-size: .76rem; max-width: 860px; }
  .issue { border: 1px solid var(--border); border-radius: calc(var(--radius) - 3px); padding: .4rem .65rem; }
  .issue--error { border-color: #fca5a5; color: #b91c1c; }
  .issue--warning { color: var(--muted-foreground); }
  .code-details { margin-top: 1.5rem; max-width: 860px; }
  .code-details summary { cursor: pointer; font-size: .8rem; color: var(--muted-foreground); margin-bottom: .6rem; }
  .code { position: relative; border: 1px solid var(--border); border-radius: var(--radius); background: var(--code-bg); }
  .code .copy { position: absolute; top: .6rem; right: .6rem; }
  .code pre { margin: 0; padding: 1rem 1.1rem; overflow-x: auto; font-size: .78rem; line-height: 1.55; }
  .caveat { padding: .6rem 1.25rem; font-size: .74rem; color: var(--muted-foreground); border-top: 1px solid var(--border); }
  @media (max-width: 720px) {
    .workbench { grid-template-columns: minmax(0, 1fr); height: auto; }
    .sidebar { border-right: 0; border-bottom: 1px solid var(--border); max-height: 40vh; }
  }
`;

const WORKBENCH_SCRIPT = `
  const root = document.documentElement;
  const canvas = document.getElementById('canvas');
  const links = [...document.querySelectorAll('[data-story]')];
  const title = document.getElementById('canvas-title');
  const openLink = document.getElementById('canvas-open');
  const propsLine = document.getElementById('canvas-props');
  const props = JSON.parse(document.getElementById('story-props').textContent);
  const currentTheme = () => root.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const tellCanvas = (theme) => {
    canvas.contentWindow?.postMessage({ type: ${JSON.stringify(FRAME_MESSAGE.theme)}, theme }, '*');
  };

  function select(id, push) {
    const link = links.find((candidate) => candidate.dataset.story === id) ?? links[0];
    if (!link) return;
    for (const candidate of links) candidate.removeAttribute('aria-current');
    link.setAttribute('aria-current', 'true');
    if (canvas.getAttribute('src') !== link.getAttribute('href')) {
      // Height is stale until the new story measures itself; start from the
      // floor so a short story after a tall one does not leave a gap.
      canvas.style.height = '320px';
      canvas.setAttribute('src', link.getAttribute('href'));
    }
    title.innerHTML = link.dataset.component + ' <span class="muted">/ ' + link.dataset.name + '</span>';
    openLink.setAttribute('href', link.getAttribute('href'));
    propsLine.textContent = props[link.dataset.story] ?? '';
    for (const panel of document.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== link.dataset.component;
    }
    if (push && location.hash.slice(1) !== link.dataset.story) {
      history.replaceState(null, '', '#' + link.dataset.story);
    }
  }

  // The sidebar is a list of real links, so it works without this script. With
  // it, a click swaps the canvas instead of leaving the shell.
  for (const link of links) {
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      select(link.dataset.story, true);
    });
  }
  addEventListener('hashchange', () => select(location.hash.slice(1), false));
  canvas.addEventListener('load', () => tellCanvas(currentTheme()));
  select(location.hash.slice(1), true);

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const theme = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    tellCanvas(theme);
  });

  addEventListener('message', (event) => {
    if (event.data?.type !== ${JSON.stringify(FRAME_MESSAGE.height)}) return;
    if (!Number.isFinite(event.data.height)) return;
    canvas.style.height = Math.max(320, event.data.height) + 'px';
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
      // Clipboard access can be denied; the command is selectable text anyway.
    }
  });
`;

const formatProps = (props: Record<string, unknown>): string =>
	Object.entries(props)
		.map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
		.join(", ");

export function workbenchPage(
	components: RenderedComponent[],
	options: WorkbenchPageOptions = {},
): string {
	const title = options.title ?? "Nazare workbench";
	const storyBase = options.storyBase ?? "./stories/";
	const links = (options.stylesheets ?? [])
		.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
		.join("\n");
	// The props of every story, so the caption under the canvas needs no fetch.
	const storyProps = Object.fromEntries(
		components.flatMap(({ stories }) =>
			stories.map((rendered) => [
				rendered.id,
				formatProps(rendered.story.props),
			]),
		),
	);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${links}
<style>${TOKEN_STYLES}${WORKBENCH_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <strong>${escapeHtml(title)}</strong>
    <button class="theme-toggle" type="button" data-theme-toggle>Theme</button>
  </header>
  <div class="workbench">
    <nav class="sidebar" aria-label="Stories">
      ${components
				.map((component) => navComponent(component, storyBase))
				.join("")}
    </nav>
    <main class="main">
      <div class="canvas-bar">
        <span class="canvas-title" id="canvas-title"></span>
        <a class="canvas-open" id="canvas-open" href="${escapeHtml(storyBase)}" target="_blank" rel="noreferrer">Open ↗</a>
      </div>
      <iframe class="canvas" id="canvas" title="Story canvas"></iframe>
      <p class="story-props" id="canvas-props"></p>
      <p class="caveat">
        The <strong>emitted</strong> Liquid, rendered by liquidjs — not Shopify's runtime. A design-system
        workbench, not evidence a template behaves on a store.
      </p>
      <div class="panels">
        ${components.map(panel).join("")}
      </div>
    </main>
  </div>
<script type="application/json" id="story-props">${JSON.stringify(storyProps).replace(/</g, "\\u003c")}</script>
<script>${WORKBENCH_SCRIPT}</script>
</body>
</html>
`;
}
