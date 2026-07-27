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
import { renderCall } from "./render-call.js";
import { componentId, storyFileName } from "./story-id.js";
import { BACKGROUNDS, FRAME_MESSAGE, TOKEN_STYLES } from "./theme.js";

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

/** Shared by both selectors: a link that selects a story. */
function storyLink(
	className: string,
	label: string,
	component: PreviewComponent,
	rendered: RenderedStory,
	storyBase: string,
	problems = 0,
): string {
	const href = `${storyBase}${storyFileName(rendered.id)}`;
	return `<a class="${className}" href="${escapeHtml(href)}" data-story="${escapeHtml(
		rendered.id,
	)}" data-component="${escapeHtml(componentId(component.name))}" data-name="${escapeHtml(
		rendered.story.name,
	)}">${escapeHtml(label)}${
		problems > 0
			? ` <span class="nav-flag" title="${problems} ${
					problems === 1 ? "story has" : "stories have"
				} a problem">${problems}</span>`
			: ""
	}</a>`;
}

/**
 * The sidebar lists components, not stories. A component's entry selects its
 * first story — the one at the declared defaults — and the variants of it live
 * next to the canvas, where they are a property of what you are looking at
 * rather than forty siblings competing in one list.
 */
function navComponent(
	{ component, stories }: RenderedComponent,
	storyBase: string,
): string {
	const first = stories[0];
	if (!first) {
		return `<li><span class="nav-component nav-component--empty">${escapeHtml(
			component.name,
		)}</span></li>`;
	}
	// How many of this component's stories have something wrong with them —
	// counted, not flagged. "!" says a problem exists somewhere in here; "3"
	// says how much of the component is affected, which is what decides whether
	// you look now or later. The count is also what the filter reads.
	const problems = stories.filter(
		(rendered) => rendered.error !== undefined || rendered.issues.length > 0,
	).length;
	return `<li data-problems="${problems}">${storyLink(
		"nav-component",
		component.name,
		component,
		first,
		storyBase,
		problems,
	)}</li>`;
}

/**
 * A component's stories, as one dropdown. A row of buttons reads as a set of
 * toggles, which these are not — a story is one choice among many, and eight of
 * them wrapped onto two lines before the canvas even appeared.
 *
 * Options are grouped by the prop the story varies, which the render already
 * computed (`changed`): a component whose stories walk one enum reads as a menu
 * of that prop's values rather than a flat list.
 *
 * A group of one is not a group — it is a heading over a single item, and
 * authored stories produce those constantly, since a hand-written case is
 * usually the only one that touches its prop. Those stay in the flat list.
 */
function substories({ component, stories }: RenderedComponent): string {
	const id = componentId(component.name);
	const varied = new Map<string, number>();
	for (const rendered of stories) {
		if (rendered.changed.length !== 1) continue;
		const prop = rendered.changed[0];
		varied.set(prop, (varied.get(prop) ?? 0) + 1);
	}
	const groups = new Map<string, RenderedStory[]>();
	for (const rendered of stories) {
		// A story that changed exactly one prop belongs to that prop, but only
		// where the prop has more than one story to gather.
		const prop = rendered.changed.length === 1 ? rendered.changed[0] : "";
		const group = (varied.get(prop) ?? 0) > 1 ? prop : "";
		groups.set(group, [...(groups.get(group) ?? []), rendered]);
	}
	// A story's state belongs on the story, not only on the component that holds
	// it: the dropdown is where you choose which one to look at.
	const option = (rendered: RenderedStory): string => {
		const state = rendered.error
			? " — failed"
			: rendered.issues.length > 0
				? ` — ${rendered.issues.length} issue${rendered.issues.length === 1 ? "" : "s"}`
				: "";
		return `<option value="${escapeHtml(rendered.id)}">${escapeHtml(
			rendered.story.name,
		)}${state}</option>`;
	};
	const options = [...groups]
		.map(([group, entries]) =>
			group === ""
				? entries.map(option).join("")
				: `<optgroup label="${escapeHtml(group)}">${entries.map(option).join("")}</optgroup>`,
		)
		.join("");
	// Inert without JavaScript, like every dropdown: the sidebar stays the
	// no-script path, since its entries are links to the story documents.
	return `<select class="substory-select" data-substories="${escapeHtml(
		id,
	)}" aria-label="Story" hidden>${options}</select>`;
}

/**
 * Viewport presets. A component is responsive or it is not, and the only way to
 * see which is to give the canvas a width — the frame is a real document, so
 * constraining the element it lives in is a real viewport, media queries and
 * all.
 */
const VIEWPORTS: { label: string; width: number | "" }[] = [
	{ label: "Full width", width: "" },
	{ label: "Mobile · 375", width: 375 },
	{ label: "Tablet · 768", width: 768 },
	{ label: "Laptop · 1280", width: 1280 },
];

/**
 * Zoom. A different question from the viewport: the viewport asks how the
 * component behaves at a width, zoom asks what a 14px label actually looks like
 * without leaning into the screen. Storybook keeps both, for the same reason.
 */
const ZOOMS = [0.5, 0.75, 1, 1.5, 2];

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
  /* Three columns: what to look at, the thing itself, what is known about it.
   * Either side collapses to nothing — a canvas the full width of the window is
   * the point of collapsing, so the columns go to zero rather than to a rail. */
  .workbench {
    display: grid;
    grid-template-columns: var(--sidebar-width, 240px) minmax(0, 1fr) var(--docs-width, 320px);
    height: calc(100% - 52px);
  }
  .workbench[data-sidebar="closed"] { --sidebar-width: 0px; }
  .workbench[data-docs="closed"] { --docs-width: 0px; }
  .sidebar, .docs { overflow-y: auto; }
  .workbench[data-sidebar="closed"] .sidebar,
  .workbench[data-docs="closed"] .docs { display: none; }
  .sidebar { border-right: 1px solid var(--border); padding: 1rem .75rem 3rem; }
  /* Documentation sits beside the render, not under it: scrolling away from the
   * thing you are reading about to find its props table was the old shape's
   * worst habit. */
  .docs { border-left: 1px solid var(--border); padding: 1rem 1rem 4rem; }
  .panel-toggle {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted-foreground);
    border-radius: calc(var(--radius) - 2px);
    height: 30px;
    padding: 0 .6rem;
    font-size: .74rem;
    cursor: pointer;
  }
  .panel-toggle[aria-pressed="true"] { background: var(--muted); color: var(--foreground); }
  .panel-toggle:hover { background: var(--accent); color: var(--foreground); }
  .topbar-tools { display: flex; align-items: center; gap: .4rem; }
  .sidebar-heading {
    margin: 0 0 .5rem;
    padding: 0 .5rem;
    font-size: .72rem;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--muted-foreground);
  }
  .sidebar ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .05rem; }
  .nav-component {
    display: block;
    padding: .3rem .5rem;
    border-radius: calc(var(--radius) - 3px);
    color: var(--muted-foreground);
    text-decoration: none;
    font-size: .85rem;
  }
  .nav-component:hover { background: var(--accent); color: var(--foreground); }
  .nav-component[aria-current="true"] { background: var(--muted); color: var(--foreground); font-weight: 500; }
  .nav-component--empty { color: var(--muted-foreground); opacity: .6; }
  /* A count, not a dot: how many of the component's stories are affected is
   * what decides whether you look now. */
  .nav-flag {
    float: right;
    min-width: 1.15rem;
    text-align: center;
    border-radius: 999px;
    background: #fee2e2;
    color: #991b1b;
    font-size: .68rem;
    font-weight: 600;
    line-height: 1.15rem;
  }
  :root[data-theme="dark"] .nav-flag { background: #450a0a; color: #fca5a5; }
  .sidebar-filter {
    display: flex;
    align-items: center;
    gap: .4rem;
    padding: 0 .5rem .6rem;
    font-size: .74rem;
    color: var(--muted-foreground);
    cursor: pointer;
  }
  .sidebar-empty { padding: .5rem; margin: 0; font-size: .75rem; color: var(--muted-foreground); }
  .sidebar-empty[hidden] { display: none; }
  .sidebar li[hidden] { display: none; }
  .canvas-tools { display: flex; align-items: center; gap: .4rem; }
  .substory-select, .viewport-select, .viewport-width {
    height: 30px;
    max-width: 260px;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    background: var(--background);
    color: var(--foreground);
    padding: 0 .5rem;
    font: inherit;
    font-size: .78rem;
  }
  /* The presets are the common widths; the field is the one you were actually
   * sent — a bug report says 414, not "mobile". */
  .viewport-size { display: inline-flex; align-items: center; gap: .3rem; }
  .viewport-x { color: var(--muted-foreground); font-size: .72rem; }
  .viewport-width { width: 4.5rem; font-variant-numeric: tabular-nums; }
  .viewport-width::-webkit-outer-spin-button,
  .viewport-width::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  /* The middle column is the viewport and nothing else: a story bar thin enough
   * to ignore, the stage, and whatever is wrong with the render. Everything a
   * knob used to occupy here now lives in the panel that has room for it. */
  .main { overflow-y: auto; display: flex; flex-direction: column; }
  .canvas-bar {
    flex: none;
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
  /* The stage holds the canvas at a viewport width, centred, with the edges
   * visible — a narrow frame in a wide stage should read as a device, not as a
   * layout bug. */
  .canvas-stage { flex: none; display: flex; justify-content: center; background: var(--muted); }
  .canvas {
    flex: none;
    width: 100%;
    min-height: 320px;
    border: 0;
    display: block;
    background: var(--background);
  }
  .canvas[data-viewport] { border-left: 1px solid var(--border); border-right: 1px solid var(--border); }
  /* The call that reproduces the story: the one thing on this page meant to be
   * copied out and pasted into a theme, so it sits directly under the render
   * rather than in the component panel below. */
  .call { margin: 0 0 .75rem; }
  .call[hidden] { display: none; }
  .call-label {
    margin: 0 0 .4rem;
    font-size: .68rem;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--muted-foreground);
  }
  /* The copy button floats over the code, so a call long enough to scroll must
   * not run under it — the reason the snippet reads as truncated otherwise. */
  .call .code { max-width: none; }
  .call pre { margin: 0; padding: .7rem 3.6rem .7rem .8rem; overflow-x: auto; font-size: .74rem; line-height: 1.5; }
  .story-props { margin: 0 0 1rem; font-size: .72rem; color: var(--muted-foreground); word-break: break-word; }
  .story-issues { list-style: none; margin: 0; padding: .5rem 1.25rem; display: grid; gap: .25rem; border-top: 1px solid var(--border); font-size: .76rem; }
  /* An explicit display beats the hidden attribute, so say it again. */
  .story-issues[hidden] { display: none; }
  .story-issue--warning { color: var(--muted-foreground); }
  .story-issue--warning::before { content: "warning "; text-transform: uppercase; font-size: .62rem; letter-spacing: .06em; }
  .story-issue--error { color: #b91c1c; }
  .story-issue--error::before { content: "error "; text-transform: uppercase; font-size: .62rem; letter-spacing: .06em; }
  .docs-heading {
    margin: 0 0 .75rem;
    font-size: .72rem;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--muted-foreground);
  }
  /* Three things live in this column — how the canvas is shown, the story in
   * it, the component it belongs to — each its own block with a rule between,
   * so the eye can find one without reading the others. */
  .docs-section + .docs-section { border-top: 1px solid var(--border); margin-top: 1.25rem; padding-top: 1.25rem; }
  .docs .caveat { padding: 1rem 0 0; border-top: 1px solid var(--border); margin-top: 1.25rem; }
  /* Label left, control right, one row each: nine knobs in a row across the
   * canvas was a toolbar in the one column with no room for it. */
  .settings {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    align-items: center;
    gap: .45rem .6rem;
  }
  .setting-label { font-size: .74rem; color: var(--muted-foreground); }
  .settings .viewport-select { width: 100%; max-width: none; }
  .setting-toggles { display: flex; gap: .35rem; }
  .setting-toggles .panel-toggle { flex: 1; }
  /* The panel is a column now, so everything in it that assumed 860px of width
   * has to give that up and scroll on its own instead. */
  .docs .props, .docs .install, .docs .code-details, .docs .issues { max-width: none; }
  .docs .props { display: block; overflow-x: auto; }
  .docs .install { flex-wrap: wrap; }
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
  const issueList = document.getElementById('canvas-issues');
  const viewport = document.getElementById('viewport');
  const background = document.getElementById('background');
  const zoom = document.getElementById('zoom');
  const outline = document.getElementById('outline');
  const call = document.getElementById('canvas-call');
  const callLabel = document.getElementById('canvas-call-label');
  const callCode = document.getElementById('canvas-call-code');
  const callCopy = document.getElementById('canvas-call-copy');
  const problemsOnly = document.getElementById('problems-only');
  const sidebarEmpty = document.getElementById('sidebar-empty');
  const workbench = document.getElementById('workbench');
  const widthField = document.getElementById('viewport-width');
  const heightField = document.getElementById('viewport-height');
  const measure = document.getElementById('measure');
  const themeSelect = document.getElementById('theme');
  const backgrounds = ${JSON.stringify(
		Object.fromEntries(BACKGROUNDS.map(({ id, css }) => [id, css])),
	)};
  // Every story by id: the dropdown offers stories the sidebar does not link,
  // so selection reads from this index rather than from the DOM.
  const stories = JSON.parse(document.getElementById('story-index').textContent);
  const firstId = Object.keys(stories)[0];
  const currentTheme = () => root.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const tellCanvas = (theme) => {
    canvas.contentWindow?.postMessage({ type: ${JSON.stringify(FRAME_MESSAGE.theme)}, theme }, '*');
  };
  // How the story is presented — ground, outline, zoom. Sent as one message so
  // a frame that just loaded gets the whole state rather than whichever pieces
  // changed since.
  const tellPresentation = () => {
    canvas.contentWindow?.postMessage({
      type: ${JSON.stringify(FRAME_MESSAGE.canvas)},
      background: backgrounds[background.value] ?? '',
      outline: outline.getAttribute('aria-pressed') === 'true',
      measure: measure.getAttribute('aria-pressed') === 'true',
      zoom: Number(zoom.value) || 1,
    }, '*');
  };

  // A pressed-state button that remembers itself. Which panels are open is a
  // workspace preference, not something you send someone, so it lives in
  // storage rather than in the URL beside the story.
  // Storage can throw outright — a file:// page, a browser with site data
  // blocked — and a preference that cannot be remembered is no reason for the
  // panel to stop opening.
  const remember = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  };
  function toggleButton(button, key, apply) {
    const stored = remember.get(key);
    const on = stored === null ? true : stored === '1';
    const set = (next) => {
      button.setAttribute('aria-pressed', String(next));
      remember.set(key, next ? '1' : '0');
      apply(next);
    };
    set(on);
    button.addEventListener('click', () => {
      set(button.getAttribute('aria-pressed') !== 'true');
    });
    return set;
  }
  const setSidebar = toggleButton(
    document.getElementById('toggle-sidebar'),
    'nazare-preview:sidebar',
    (open) => workbench.setAttribute('data-sidebar', open ? 'open' : 'closed'),
  );
  const setDocs = toggleButton(
    document.getElementById('toggle-docs'),
    'nazare-preview:docs',
    (open) => workbench.setAttribute('data-docs', open ? 'open' : 'closed'),
  );
  // Storybook's own keys, because anyone reaching for one is reaching for these.
  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const key = event.key.toLowerCase();
    if (key === 's') setSidebar(workbench.getAttribute('data-sidebar') === 'closed');
    else if (key === 'd') setDocs(workbench.getAttribute('data-docs') === 'closed');
  });

  function select(id, push) {
    const story = stories[id] ?? stories[firstId];
    if (!story) return;
    const storyId = stories[id] ? id : firstId;
    for (const link of links) {
      if (link.dataset.component === story.component) {
        link.setAttribute('aria-current', 'true');
      } else link.removeAttribute('aria-current');
    }
    // One dropdown per component; the selected component's is the visible one,
    // and it opens on the story being shown.
    for (const menu of document.querySelectorAll('[data-substories]')) {
      menu.hidden = menu.dataset.substories !== story.component;
      if (!menu.hidden) menu.value = storyId;
    }
    if (canvas.getAttribute('src') !== story.href) {
      // Height is stale until the new story measures itself; start from the
      // floor so a short story after a tall one does not leave a gap. A height
      // the viewer fixed is not stale, so it stays.
      if (!fixedHeight) canvas.style.height = '320px';
      canvas.setAttribute('src', story.href);
    }
    title.innerHTML = story.component + ' <span class="muted">/ ' + story.name + '</span>';
    openLink.setAttribute('href', story.href);
    propsLine.textContent = story.props;
    // What this story does not match about the declared interface. Rendering
    // did not stop for these, so they belong beside the render, not instead.
    issueList.replaceChildren(...story.issues.map((issue) => {
      const item = document.createElement('li');
      item.className = 'story-issue story-issue--' + issue.severity;
      item.textContent = issue.message;
      return item;
    }));
    issueList.hidden = story.issues.length === 0;
    // The line that reproduces this story in a theme — a render tag for a
    // snippet, a settings object for a section or a block.
    if (story.call) {
      callLabel.textContent = story.call.label;
      callCode.textContent = story.call.code;
      callCopy.dataset.copy = story.call.code;
      call.hidden = false;
    } else {
      call.hidden = true;
    }
    for (const panel of document.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== story.component;
    }
    if (push && location.hash.slice(1) !== storyId) {
      // Through URL, so the story replaces only the fragment and leaves the
      // query (the viewport) where it was.
      const url = new URL(location.href);
      url.hash = storyId;
      history.replaceState(null, '', url);
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
  for (const menu of document.querySelectorAll('[data-substories]')) {
    menu.addEventListener('change', () => select(menu.value, true));
  }

  // Viewport width. The frame is a real document, so narrowing the element it
  // lives in is a real viewport — media queries included.
  function setViewport(width, push) {
    // The presets and the field are two ways to say the same number, so both
    // always show it: a width typed by hand still reads as "Mobile · 375" if
    // that is what it is, and one that matches no preset reads as Custom.
    const known = [...viewport.options].some(
      (option) => option.value === String(width),
    );
    viewport.value = width ? (known ? String(width) : 'custom') : '';
    widthField.value = width || '';
    if (width) {
      canvas.style.maxWidth = width + 'px';
      canvas.setAttribute('data-viewport', width);
    } else {
      canvas.style.maxWidth = '';
      canvas.removeAttribute('data-viewport');
    }
    if (!push) return;
    // In the query, not the fragment: the fragment names the story, and a width
    // outlives which story you happen to be looking at.
    const url = new URL(location.href);
    if (width) url.searchParams.set('viewport', width);
    else url.searchParams.delete('viewport');
    history.replaceState(null, '', url);
  }
  viewport.addEventListener('change', () => {
    // "Custom…" is a prompt, not a width: it hands the field the focus and
    // leaves the canvas where it was.
    if (viewport.value === 'custom') {
      widthField.focus();
      widthField.select();
      return;
    }
    setViewport(viewport.value, true);
  });
  widthField.addEventListener('input', () => {
    const width = Number(widthField.value);
    if (widthField.value !== '' && !(width >= 200)) return;
    setViewport(widthField.value === '' ? '' : String(width), true);
  });

  /**
   * A fixed height, when you want one. Auto is the default and the honest
   * setting — the frame measures its own content and reports it — but a story
   * that has to sit in 600px on a phone is a real question, and answering it
   * means overriding what the content asked for.
   */
  let fixedHeight = '';
  function setHeight(height, push) {
    fixedHeight = height;
    heightField.value = height || '';
    if (height) canvas.style.height = height + 'px';
    if (push) writeQuery('h', height, '');
  }
  heightField.addEventListener('input', () => {
    const height = Number(heightField.value);
    if (heightField.value !== '' && !(height >= 120)) return;
    setHeight(heightField.value === '' ? '' : String(height), true);
  });
  setViewport(new URL(location.href).searchParams.get('viewport') ?? '', false);

  // Presentation lives in the query beside the viewport, for the same reason:
  // it outlives which story you happen to be looking at, and a link should
  // arrive showing what the sender was seeing.
  function writeQuery(key, value, fallback) {
    const url = new URL(location.href);
    if (value && value !== fallback) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    history.replaceState(null, '', url);
  }
  background.addEventListener('change', () => {
    writeQuery('bg', background.value, 'page');
    tellPresentation();
  });
  zoom.addEventListener('change', () => {
    writeQuery('zoom', zoom.value, '1');
    tellPresentation();
  });
  outline.addEventListener('click', () => {
    const on = outline.getAttribute('aria-pressed') !== 'true';
    outline.setAttribute('aria-pressed', String(on));
    writeQuery('outline', on ? '1' : '', '');
    tellPresentation();
  });
  measure.addEventListener('click', () => {
    const on = measure.getAttribute('aria-pressed') !== 'true';
    measure.setAttribute('aria-pressed', String(on));
    writeQuery('measure', on ? '1' : '', '');
    tellPresentation();
  });

  const params = new URL(location.href).searchParams;
  if (backgrounds[params.get('bg')] !== undefined) background.value = params.get('bg');
  if (params.get('zoom')) zoom.value = params.get('zoom');
  outline.setAttribute('aria-pressed', String(params.get('outline') === '1'));
  measure.setAttribute('aria-pressed', String(params.get('measure') === '1'));
  if (params.get('h')) setHeight(params.get('h'), false);

  // Which components have a story with something wrong with it. The counts are
  // already in the markup, so the filter is a read of the DOM rather than a
  // second source of truth.
  function applyFilter() {
    const only = problemsOnly.checked;
    let shown = 0;
    for (const item of document.querySelectorAll('#component-list [data-problems]')) {
      const hide = only && item.dataset.problems === '0';
      item.hidden = hide;
      if (!hide) shown += 1;
    }
    sidebarEmpty.hidden = shown > 0;
    writeQuery('problems', only ? '1' : '', '');
  }
  problemsOnly.checked = params.get('problems') === '1';
  problemsOnly.addEventListener('change', applyFilter);
  applyFilter();

  addEventListener('hashchange', () => select(location.hash.slice(1), false));
  canvas.addEventListener('load', () => {
    tellCanvas(currentTheme());
    tellPresentation();
  });
  select(location.hash.slice(1), true);

  // Three states, not two: a toggle cannot say "follow the OS", which is the
  // one a designer checking both wants to return to.
  function setTheme(theme, push) {
    themeSelect.value = theme;
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    tellCanvas(currentTheme());
    if (push) writeQuery('theme', theme, '');
  }
  themeSelect.addEventListener('change', () => setTheme(themeSelect.value, true));
  setTheme(
    params.get('theme') === 'dark' || params.get('theme') === 'light'
      ? params.get('theme')
      : '',
    false,
  );

  addEventListener('message', (event) => {
    if (event.data?.type !== ${JSON.stringify(FRAME_MESSAGE.height)}) return;
    if (!Number.isFinite(event.data.height)) return;
    // A height the viewer asked for outranks the one the content reports.
    if (fixedHeight) return;
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

/**
 * The caption under the canvas: what this story passed. A fixture serialises to
 * several kilobytes of product JSON, which buries the props that matter, so a
 * value that is not a scalar is named rather than printed.
 */
const formatProps = (props: Record<string, unknown>): string =>
	Object.entries(props)
		.map(([name, value]) => {
			if (value !== null && typeof value === "object") {
				return `${name}: ${Array.isArray(value) ? "[…]" : "{…}"}`;
			}
			const printed = JSON.stringify(value) ?? "";
			return `${name}: ${printed.length > 60 ? `${printed.slice(0, 57)}…` : printed}`;
		})
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
	// Every story by id — what the canvas needs to show one: which component it
	// belongs to, its name, its document, and the props it rendered with.
	const storyIndex = Object.fromEntries(
		components.flatMap(({ component, stories }) =>
			stories.map((rendered) => {
				const call = renderCall(component, rendered.story);
				return [
					rendered.id,
					{
						component: componentId(component.name),
						name: rendered.story.name,
						href: `${storyBase}${storyFileName(rendered.id)}`,
						props: formatProps(rendered.story.props),
						issues: rendered.issues,
						// What reproduces this story in a theme. A property of the story,
						// not of the component, so it rides in the index rather than in the
						// component's panel.
						...(call ? { call } : {}),
					},
				];
			}),
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
    <div class="topbar-tools">
      <button class="panel-toggle" type="button" id="toggle-sidebar" aria-pressed="true" title="Show or hide the component list (S)">◧ Components</button>
      <strong>${escapeHtml(title)}</strong>
    </div>
    <div class="topbar-tools">
      <select class="viewport-select" id="theme" aria-label="Theme">
        <option value="">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <button class="panel-toggle" type="button" id="toggle-docs" aria-pressed="true" title="Show or hide the documentation panel (D)">Docs ◨</button>
    </div>
  </header>
  <div class="workbench" id="workbench" data-sidebar="open" data-docs="open">
    <nav class="sidebar" aria-label="Components">
      <p class="sidebar-heading">Components</p>
      <label class="sidebar-filter">
        <input type="checkbox" id="problems-only">
        Problems only
      </label>
      <ul id="component-list">${components
				.map((component) => navComponent(component, storyBase))
				.join("")}</ul>
      <p class="sidebar-empty" id="sidebar-empty" hidden>Nothing here has a problem.</p>
    </nav>
    <main class="main">
      <div class="canvas-bar">
        <span class="canvas-title" id="canvas-title"></span>
        <div class="canvas-tools">
          ${components.map((component) => substories(component)).join("")}
          <a class="canvas-open" id="canvas-open" href="${escapeHtml(storyBase)}" target="_blank" rel="noreferrer">Open ↗</a>
        </div>
      </div>
      <div class="canvas-stage"><iframe class="canvas" id="canvas" title="Story canvas"></iframe></div>
      <ul class="story-issues" id="canvas-issues" hidden></ul>
    </main>
    <aside class="docs" aria-label="Canvas settings and documentation">
      <section class="docs-section">
        <p class="docs-heading">Canvas</p>
        <div class="settings">
          <span class="setting-label">Viewport</span>
          <select class="viewport-select" id="viewport" aria-label="Viewport">
            ${VIEWPORTS.map(
							({ label, width }) =>
								`<option value="${width}">${escapeHtml(label)}</option>`,
						).join("")}
            <option value="custom">Custom…</option>
          </select>

          <span class="setting-label">Size</span>
          <span class="viewport-size">
            <input class="viewport-width" id="viewport-width" type="number" min="200" max="3840" step="1" inputmode="numeric" placeholder="auto" aria-label="Width in pixels">
            <span class="viewport-x">×</span>
            <input class="viewport-width" id="viewport-height" type="number" min="120" max="4320" step="1" inputmode="numeric" placeholder="auto" aria-label="Height in pixels">
          </span>

          <span class="setting-label">Background</span>
          <select class="viewport-select" id="background" aria-label="Background">
            ${BACKGROUNDS.map(
							({ id, label }) =>
								`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`,
						).join("")}
          </select>

          <span class="setting-label">Zoom</span>
          <select class="viewport-select" id="zoom" aria-label="Zoom">
            ${ZOOMS.map(
							(zoom) =>
								`<option value="${zoom}"${zoom === 1 ? " selected" : ""}>${Math.round(
									zoom * 100,
								)}%</option>`,
						).join("")}
          </select>

          <span class="setting-label">Inspect</span>
          <span class="setting-toggles">
            <button class="panel-toggle" type="button" id="outline" aria-pressed="false">Outline</button>
            <button class="panel-toggle" type="button" id="measure" aria-pressed="false" title="Hover an element to see its box">Measure</button>
          </span>
        </div>
      </section>

      <section class="docs-section">
        <p class="docs-heading">Story</p>
        <div class="call" id="canvas-call" hidden>
          <p class="call-label"><span id="canvas-call-label"></span></p>
          <div class="code">
            <button class="copy" type="button" id="canvas-call-copy" data-copy="" aria-label="Copy">Copy</button>
            <pre><code id="canvas-call-code"></code></pre>
          </div>
        </div>
        <p class="story-props" id="canvas-props"></p>
      </section>

      <section class="docs-section">
        <p class="docs-heading">Component</p>
        ${components.map(panel).join("")}
      </section>

      <p class="caveat">
        The <strong>emitted</strong> Liquid, rendered by liquidjs — not Shopify's runtime. A design-system
        workbench, not evidence a template behaves on a store.
      </p>
    </aside>
  </div>
<script type="application/json" id="story-index">${JSON.stringify(storyIndex).replace(/</g, "\\u003c")}</script>
<script>${WORKBENCH_SCRIPT}</script>
</body>
</html>
`;
}
