---
schemaVersion: 1

id: c-carousel
title: Carousel Snippet
status: done

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-video-gallery

surfaces:
  storefront:
    - snippets/c-carousel.liquid
    - scripts/snippets/c-carousel.js

invariants:
  - Component ID is c-carousel
  - Installs through nazare add c-carousel
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Accepts caller-rendered item markup instead of owning Shopify section blocks
  - c-video-gallery is first consuming snippet and remains owner of its video block markup
  - Endless marquee moves existing item elements through the track instead of cloning or duplicating them
  - JavaScript handles carousel scrolling, marquee motion, item reordering, pause state, resize handling, and pointer drag
  - Drag is provided by c-drag-scroll; c-carousel owns only the callbacks that translate drag delta into scroll or transform
  - Static mode drag updates viewport scrollLeft using absolute delta from drag origin
  - Marquee mode drag pauses animation on drag start and resumes on release; uses incremental delta so recycle offset adjustments are not clobbered
  - Marquee recycle preserves video playback state: playing videos inside a recycled item are resumed after the DOM move
  - Does not mutate theme scaffold source

nonGoals:
  - Shopify section schema
  - Owning video, product, collection, or card markup
  - Duplicating slide markup for seamless looping
  - Pagination dots
  - Previous and next buttons
  - Scroll snapping controls
  - Autoplay modes other than endless marquee
  - Virtualization for hundreds of items
  - Custom CSS files
  - Theme scaffold template placement

codebaseOwnership:
  owns:
    repo:
      - components/c-carousel/**
      - nazare.registry.yml c-carousel metadata
      - test/ registry component validation for c-carousel

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Carousel Snippet

## Goal

Add reusable storefront carousel primitive that sections can use to lay out arbitrary caller-rendered items in a horizontal ribbon.

The snippet includes optional endless marquee behavior. Marquee must be careful: it must not clone Shopify blocks or duplicate item markup. It should continuously move the same rendered item elements through the ribbon by reordering existing DOM nodes as they leave the viewport.

---

## Scope

Included:

- `components/c-carousel/c-carousel.liquid`
- `components/c-carousel/c-carousel.js`
- `nazare.registry.yml` component metadata for `c-carousel`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-carousel` installs the snippet and script from the local registry
- snippet parameters:
  - `content`: required pre-rendered item markup from caller
  - `aria_label`: optional accessible label for the carousel region
  - `mode`: `static` or `marquee`
  - `direction`: `left` or `right`
  - `speed`: `slow`, `normal`, or `fast`
  - `pause_on_hover`: boolean, defaults to true for marquee mode
  - `gap`: `sm`, `md`, or `lg`
  - `class`: optional root classes
  - `track_class`: optional track classes
Component metadata:

```yaml
components:
  c-carousel:
    version: 1.0.7-dev.0
    type: snippet
    dependencies:
      - c-drag-scroll
    files:
      - from: components/c-carousel/c-carousel.liquid
        to: snippets/c-carousel.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
      - from: components/c-carousel/c-carousel.js
        to: scripts/snippets/c-carousel.js
        checksum:
          algorithm: sha256
          value: <sha256>
```

Snippet render contract:

```liquid
{% capture carousel_items %}
  {% for block in section.blocks %}
    <article data-c-carousel-item {{ block.shopify_attributes }}>
      ...caller-owned block markup...
    </article>
  {% endfor %}
{% endcapture %}

{% render 'c-carousel', content: carousel_items, mode: 'marquee', direction: 'left', speed: 'normal' %}
```

- Root element uses `data-nazare-use="snippets/c-carousel"` so existing Nazare runtime loads `scripts/snippets/c-carousel.js`.
- Root element uses Tailwind utility classes only.
- The snippet renders a viewport and one track containing `content` exactly once.
- Root uses an explicit `h-[clamp(420px,60dvh,680px)]` so items and viewport can resolve `h-full` against it.
- Caller is responsible for wrapping each carousel item with `data-c-carousel-item`.
- Blank `content` renders nothing.
- Missing or unknown `mode` falls back to `static`.
- `static` mode renders a horizontally scrollable ribbon without automatic movement; pointer drag scrolls the viewport.
- `marquee` mode starts automatic horizontal motion when at least two item elements exist; pointer drag pauses motion, applies an offset delta, and resumes on release.
- `direction` controls marquee travel direction and defaults to `left` when blank or unknown.
- `speed` maps to fixed pixels-per-second values and defaults to `normal` when blank or unknown.
- `gap` maps to Tailwind gap utilities and defaults to `md` when blank or unknown.
- `pause_on_hover` pauses marquee on pointer hover and keyboard focus when enabled.

JavaScript behavior contract:

- `init(root)` initializes one instance for one carousel root.
- `destroy(root)` stops animation, removes listeners, and clears instance state.
- Marquee uses `requestAnimationFrame` and transform updates on the track.
- Marquee never calls `cloneNode`, never appends copied HTML, and never creates duplicate `data-c-carousel-item` elements.
- When an item fully exits the viewport, JavaScript moves that same existing item element to the opposite end of the track with `appendChild` or `insertBefore`.
- After moving an item, JavaScript adjusts the accumulated transform offset by the moved item width plus gap so visual motion does not jump.
- Before moving an item, JavaScript records which videos inside it are playing; after the move it calls `.play()` on any that were paused by the re-parent.
- Drag delta is applied incrementally (`offset += dx - prevDx`) rather than absolutely so that recycle offset adjustments made mid-drag are not overwritten.
- Resize handling remeasures item widths and gap without duplicating items.
- If there is not enough measurable item width to animate safely, marquee stays static rather than duplicating content.
- Shopify theme editor section load/unload works through existing Nazare runtime lifecycle.

---

## Success behavior

- `nazare list` shows `c-carousel` as available after registry update.
- `nazare add c-carousel` installs `snippets/c-carousel.liquid` and `scripts/snippets/c-carousel.js`.
- A section can capture block markup once and render it through `c-carousel`.
- Rendered `content` appears exactly once in initial HTML.
- Static mode shows a horizontal overflow ribbon with caller-owned items.
- Marquee mode moves items continuously in selected direction at selected speed.
- Marquee looping reuses and reorders existing item elements; block markup, Shopify block attributes, media, and nested state stay on the same DOM nodes.
- Hover or focus pauses marquee when `pause_on_hover` is enabled.
- Missing or invalid options fall back to safe defaults.
- Blank content renders no empty carousel shell.
- Component source checksums match registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source files fail registry component tests.
- Blank `content` renders nothing and does not initialize JavaScript.
- Content without at least two `data-c-carousel-item` elements remains static and does not throw.
- Measurement failure, zero-width items, or hidden root disables marquee and leaves content visible.
- JavaScript initialization failure leaves static horizontal content visible and logs through existing Nazare runtime warning path.
- Failure cases must not clone item markup, duplicate Shopify block attributes, or mutate unrelated user files.

---

## Verification

Result: done.

- [x] component source exists at registry paths
- [x] registry contains `c-carousel` metadata with Liquid and JavaScript files
- [x] registry checksums match component source bytes
- [x] component metadata validates with component registry parser
- [x] snippet root declares `data-nazare-use="snippets/c-carousel"` only when content is present
- [x] snippet renders captured content exactly once
- [x] snippet renders no shell for blank content
- [x] static mode works without JavaScript duplication behavior
- [x] marquee mode uses existing `data-c-carousel-item` nodes and never clones nodes
- [x] moving an exited item preserves that item element identity
- [x] marquee pauses on hover and focus when enabled
- [x] `destroy(root)` stops animation and removes listeners
- [x] resize handling remeasures without duplicating items
- [x] `nazare add c-carousel` smoke installs snippet and script from local registry

---

## Architecture notes

Keep `c-carousel` as layout and motion primitive only. Sections own item data, Shopify blocks, and card markup. This keeps `c-carousel` reusable for videos, products, logos, testimonials, and other future components.

Wire first into `c-video-gallery` without moving video-card ownership into `c-carousel`. `c-video-gallery` keeps rendering `c-video` inside each Shopify video block, captures those rendered blocks once, then hands the captured markup to `c-carousel`.

Endless marquee must avoid common clone-based marquee patterns. Cloning would duplicate Shopify block DOM, duplicate IDs or `shopify_attributes`, and risk duplicated media playback or analytics events. Use a moving-window model instead: animate one track, move existing child nodes from one edge to the other after they fully leave the viewport, then compensate transform offset.

Prefer DOM element identity tests for marquee verification: collect item elements before animation, force a wrap step, then assert the track still contains the same element objects and no additional `data-c-carousel-item` nodes.

Use Tailwind utilities in Liquid for layout classes. Keep runtime-calculated values limited to inline `transform` style and optional CSS custom properties needed for measured motion. Do not add custom CSS files.

---

## Open questions

None.
