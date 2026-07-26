# @nazare/preview

A component workbench for Nazare and plain-Liquid components — Storybook's job,
with the stories' knobs derived from the compiler instead of hand-written.

```txt
source → compile (the real compiler) → emitted template + contract
       → controls → stories → render (Liquid) → gallery
```

Every pass is pure over its input, so a frontend picks the passes it needs and
owns its I/O: a static site imports `galleryPage`, a dev server imports
`renderComponentStories`, an editor panel imports `controlsFromContract` alone.

## Why the controls are free

Storybook makes you write `argTypes` by hand. A Nazare component already
declares them, and the compiler already produces the contract:

| Declared prop | Control |
| --- | --- |
| `scheme: string.enum("solid", "outline", "ghost")` | select over the three members |
| `columns: number.min(1).max(4).step(1)` | number with that range |
| `featured: boolean.setting({ label: "Featured" })` | checkbox labelled "Featured" |
| `label: string.required()` | text, marked required |

Defaults come from `.default(v)` or a setting's `default`, so a story opens on
the values the component actually ships with. For a section, the same pass
produces what the theme editor's settings panel would show.

## What it renders

The **emitted** template, never the authored source — what a storefront gets is
what the gallery shows, so a lowering bug is visible here rather than only on a
store. Emitted stylesheets and behavior modules come back as assets; wiring the
behaviors into the page makes island components genuinely interactive.

## One story, one document

Every story has an id — `button--scheme-outline`, derived from the component and
story names, so adding or reordering stories never renumbers the others.

`storyDocuments()` turns each rendered story into a standalone HTML page named by
that id, and `galleryPage(..., { storyBase: "./stories/" })` embeds those pages
as frames instead of rendering the markup inline. That is what Storybook's iframe
buys, and it is not cosmetic: forty components in one document share a cascade,
so a global selector in one component's stylesheet restyles its neighbour's
story, and emitted ids collide in one DOM. Framed, a story also has a URL that
opens on its own.

A story document links its own component's emitted CSS and nothing else. It
reports its height to the host page and follows the host's theme by
`postMessage`, because a frame is a separate document — opened directly, with no
host, it still renders and reads `?theme=dark`.

Leave `storyBase` off and the gallery is a single self-contained file again, with
the shared cascade that implies. Both modes render the same story model.

## Two shells

`workbenchPage()` is the one to work in: components on the left, one story in the
canvas. The component's stories are a dropdown beside the canvas, grouped by the
prop each one varies, and a viewport dropdown constrains the canvas to 375, 768,
or 1280 — the frame is a real document, so a narrower frame is a real viewport,
media queries included.

The story is a URL fragment (`#button--scheme-outline`) and the viewport a query
parameter (`?viewport=375`), so both survive a reload and a link, and changing
the story leaves the viewport alone. The sidebar entries are real links to story
documents, so with JavaScript off, clicking one opens that component on its own
rather than doing nothing.

`galleryPage()` is the catalogue: every story of every component at once, for a
sweep over the whole registry or for embedding in a docs site.

Both draw their per-component documentation — install command, diagnostics, props
table, emitted Liquid — from the same `panels.ts`.

## Previewing a plain theme

```sh
node packages/preview/examples/preview-theme.mjs path/to/theme
node packages/preview/examples/preview-theme.mjs packages/preview/fixtures/theme
```

`fixtures/theme` is a five-component theme kept here for exactly this: two
snippets declaring `{% doc %}` params, a section and a block declaring
`{% schema %}` settings, one authored story in a sidecar, and a stylesheet the
sections link through `asset_url`. Every one of its ten stories renders markup
with no error and nothing its declaration says is wrong, and `tests/theme.test.mjs`
holds that true — the plain-Liquid path claims to work on files nobody wrote for
Nazare, and this is the claim being checked.

No manifests, no Nazare syntax. The walk over `snippets/`, `sections/`, and
`blocks/` is the classification — Shopify addresses a theme file by its
directory, and the kind decides whether props arrive as bare variables or as
`section.settings.*`. Each file's controls come from its own `{% doc %}` params
or `{% schema %}` settings, the whole `snippets/` directory is in scope so
`{% render %}` resolves, and the theme's `assets/` are served where `asset_url`
points.

## Fixtures and authored stories

Storefront data lives in the preview, not in the components: one canonical mock
product, collection, image, and shop in `fixtures.ts`, plus the `money` and
`img_url` filters. If each component shipped its own mock product, forty
components would disagree about the shop they belong to.

Cases a type cannot express belong with the component, in its `nazare.json`:

```json
"preview": {
  "stories": [
    {
      "name": "on sale",
      "props": {
        "price": { "$fixture": "price" },
        "compare_at_price": { "$fixture": "compare_at_price" },
        "show_compare_at": true
      },
      "note": "Compare-at above the price, so the strikethrough shows."
    }
  ]
}
```

A theme has no `nazare.json`, so its stories live in a sidecar beside the
template — `product-card.stories.json` for `product-card.liquid` — in the same
shape, minus the manifest wrapper. The sidecar wins where both exist: the file
beside the template is the more local statement.

`{ "$fixture": "name" }` addresses the shared data. Authored stories **add** to
the derived set rather than replacing it, so writing one edge case does not
silently delete the enum coverage the contract gave you; a story named after a
derived one overrides it, which is how a component states a better default than
the type-shaped one. `"replace": true` drops the derived set entirely. A
component with no stories at all is still previewable from its contract.
Stories drawing on fixtures are badged in the gallery, because a fixture is tidy
in ways a real catalogue is not: no missing compare-at price, no 60-character
title, no sold-out variant.

## Stories are checked against the declaration

Liquid does not complain about a call that passes a prop the template never
reads, or omits one it needs: the value is nil, the markup is missing, and the
story looks plausible. So every story is checked against what the component
declares — an undeclared prop (usually a typo), a value outside an enum, a
number outside its range, a required prop nobody passed, a `$fixture` name that
does not exist.

These are warnings shown beside the render, not failures: a story that trips one
still renders, and the render is how you judge whether it matters. A component
that declares nothing — plain Liquid with no `{% doc %}` block — is not
second-guessed, because inferring an interface from the template's body would be
the preview inventing a contract nobody wrote.

## Architecture

### The spine

Each step is pure over its input:

```txt
source ──▶ compile ──▶ template + declaration ──▶ controls ──▶ stories ──▶ render ──▶ documents ──▶ shell
        (compiler)     (emitted Liquid;           (knobs)      (cases)   (liquidjs)  (one per      (page)
                        contract | doc | schema)                                      story)
```

Nothing in the package touches a filesystem, a server, or a clock. Every
function takes what it needs and returns a value, so the I/O belongs to the
caller — which is why the two runners live in `examples/` rather than in `src/`,
and why a dev server can reuse every pass unchanged.

### The passes

**Source → component.** `previewComponentFromSource(source, file, options)`
branches on the extension: `.nz.liquid` through `buildNazareThemeWorkspace` with
its import closure walked via `options.readFile`, anything else through
`buildPlainLiquid` and `collectPlainLiquidThemeFacts`.

```ts
type PreviewComponent = {
  name; file; packageId?;
  frontend: "nazare" | "plain";
  componentKind?: "snippet" | "section" | "block";  // decides the render scope
  template: string;        // emitted Liquid, not the source
  assets: PreviewAsset[];  // emitted stylesheets and behaviors
  contract?: ArtifactContract;
  controls: PreviewControl[];
  issues: Diagnostic[];    // compile diagnostics, reported and not thrown
};
```

**Declaration → controls.** Three sources, one shape:

| Frontend | Declaration | Pass |
| --- | --- | --- |
| Nazare | `{% props %}`, via the contract | `controlsFromContract` |
| Plain snippet | `{% doc %}` `@param` | `controlsFromDocParams` |
| Plain section | `{% schema %}` settings | `controlsFromSchemaSource` |

All three produce `PreviewControl { name, label, kind, required, options?,
range?, value, typeExpression }` — the argTypes equivalent, derived rather than
written.

**Controls → stories.** `generatedStories` is the defaults plus one story per
enum member. `storiesFor(component, manifest?, sidecar?)` layers the authored
cases on top. Names are unique in the result, which is what keeps story ids from
colliding.

**Stories → rendered.** `renderComponentStories(component, stories?, options)`
assigns each story its id, computes which props it `changed`, validates it
against the declaration, and renders it in the scope the kind dictates.

```ts
type RenderedStory = {
  id: string;          // "button--scheme-outline"
  story: PreviewStory; // { name, props, note?, fixtures? }
  html: string;
  changed: string[];
  issues: StoryIssue[];
  error?: string;      // a render that threw, reported in place
};
```

**Rendered → documents → shell.** `storyDocuments()` returns one standalone page
per story; `workbenchPage()` and `galleryPage()` return the shells that embed
them. All three return strings.

### Entry points

| To do this | Call |
| --- | --- |
| Preview one file | `previewComponentFromSource` |
| Take only the knobs, for an editor panel | `controlsFromContract`, `plainLiquidControls` |
| Render stories without a page | `renderComponentStories` |
| Render a template yourself | `createPreviewEngine`, `renderPreview` |
| Build a static site or serve a dev server | `storyDocuments`, `workbenchPage` |
| Sweep the whole registry at once | `galleryPage` |
| Check a story is well-formed | `validateStory` |
| Address a story in a URL, a file, a snapshot | `storyId`, `componentId`, `storyFileName` |
| Reach the shared storefront data | `shopifyFixtures`, `resolveFixtures` |

### Two boundaries

**The compiler.** The preview uses four entry points and no internals:
`buildNazareThemeWorkspace`, `buildPlainLiquid`, `parseNazareLiquid`,
`collectPlainLiquidThemeFacts`. No theme session stands up to preview one file.

**The browser.** A shell and a story frame are separate documents, and exchange
exactly two messages, both named in `theme.ts`:

- frame → shell: `nazare-preview:height`, because the shell cannot measure the
  layout of a document it does not own.
- shell → frame: `nazare-preview:theme`, because the frame cannot see the
  shell's `data-theme`.

The rest of the state is in the URL — the story in the fragment, the viewport in
the query — so a reload, a link, and a fresh tab all arrive at the same place.

### The files

```txt
component.ts         source → PreviewComponent
controls.ts          contract → controls
plain-controls.ts    doc params / schema settings → controls
stories.ts           controls + authored cases → stories
story-validation.ts  story vs. declaration → issues
engine.ts            liquidjs, plus the Shopify tags and filters it lacks
render.ts            stories → html
story-document.ts    one story → one standalone page
story-id.ts          identity: component, story, filename
workbench.ts         the shell to work in
gallery.ts           the whole-registry catalogue
fixtures.ts          shared storefront stand-in data
panels.ts            per-component documentation, shared by both shells
theme.ts, html.ts    shared tokens, frame messages, escaping
```

`examples/build-gallery.mjs` (the registry) and `examples/preview-theme.mjs` (any
theme directory) are pure I/O around the above, and the shape a `nazare preview`
command would take.

## What it is not

liquidjs implements the Liquid *language*; Shopify's runtime adds tags, filters,
and global objects on top of it. Those are stubbed here — visibly, in
`engine.ts`: `{% doc %}`, `{% schema %}`, `{% style %}`, `asset_url`,
`stylesheet_tag`, and `{% content_for %}`, which renders a labelled slot because
there are no merchant blocks to inject.

The two engines also diverge in ways that fail silently (a bare `size` lookup
resolves to the scope's size in liquidjs, to nil in Shopify). Treat the gallery
as a design-system workbench. It is not evidence that a template behaves on a
store — that still needs `shopify theme dev`.

## Try it

```sh
pnpm -s build
node packages/preview/examples/build-gallery.mjs
open .nazare-out/preview/index.html
```

Renders every component in `registry/components/`, writing the workbench to
`index.html`, the whole-registry catalogue to `all.html`, and one document per
story under `stories/`. Compile diagnostics are listed per component
rather than failing the page, and a story that throws reports its error in place
— in its own document, so the rest of the page is unaffected.
