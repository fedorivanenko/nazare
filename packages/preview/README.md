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

`{ "$fixture": "name" }` addresses the shared data. Authored stories replace the
derived set — an author who writes them has said what is worth showing — and a
component with no `preview` block is still previewable from its contract alone.
Stories drawing on fixtures are badged in the gallery, because a fixture is tidy
in ways a real catalogue is not: no missing compare-at price, no 60-character
title, no sold-out variant.

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

Renders every component in `registry/components/`, writing `index.html` plus one
document per story under `stories/`. Compile diagnostics are listed per component
rather than failing the page, and a story that throws reports its error in place
— in its own document, so the rest of the page is unaffected.
