// The static gallery: every component, every story, rendered to one HTML page.
//
// The layout follows shadcn/ui's registry docs — sidebar, per-component
// Preview/Code tabs, an install command with a copy button, a props table. That
// is deliberate: Nazare's pitch is "shadcn/ui for Shopify", so the workbench
// should read like the thing it is modelled on. Tabs are CSS-only (radio
// inputs), so the page works with JavaScript disabled; the copy buttons and the
// theme toggle are the only scripted parts and both degrade to inert controls.
import type { Diagnostic } from "@nazare/core";
import type { PreviewComponent } from "./component.js";
import type { PreviewControl } from "./controls.js";
import { createPreviewEngine, renderContext, renderPreview } from "./engine.js";
import {
	changedProps,
	generatedStories,
	type PreviewStory,
} from "./stories.js";

export type RenderedStory = {
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
		const changed = changedProps(story, component.controls);
		try {
			rendered.push({
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
				story,
				changed,
				html: "",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { component, stories: rendered };
}

const escapeHtml = (value: string): string =>
	value.replace(
		/[&<>"]/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ??
			character,
	);

/** A DOM id for a component: its name is already unique per source folder. */
const slug = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

const formatValue = (value: unknown): string =>
	value === undefined ? "—" : JSON.stringify(value);

const formatProps = (props: Record<string, unknown>): string =>
	Object.entries(props)
		.map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
		.join(", ");

function copyButton(text: string, label = "Copy"): string {
	return `<button class="copy" type="button" data-copy="${escapeHtml(text)}" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

/** The props table, shadcn's docs shape: prop, type, default, required. */
function renderControlsTable(controls: PreviewControl[]): string {
	if (controls.length === 0) {
		return '<p class="empty-note">No typed props — plain Liquid declares none, so its stories supply their own values.</p>';
	}
	const rows = controls
		.map(
			(control) => `
            <tr>
              <td><code>${escapeHtml(control.name)}</code></td>
              <td><span class="type">${escapeHtml(
								control.options
									? control.options.map((option) => `"${option}"`).join(" | ")
									: control.typeExpression,
							)}</span></td>
              <td><code class="muted">${escapeHtml(formatValue(control.value))}</code></td>
              <td>${control.required ? '<span class="badge badge--required">required</span>' : '<span class="muted">—</span>'}</td>
            </tr>`,
		)
		.join("");
	return `
        <table class="props">
          <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Required</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
}

function renderIssues(issues: Diagnostic[]): string {
	const reportable = issues.filter((issue) => issue.severity !== "info");
	if (reportable.length === 0) return "";
	return `<ul class="issues">${reportable
		.map(
			(issue) =>
				`<li class="issue issue--${issue.severity}"><code>${escapeHtml(
					issue.code,
				)}</code> ${escapeHtml(issue.message)}</li>`,
		)
		.join("")}</ul>`;
}

function renderStory(rendered: RenderedStory): string {
	const body = rendered.error
		? `<span class="story-error">render failed: ${escapeHtml(rendered.error)}</span>`
		: rendered.html || '<span class="story-empty">renders nothing</span>';
	return `
          <figure class="story">
            <div class="story-stage">${body}</div>
            <figcaption class="story-caption">
              <span class="story-name">${escapeHtml(rendered.story.name)}</span>
              ${rendered.story.note ? `<span class="story-note">${escapeHtml(rendered.story.note)}</span>` : ""}
              <code>${escapeHtml(formatProps(rendered.story.props))}</code>
            </figcaption>
          </figure>`;
}

function renderComponent({ component, stories }: RenderedComponent): string {
	const id = slug(component.name);
	const kind = component.componentKind ?? "plain Liquid";
	const install = component.packageId
		? `nazare add ${component.packageId}`
		: undefined;
	return `
      <section class="component" id="${id}">
        <div class="component-head">
          <h2>${escapeHtml(component.name)}</h2>
          <p class="component-sub">
            <span class="badge">${escapeHtml(kind)}</span>
            <span class="badge badge--muted">${escapeHtml(component.frontend)}</span>
            <code class="muted">${escapeHtml(component.file)}</code>
          </p>
        </div>
        ${
					install
						? `<div class="install"><code>${escapeHtml(install)}</code>${copyButton(install)}</div>`
						: ""
				}
        ${renderIssues(component.issues)}
        <div class="tabs">
          <input class="tab-input" type="radio" name="tabs-${id}" id="tab-${id}-preview" checked>
          <input class="tab-input" type="radio" name="tabs-${id}" id="tab-${id}-code">
          <div class="tab-list" role="tablist">
            <label class="tab" for="tab-${id}-preview">Preview</label>
            <label class="tab" for="tab-${id}-code">Code</label>
          </div>
          <div class="tab-panel tab-panel--preview">
            <div class="stories">${stories.map(renderStory).join("")}</div>
          </div>
          <div class="tab-panel tab-panel--code">
            <div class="code">
              ${copyButton(component.template, "Copy")}
              <pre><code>${escapeHtml(component.template)}</code></pre>
            </div>
          </div>
        </div>
        ${renderControlsTable(component.controls)}
        <script type="application/json" class="controls-json">${JSON.stringify(
					component.controls,
				).replace(/</g, "\\u003c")}</script>
      </section>`;
}

const PAGE_STYLES = `
  :root {
    color-scheme: light;
    --background: #ffffff;
    --foreground: #09090b;
    --card: #ffffff;
    --muted: #f4f4f5;
    --muted-foreground: #71717a;
    --border: #e4e4e7;
    --accent: #f4f4f5;
    --code-bg: #fafafa;
    --radius: 0.65rem;
    /* Consumed by previewed components that theme off storefront tokens. */
    --color-foreground: var(--foreground);
    --color-background: var(--background);
    --color-accent: #2563eb;
    --color-accent-foreground: #ffffff;
    --color-ring: #2563eb;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --background: #09090b;
      --foreground: #fafafa;
      --card: #0c0c0f;
      --muted: #18181b;
      --muted-foreground: #a1a1aa;
      --border: #27272a;
      --accent: #18181b;
      --code-bg: #0c0c0f;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --background: #09090b;
    --foreground: #fafafa;
    --card: #0c0c0f;
    --muted: #18181b;
    --muted-foreground: #a1a1aa;
    --border: #27272a;
    --accent: #18181b;
    --code-bg: #0c0c0f;
  }
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
  .story-caption { display: grid; gap: .15rem; font-size: .72rem; }
  .story-name { font-weight: 500; }
  .story-note, .story-caption code { color: var(--muted-foreground); word-break: break-word; }
  .story-empty { color: var(--muted-foreground); font-style: italic; font-size: .78rem; }
  .story-error { color: #b91c1c; font-size: .78rem; }
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
  const toggle = document.querySelector('[data-theme-toggle]');
  toggle?.addEventListener('click', () => {
    const dark = root.getAttribute('data-theme') === 'dark'
      || (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
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
				`<li><a href="#${slug(component.name)}">${escapeHtml(component.name)}</a></li>`,
		)
		.join("");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${links}
<style>${PAGE_STYLES}</style>
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
          Shopify's Liquid runtime and storefront objects are stubbed, so this is a design-system
          workbench, not a substitute for a theme preview.
        </p>
      </div>
      ${components.map(renderComponent).join("")}
    </main>
  </div>
${scripts}
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}
