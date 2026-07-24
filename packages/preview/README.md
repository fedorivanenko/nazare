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

Renders every component in `registry/components/`. Compile diagnostics are
listed per component rather than failing the page, and a story that throws
reports its error in place.
