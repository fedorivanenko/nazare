# @nazare/preview

A component workbench for Nazare and plain-Liquid components — Storybook's job,
with the stories' knobs derived from the compiler instead of hand-written.

```txt
source → compile (the real compiler) → emitted template + contract
       → controls ─┐
story file ────────┴→ stories → render (Liquid) → gallery
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

Defaults come from `.default(v)` or a setting's `default`, so a story that says
nothing about a prop renders on the value the component actually ships with. For
a section, the same pass produces what the theme editor's settings panel would
show.

Reading a declaration an author wrote is not the same as inventing one. The
controls are derived; the *cases* are not — those are written down, in a story
file, as described below.

## What it renders

The **emitted** template, never the authored source — what a storefront gets is
what the gallery shows, so a lowering bug is visible here rather than only on a
store. Emitted stylesheets and behavior modules come back as assets; wiring the
behaviors into the page makes island components genuinely interactive.

## One story, one document

Every story has an id — `button--outline`, derived from the component and
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
canvas, the component's documentation on the right. The component's stories are a dropdown beside the canvas, grouped by the
prop each one varies, and a viewport dropdown constrains the canvas to 375, 768,
or 1280 — the frame is a real document, so a narrower frame is a real viewport,
media queries included.

The presets sit next to plain px fields for width and height, because the size
in a bug report is 414, not "mobile". Height is auto by default — the frame
measures its own content and reports it — and a number typed there outranks
that, for the times the question is whether a section fits in 600px. Beside them are the other questions you ask of a component
you are looking at: **background** (page, white, dark, grey, or a checkerboard,
because alpha reads as opaque against anything flat), **zoom**, **outline**,
which draws every box so a spacing bug stops hiding, and **measure**, which on
hover reports the box a element actually occupies — the numbers the browser
computed, not the ones the stylesheet asked for, so a padding that lost to a
more specific rule shows up here and nowhere else. Background, outline and measure are applied inside the frame, since the frame
owns that document's rendering — one `postMessage`, resent whenever a story
loads.

Zoom is the exception, and deliberately so: it scales the whole frame from the
outside, as one picture, rather than the elements inside it. Scaling within the
document would re-lay-out the story, so 50% would show a double-width layout
instead of the same layout drawn smaller — and "what does this look like,
larger" is the question zoom exists to answer. A wrapper reserves the scaled
size, since a transform takes up no space of its own.

A preset means what it says: `Mobile · 375` lays out at 375 at every scale, so
media queries stay honest and only the picture changes size. **Full width** has
no number of its own — it is however much room the stage has — so it follows the
zoom instead: at 50% the frame lays out twice as wide and still fills the stage,
which is how you look at a wide layout without a wide window.

Theme is three states rather than a toggle: Light, Dark, and System. A toggle
cannot say "follow the OS", which is the one a designer checking both wants to
get back to.

Three columns — components, the render, the documentation — and **both sides
collapse**, to `S` and `D` or their buttons, because a canvas the full width of
the window is the point of collapsing them. That state is a workspace
preference rather than something you send someone, so it lives in
`localStorage` while everything shareable lives in the URL.

The split is by what a thing acts on. The middle column holds the story and
everything that changes how it is drawn — viewport, size, background, zoom,
outline, measure — as a toolbar above the stage, wrapping rather than cramming.
The right column holds what is known *about* what you are looking at: **Story**
(the call that reproduces it, the props it passed) and **Component** (kind,
install command, diagnostics, props table, emitted Liquid).

A control that changes the canvas belongs with the canvas; a fact about the
component belongs in the column you read.

The canvas sits inset on the stage, with its own border and shadow, because a
frame that runs edge to edge butts against the sidebar's border and reads as a
continuation of the panel beside it rather than as the separate surface it is.
The middle column also has a floor, and there is deliberately no stacking
breakpoint. Two fixed side columns against a `1fr` middle means the viewport is
what gives way when the window narrows, and stacking the three columns puts the
story below a panel and off the screen — both arrangements lose the one thing
you came to look at. So a side panel closes instead: the documentation below
940px, the component list below 620px. A panel shut that way is not a
remembered one, so widening the window brings it back exactly as it was.

The layout is CSS — one `grid-template-columns` on `.workbench`, collapsing to
`0px` per side. The state is JavaScript: every component's panel is in the DOM
at once and toggled with `hidden`, and selection reads the `#story-index` JSON.
No framework, and nothing is rendered in the browser.

Under the canvas is **the call that reproduces this story in a theme**:

```liquid
{% render 'price', price: 2400, compare_at_price: 4000 %}
```

A snippet is reached by `{% render %}`; a section or a block is placed, so what
you get is the settings object a template's JSON holds. It is built from the
story's own delta, which is exactly what a caller has to write — anything the
story omits is already the component's default, and repeating it in the call
would be noise a merchant has to maintain. This is the one thing on the page
meant to be copied out, so it sits with the render rather than in the panel
below. A component the preview cannot classify gets no snippet at all: a wrong
call behind a copy button is worse than no call.

The story is a URL fragment (`#button--outline`); the viewport, background,
zoom, outline, and the sidebar filter are query parameters
(`?viewport=375&bg=dark&outline=1`). So all of it survives a reload and a link,
a shared URL arrives showing what the sender was seeing, and changing the story
leaves the presentation alone. The sidebar entries are real links to story
documents, so with JavaScript off, clicking one opens that component on its own
rather than doing nothing.

The sidebar counts each component's problem stories — how many, not whether,
since that is what decides whether you look now — and **Problems only** filters
to them. The story dropdown says which ones (`typo — 2 issues`, `broken —
failed`), so a template rename that breaks nine stories is navigable rather than
just loud.

The header carries what the page was built from: the directory as the caller
named it, then the branch and short commit, with `*` for uncommitted changes in
the previewed files. A built workbench outlives its checkout — deployed, linked,
opened days later — and "is this current?" otherwise has no answer anywhere on
the page. Every part is optional, because a theme outside a repository has a
path and nothing else.

`galleryPage()` is the catalogue: every story of every component at once, for a
sweep over the whole registry or for embedding in a docs site.

Both draw their per-component documentation — install command, diagnostics, props
table, emitted Liquid — from the same `panels.ts`.

## Previewing a plain theme

```sh
nazare preview serve path/to/theme     # rebuilds as you type
nazare preview check path/to/theme
nazare preview build path/to/theme
```

`fixtures/theme` is the theme kept here for exactly this: two snippets declaring
`{% doc %}` params, a section and a block declaring `{% schema %}` settings, a
story file beside each, a stylesheet the sections link through `asset_url` — and
one helper snippet with no story file, because every theme has a hundred of
those. Every one of its stories renders markup with no error and nothing its
declaration says is wrong, and `tests/theme.test.mjs` holds that true: the
plain-Liquid path claims to work on files nobody wrote for Nazare, and this is
the claim being checked.

No manifests, no Nazare syntax. The walk over `snippets/`, `sections/`, and
`blocks/` is the classification — Shopify addresses a theme file by its
directory, and the kind decides whether props arrive as bare variables or as
`section.settings.*`. Each file's controls come from its own `{% doc %}` params
or `{% schema %}` settings, and its cases from the story file beside it.

Everything compiles; only what has a story file is previewed. That matters for
composition — `product-card` renders `icon`, which nobody wrote stories for, so
the snippet library has to hold templates the sidebar does not show. The theme's
`assets/` are served where `asset_url` points.

## The Liquid declares the interface; a story file declares the cases

Two things, two places, and they never overlap:

| | Declares | Lives in |
| --- | --- | --- |
| **Interface** — prop names, types, ranges, enum members, requiredness, defaults | the Liquid: `{% doc %}`, `{% schema %}`, `{% props %}` | the template |
| **Cases** — which values are worth looking at, and what to call them | a story file | `nazare.json` or `*.stories.json` |

A story file never introduces a prop, a type, or a control. It is a set of named
value bundles addressed by names the template already declared — because two
places to declare an interface means they eventually disagree.

```json
{
  "stories": [
    { "name": "default" },
    { "name": "on sale", "props": { "product": { "$fixture": "product" } } },
    { "name": "no badge", "props": { "badge": null },
      "note": "What the card looks like without the ribbon." }
  ]
}
```

Four keys, and no others: `stories`, and each case's `name`, `props`, `note`.
Anything else is a parse error rather than a field quietly ignored — every
Storybook field that isn't in that list is one that ends up declaring interface
in the story file.

**Stories are partial.** Since the declaration owns the defaults, a case states
only what it changes; `default` above sets nothing and renders the component as
it ships. That keeps a story about its delta, which is also what makes the
workbench's grouping by changed prop mean anything. `null` is an explicit unset,
distinct from absent — "what does this look like without the optional thing."

Only *declared* defaults fall through. A control for an optional prop with no
default still carries a type-shaped placeholder, so a panel has something to
open on, but rendering with one would put the prop's own name into the markup —
`class="… class"`, a bare `attributes`. A prop the declaration says nothing
about arrives nil, exactly as it would on a storefront. `{% schema %}` states
its defaults outright; `{% doc %}` has no syntax for one, so a plain snippet's
story states every prop it wants rendered.

**A story file is what publishes a component to the workbench.** No file, no
sidebar entry. That is the whole discovery rule, and it is what keeps a real
theme's hundred helper snippets — `icon.liquid`, `meta-tags.liquid` — out of a
sidebar where they would render blank. They stay in scope for `{% render %}`;
they just aren't things to look at. `build` and `check` both count them, and
`check --json` names them, so a template never disappears without saying why.

A published component carries its stories in `nazare.json`, versioned with it
and travelling with the install. A theme has no manifest, so its stories live in
a sidecar beside the template — `product-card.stories.json` for
`product-card.liquid`, the same shape minus the wrapper. The sidecar wins where
both exist: the file beside the template is the more local statement.

Storefront data lives in the preview, not in the components: one canonical mock
product, collection, image, and shop in `fixtures.ts`, addressed as
`{ "$fixture": "name" }`, plus the `money` and `img_url` filters.

**Objects only.** A fixture exists because JSON cannot reasonably hold the
thing — a product with its images, variants and compare-at price — and because
forty components should agree about the shop they belong to. A number is not
that: `{ "$fixture": "price" }` was `2400` wearing a costume, longer to write
than the number and a layer of indirection for a reader to unpick for nothing.
Scalars are literals, and you type them.

**And they are your files.**

```sh
nazare preview fixtures init                    # copy the built-ins in
nazare preview fixtures pull merino-crew \
  --store shop.myshopify.com                    # or take a real one
```

`fixtures/product.json` beside your theme wins over the built-in one, by
basename. `init` copies the shipped set into the project the way a registry
component is copied in — after that they are ordinary JSON you read, diff and
edit, and the package's copies stop mattering.

`pull` fetches a real product from a live storefront, which is the answer to
the thing a fixture is worst at: it is tidy in ways a catalogue is not — no
60-character title, no sold-out variant, no missing compare-at price. It reads
`/products/<handle>.js`, the storefront endpoint that answers with the Liquid
product drop itself, in cents. The Admin API is the obvious place to ask and
the wrong one: it answers `"24.00"` where Liquid has `2400` and
`featuredImage.url` where Liquid has an image drop, so a fixture built from it
needs a hand-written translation that can quietly disagree with the runtime. Sharing a product between the nine components
that take one is a reason to share a *file*; it was never a reason for that file
to live inside this package, where nobody could read it, diff it, or change it.
The shipped set is a starting point, not a fact — and inlining a product into
one story stays available for the case a shared one cannot express, which is
most of the interesting ones: a sold-out variant, a 60-character title, no
compare-at price. If each
component shipped its own mock product, forty components would disagree about
the shop they belong to. Stories drawing on fixtures are badged in the gallery,
because a fixture is tidy in ways a real catalogue is not: no missing compare-at
price, no 60-character title, no sold-out variant.

### Nothing is derived at render time

`scaffoldStories` still produces the obvious set — the defaults, then one case
per enum member — but it writes a *file*, for an author to read and edit and
commit:

```sh
nazare preview scaffold snippets/product-card.liquid
```

The difference is not cosmetic. A guess in a file is something you can correct;
a guess made fresh on every render is something the tool asserts on your behalf
forever. It also gives the sidebar a meaning — "17 of 130 snippets" reads as a
number somebody moved, rather than one that is always 130.

## Stories are checked against the declaration

Liquid does not complain about a call that passes a prop the template never
reads, or omits one it needs: the value is nil, the markup is missing, and the
story looks plausible. So every story is checked against what the component
declares — an undeclared prop (usually a typo), a value outside an enum, a
number outside its range, a required prop nobody passed, a `$fixture` name that
does not exist.

Since the interface belongs to the Liquid and the story owns only values, a
mismatch is unambiguous: the story asserts something the declaration denies, and
there is no reading where that was meant. These are **errors**. They are also
checkable in both directions — a story that misspells a prop fails, and a
template that renames one breaks its stories loudly instead of quietly rendering
nil.

They are reported beside the render, not thrown: a story that trips one still
renders, and the render is how you judge how much it matters. A component that
declares nothing — plain Liquid with no `{% doc %}` block — is not
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
caller — which is why `nazare preview` lives in `cli-client` rather than here,
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
range?, value, hasDefault, typeExpression }` — the argTypes equivalent, derived
rather than written. `hasDefault` separates a declared default from a
placeholder this pass invented, which is what `storyProps` merges on and what
`required` already meant: a required prop is exactly one the declaration gives
no default for.

**Story file → stories.** `parseStoryFile(json)` checks the file strictly and
`storiesFor({ manifest, sidecar })` resolves which of the two sources applies,
returning `[]` when neither declares anything — the signal that this component
does not appear. Story names are unique within a file, which is what keeps story
ids from colliding. `scaffoldStories(component)` is the draft generator, called
by the scaffold runner and by nothing on the render path.

**Stories → rendered.** `renderComponentStories(component, stories, options)`
assigns each story its id, computes which props it `changed`, validates it
against the declaration, merges its delta over the declared defaults with
`storyProps`, and renders it in the scope the kind dictates. `stories` is
required: there is no derived set to fall back on.

```ts
type RenderedStory = {
  id: string;          // "button--outline"
  story: PreviewStory; // { name, props (the delta), note?, fixtures? }
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
| Read a story file | `parseStoryFile`, `storiesFor` |
| Draft one for an author to edit | `scaffoldStories` |
| Render stories without a page | `renderComponentStories` |
| Render a template yourself | `createPreviewEngine`, `renderPreview` |
| Build a static site or serve a dev server | `storyDocuments`, `workbenchPage` |
| Sweep the whole registry at once | `galleryPage` |
| Check a story is well-formed | `validateStory` |
| Show how to reproduce a story in a theme | `renderCall` |
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
- shell → frame: `nazare-preview:canvas` — background, outline, zoom, measure.
  How a story is shown belongs to the document that renders it, and measuring
  one means reading computed styles the shell has no access to.

The rest of the state is in the URL — the story in the fragment, the viewport in
the query — so a reload, a link, and a fresh tab all arrive at the same place.

### The files

```txt
component.ts         source → PreviewComponent
controls.ts          contract → controls
plain-controls.ts    doc params / schema settings → controls
render-call.ts       one story → the call that reproduces it in a theme
story-file.ts        the story file format, parsed strictly
stories.ts           declared cases → stories; delta over declared defaults
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

`cli-client/src/preview-server.ts` is the same build held in memory and repeated
on change — it adds no compilation of its own. A file changes, the directory is
read again, the pages are the same strings `build` would have written, and the
shell reloads itself over an event stream. The whole page reloads rather than
the frame alone, which the URL made cheap: story in the fragment, presentation
in the query, panels in storage, so a reload lands exactly where you were.

Invalidation is deliberately blunt — everything recompiles. The compiler models
`{% render %}` edges and could say precisely which components a file affects,
but that dependency map is a second source of truth to keep correct, and the
whole rebuild costs a few hundred milliseconds at the size a theme reaches.
A story file that is mid-edit keeps the last good render of its component, since
a half-typed key should not take away the page you are editing against.

Served, the workbench also **edits stories**: one input per declared prop,
seeded from the story as it was written, with an explicit Save that writes the
story file. Not live — the render happens in Node, so a value changed in the
panel cannot repaint the canvas by itself. Save writes the file, the watcher
rebuilds, and the page reloads with the real render. That is why the button
says Save rather than the canvas following your keystrokes: the alternative is
a canvas that quietly stops matching the controls above it.

A fixture prop is shown as the reference it is, with no field pretending
otherwise; the JSON tab is where one changes. What is written is the story's
delta, with `{ "$fixture": "product" }` left as the
reference it is rather than the three kilobytes it resolves to, which is why
`PreviewStory` keeps `source` alongside its resolved props.

A **JSON** tab edits the story file as text, for everything a form has no row
for: a note, an explicit null, a story that does not exist yet, the order they
appear in. Saved verbatim — the author's formatting is theirs to keep — where
the field editor round-trips through `JSON.stringify` and expands compact
objects. It goes back
through `parseStoryFile` before it is written, so the editor cannot produce a
file `preview check` would reject.



`cli-client/src/preview-command.ts` is pure I/O around the above: it walks a
directory, resolves each component's story file, and writes the pages. It is
also where the theme-versus-package distinction lives — detected from what is in
the directory, not asked for.

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
node packages/cli-client/dist/index.js preview build registry/components
open .nazare-out/preview/index.html
```

Renders every component in `registry/components/`, writing the workbench to
`index.html`, the whole-registry catalogue to `all.html`, and one document per
story under `stories/`. Compile diagnostics are listed per component rather than
failing the page, and a story that throws reports its error in place — in its
own document, so the rest of the page is unaffected.

`nazare preview check` renders the same set with no pages written, and exits
non-zero when a story throws or contradicts its declaration. That is the CI
form: rename a prop and the stories still naming the old one fail here rather
than rendering nil on a storefront.
