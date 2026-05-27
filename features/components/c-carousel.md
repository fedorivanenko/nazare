---
schemaVersion: 1

id: c-carousel
title: Carousel Snippet
status: done

dependencies:
  - component-registry
  - component-list
  - component-add
  - s-video-gallery

surfaces:
  storefront:
    - snippets/c-carousel.liquid
    - scripts/snippets/c-carousel.js
    - sections/s-video-gallery.liquid

invariants:
  - Component ID is c-carousel
  - Installs through nazare add c-carousel
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Accepts caller-rendered item markup instead of owning Shopify section blocks
  - s-video-gallery is first consuming section and remains owner of its video block markup
  - Endless marquee moves existing item elements through the track instead of cloning or duplicating them
  - JavaScript is limited to carousel scrolling, marquee motion, item reordering, pause state, and resize handling
  - Does not mutate theme scaffold source

nonGoals:
  - Shopify section schema beyond s-video-gallery carousel settings
  - Owning video, product, collection, or card markup
  - Duplicating slide markup for seamless looping
  - Drag or swipe gestures
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
      - components/s-video-gallery/s-video-gallery.liquid carousel integration
      - nazare.registry.yml c-carousel metadata
      - nazare.registry.yml s-video-gallery dependency/checksum update
      - test/ registry component validation for c-carousel
      - test/ s-video-gallery carousel integration coverage
      - README.md default component notes if needed

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files except components/s-video-gallery/s-video-gallery.liquid
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
- `s-video-gallery` integration that uses `c-carousel` when a carousel layout is selected
- smoke coverage that `nazare add s-video-gallery` installs `c-carousel` as a dependency
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
- `s-video-gallery` settings added:
  - `layout_mode`: `grid`, `carousel`, or `marquee`
  - `carousel_direction`: `left` or `right`
  - `carousel_speed`: `slow`, `normal`, or `fast`
  - `carousel_pause_on_hover`: boolean

Component metadata:

```yaml
components:
  c-carousel:
    version: 1.0.1
    type: snippet
    dependencies: []
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
  s-video-gallery:
    version: 1.1.0
    type: section
    dependencies:
      - c-video
      - c-button
      - c-carousel
    files:
      - from: components/s-video-gallery/s-video-gallery.liquid
        to: sections/s-video-gallery.liquid
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
- Root and viewport constrain vertical height with `max-height: clamp(420px, 60dvh, 680px)`.
- Caller is responsible for wrapping each carousel item with `data-c-carousel-item`.
- Blank `content` renders nothing.
- Missing or unknown `mode` falls back to `static`.
- `static` mode renders a horizontally scrollable ribbon without automatic movement.
- `marquee` mode starts automatic horizontal motion when at least two item elements exist.
- `direction` controls marquee travel direction and defaults to `left` when blank or unknown.
- `speed` maps to fixed pixels-per-second values and defaults to `normal` when blank or unknown.
- `gap` maps to Tailwind gap utilities and defaults to `md` when blank or unknown.
- `pause_on_hover` pauses marquee on pointer hover and keyboard focus when enabled.

`s-video-gallery` render contract:

- Existing grid behavior remains default through `layout_mode: grid`.
- `layout_mode: carousel` captures valid video blocks once, wraps each valid block in `data-c-carousel-item`, and renders `c-carousel` with `mode: static`.
- `layout_mode: marquee` captures valid video blocks once, wraps each valid block in `data-c-carousel-item`, and renders `c-carousel` with `mode: marquee`.
- Missing video blocks are omitted before capture so carousel receives no empty items.
- CTA, title, description, `c-video` rendering, and empty theme-editor state keep existing behavior.
- `s-video-gallery` declares dependency on `c-carousel` so `nazare add s-video-gallery` installs snippet and script.

JavaScript behavior contract:

- `init(root)` initializes one instance for one carousel root.
- `destroy(root)` stops animation, removes listeners, and clears instance state.
- Marquee uses `requestAnimationFrame` and transform updates on the track.
- Marquee never calls `cloneNode`, never appends copied HTML, and never creates duplicate `data-c-carousel-item` elements.
- When an item fully exits the viewport, JavaScript moves that same existing item element to the opposite end of the track with `appendChild` or `insertBefore`.
- After moving an item, JavaScript adjusts the accumulated transform offset by the moved item width plus gap so visual motion does not jump.
- Resize handling remeasures item widths and gap without duplicating items.
- If there is not enough measurable item width to animate safely, marquee stays static rather than duplicating content.
- Shopify theme editor section load/unload works through existing Nazare runtime lifecycle.

---

## Success behavior

- `nazare list` shows `c-carousel` as available after registry update.
- `nazare add c-carousel` installs `snippets/c-carousel.liquid` and `scripts/snippets/c-carousel.js`.
- `nazare add s-video-gallery` installs `sections/s-video-gallery.liquid`, `c-video`, `c-button`, and `c-carousel` dependencies.
- A section can capture block markup once and render it through `c-carousel`.
- Rendered `content` appears exactly once in initial HTML.
- Static mode shows a horizontal overflow ribbon with caller-owned items.
- Marquee mode moves items continuously in selected direction at selected speed.
- Marquee looping reuses and reorders existing item elements; block markup, Shopify block attributes, media, and nested state stay on the same DOM nodes.
- Hover or focus pauses marquee when `pause_on_hover` is enabled.
- Missing or invalid options fall back to safe defaults.
- Blank content renders no empty carousel shell.
- `s-video-gallery` default grid layout remains unchanged unless merchant selects carousel or marquee.
- `s-video-gallery` carousel and marquee layouts render each valid video block exactly once in initial HTML.
- Component source checksums match registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source files fail registry component tests.
- Blank `content` renders nothing and does not initialize JavaScript.
- Content without at least two `data-c-carousel-item` elements remains static and does not throw.
- Measurement failure, zero-width items, or hidden root disables marquee and leaves content visible.
- JavaScript initialization failure leaves static horizontal content visible and logs through existing Nazare runtime warning path.
- `s-video-gallery` keeps grid fallback available when carousel JavaScript is unavailable.
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
- [x] `s-video-gallery` registry metadata depends on `c-carousel`
- [x] `nazare add s-video-gallery` smoke installs `c-carousel` dependency
- [x] `s-video-gallery` default grid layout remains unchanged
- [x] `s-video-gallery` carousel layout captures and renders each valid video block once
- [x] `s-video-gallery` marquee layout passes existing block markup into `c-carousel` without duplication

---

## Architecture notes

Keep `c-carousel` as layout and motion primitive only. Sections own item data, Shopify blocks, and card markup. This keeps `c-carousel` reusable for videos, products, logos, testimonials, and other future components.

Wire first into `s-video-gallery` without moving video-card ownership into `c-carousel`. `s-video-gallery` should keep rendering `c-video` inside each Shopify video block, capture those rendered blocks once, then hand the captured markup to `c-carousel`.

Endless marquee must avoid common clone-based marquee patterns. Cloning would duplicate Shopify block DOM, duplicate IDs or `shopify_attributes`, and risk duplicated media playback or analytics events. Use a moving-window model instead: animate one track, move existing child nodes from one edge to the other after they fully leave the viewport, then compensate transform offset.

Prefer DOM element identity tests for marquee verification: collect item elements before animation, force a wrap step, then assert the track still contains the same element objects and no additional `data-c-carousel-item` nodes.

Use Tailwind utilities in Liquid for layout classes. Keep runtime-calculated values limited to inline `transform` style and optional CSS custom properties needed for measured motion. Do not add custom CSS files.

---

## Open questions

None.
