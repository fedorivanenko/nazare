// The static gallery: every component, every story, rendered to one HTML page.
// No client JavaScript is required to read it — the stories are pre-rendered —
// but each component's controls ship as JSON so an interactive panel can be
// layered on later without changing this pass.
import type { Diagnostic } from "@nazare/core";
import type { PreviewComponent } from "./component.js";
import type { PreviewControl } from "./controls.js";
import { createPreviewEngine, renderPreview } from "./engine.js";
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
				html: await renderPreview(engine, component.template, story.props),
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

const formatProps = (props: Record<string, unknown>): string =>
	Object.entries(props)
		.map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
		.join(", ");

function renderControl(control: PreviewControl): string {
	const detail = control.options
		? control.options.join(" | ")
		: control.typeExpression;
	return `<li><code>${escapeHtml(control.name)}</code><span>${escapeHtml(
		detail,
	)}</span>${control.required ? '<em class="required">required</em>' : ""}</li>`;
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
	const props = formatProps(rendered.story.props);
	return `
      <div class="story">
        <div class="story-stage">${body}</div>
        <div class="story-meta">
          <span class="story-name">${escapeHtml(rendered.story.name)}</span>
          ${rendered.story.note ? `<p class="story-note">${escapeHtml(rendered.story.note)}</p>` : ""}
          <code>${escapeHtml(props)}</code>
        </div>
      </div>`;
}

function renderComponent({ component, stories }: RenderedComponent): string {
	const kind = component.componentKind ?? "plain Liquid";
	return `
    <article class="component">
      <header class="component-head">
        <h2>${escapeHtml(component.name)}</h2>
        <p class="component-meta">
          <span class="tag">${escapeHtml(kind)}</span>
          <span class="tag tag--muted">${escapeHtml(component.frontend)} frontend</span>
          <code>${escapeHtml(component.file)}</code>
        </p>
        ${renderIssues(component.issues)}
      </header>
      ${
				component.controls.length > 0
					? `<ul class="controls">${component.controls.map(renderControl).join("")}</ul>`
					: '<p class="controls-empty">No typed props — plain Liquid declares none.</p>'
			}
      <div class="stories">${stories.map(renderStory).join("")}</div>
      <script type="application/json" class="controls-json">${JSON.stringify(
				component.controls,
			).replace(/</g, "\\u003c")}</script>
    </article>`;
}

const PAGE_STYLES = `
  :root {
    --color-foreground: #111111;
    --color-background: #ffffff;
    --color-accent: #2563eb;
    --color-accent-foreground: #ffffff;
    --color-ring: #2563eb;
    --page-muted: #6b7280;
    --page-line: #e5e7eb;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2.5rem 1.5rem 5rem;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--color-foreground);
    background: #fafafa;
  }
  .page { max-width: 1080px; margin: 0 auto; }
  .page-head { margin-bottom: 2.5rem; }
  .page-head h1 { font-size: 1.6rem; margin: 0 0 .4rem; }
  .page-head p { margin: 0; color: var(--page-muted); max-width: 68ch; }
  .components { display: grid; gap: 2rem; }
  .component {
    background: var(--color-background);
    border: 1px solid var(--page-line);
    border-radius: 12px;
    padding: 1.5rem;
  }
  .component-head { border-bottom: 1px solid var(--page-line); padding-bottom: 1rem; margin-bottom: 1.25rem; }
  .component-head h2 { font-size: 1.05rem; margin: 0 0 .4rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .component-meta { margin: 0; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; font-size: .8rem; color: var(--page-muted); }
  .tag { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: .1rem .55rem; font-size: .72rem; }
  .tag--muted { background: #f3f4f6; color: #4b5563; }
  .controls { list-style: none; display: flex; flex-wrap: wrap; gap: .5rem; padding: 0; margin: 0 0 1.25rem; }
  .controls li { display: flex; gap: .4rem; align-items: baseline; border: 1px solid var(--page-line); border-radius: 8px; padding: .3rem .6rem; font-size: .75rem; }
  .controls code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .controls span { color: var(--page-muted); }
  .controls .required { color: #b91c1c; font-style: normal; font-size: .68rem; }
  .controls-empty { margin: 0 0 1.25rem; font-size: .8rem; color: var(--page-muted); }
  .issues { list-style: none; padding: 0; margin: .75rem 0 0; display: grid; gap: .25rem; font-size: .78rem; }
  .issue { padding: .35rem .6rem; border-radius: 6px; }
  .issue--error { background: #fef2f2; color: #991b1b; }
  .issue--warning { background: #fffbeb; color: #92400e; }
  .stories {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    align-items: flex-start;
    padding: 1.25rem;
    border: 1px dashed var(--page-line);
    border-radius: 10px;
  }
  .story { display: grid; gap: .5rem; min-width: 0; }
  .story-stage { min-height: 46px; display: flex; align-items: center; }
  .story-meta { display: grid; gap: .15rem; font-size: .75rem; }
  .story-name { font-weight: 600; }
  .story-note { margin: 0; color: var(--page-muted); max-width: 34ch; }
  .story-meta code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--page-muted); word-break: break-word; max-width: 34ch; }
  .story-empty { font-size: .8rem; color: var(--page-muted); font-style: italic; }
  .story-error { font-size: .8rem; color: #991b1b; }
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
  <div class="page">
    <header class="page-head">
      <h1>${escapeHtml(title)}</h1>
      <p>
        Every story is the <strong>emitted</strong> Liquid rendered by liquidjs and styled by the
        emitted CSS. liquidjs is not Shopify's Liquid runtime — storefront objects and filters are
        stubbed — so this is a design-system workbench, not a substitute for a theme preview.
      </p>
    </header>
    <div class="components">${components.map(renderComponent).join("")}</div>
  </div>
${scripts}
</body>
</html>
`;
}
