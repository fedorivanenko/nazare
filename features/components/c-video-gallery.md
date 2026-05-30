---
schemaVersion: 1

id: c-video-gallery
title: Video Gallery Snippet
status: done

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-carousel
  - c-video

surfaces:
  storefront:
    - snippets/c-video-gallery.liquid

invariants:
  - Component ID is c-video-gallery
  - Installs through nazare add c-video-gallery
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript — behavior is delegated to c-carousel and c-video
  - Accepts blocks, mode, direction, speed, pause_on_hover, aria_label params
  - Iterates blocks internally; skips blocks with no video set
  - Delegates carousel rendering to c-carousel
  - Delegates video rendering to c-video
  - Empty state placeholder renders only in design mode
  - Does not render heading, description, or CTA — caller owns those
  - Does not mutate theme scaffold source

nonGoals:
  - Heading, description, or CTA settings
  - Section schema — this is a snippet consumed by sections
  - JavaScript behavior beyond what c-carousel and c-video provide
  - Custom CSS files
  - Theme scaffold template placement

codebaseOwnership:
  owns:
    repo:
      - components/c-video-gallery/**
      - nazare.registry.yml c-video-gallery metadata

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - components/c-carousel/**
    - components/c-video/**
---

# Video Gallery Snippet

## Goal

Provide a reusable video gallery snippet that wraps `c-carousel` and `c-video` for sections that need a scrollable or marquee video carousel.

The snippet is intentionally minimal — it owns only the block iteration, the carousel wiring, and the design-mode empty state. Heading, description, CTA, and section padding belong to the caller.

---

## Scope

- `components/c-video-gallery/c-video-gallery.liquid`
- `nazare.registry.yml` component metadata for `c-video-gallery`

Snippet parameters:

| param | type | default | description |
|-------|------|---------|-------------|
| `blocks` | array | — | Shopify section blocks; each block must expose `settings.video`, `settings.thumbnail`, `settings.thumbnail_alt` |
| `mode` | string | `static` | `static` (drag to scroll) or `marquee` (auto-scroll) |
| `direction` | string | `left` | Marquee direction: `left` or `right` |
| `speed` | string | `normal` | Marquee speed: `slow`, `normal`, `fast` |
| `pause_on_hover` | boolean | `true` | Pause marquee on hover |
| `aria_label` | string | — | Accessible label forwarded to `c-carousel` |

Component metadata:

```yaml
components:
  c-video-gallery:
    version: 1.0.0
    type: snippet
    dependencies:
      - c-carousel
      - c-video
    files:
      - from: components/c-video-gallery/c-video-gallery.liquid
        to: snippets/c-video-gallery.liquid
        checksum:
          algorithm: sha256
          value: 45cf75bc81c21934ddb23ef8dc27e67e8d26138e815e75e56a7d7d65cdcdae63
```

Render contract:

```liquid
{% render 'c-video-gallery',
  blocks: section.blocks,
  mode: section.settings.mode,
  direction: section.settings.direction,
  speed: section.settings.speed,
  pause_on_hover: section.settings.pause_on_hover,
  aria_label: section.settings.title
%}
```

- Blocks with no `video` set are silently skipped.
- When at least one video block is present, renders `c-carousel` with `gap: 'sm'`.
- When no video blocks are present and `request.design_mode` is true, renders a dashed placeholder with instructional text.
- When no video blocks are present outside design mode, renders nothing.

---

## Success behavior

- `nazare list` shows `c-video-gallery` as available.
- `nazare add c-video-gallery` installs `snippets/c-video-gallery.liquid` and transitively installs `c-carousel`, `c-video`, and their dependencies.
- Blocks with no video skip silently without Liquid errors.
- Carousel renders when at least one video block is present.
- Empty state placeholder renders in design mode only.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails component validation tests.
- Missing component source file fails registry component tests.
- All blocks having no video renders nothing outside design mode.
- Unknown `mode` falls back to `static`.
- Snippet must not depend on JavaScript beyond c-carousel and c-video.

---

## Verification

Result: done.

- [x] component source exists at registry path
- [x] registry contains `c-video-gallery` metadata with c-carousel and c-video dependencies
- [x] registry checksum matches component source bytes
- [x] blocks without video are skipped
- [x] carousel renders when video blocks are present
- [x] empty state renders in design mode only
- [x] unknown mode falls back to static
- [x] snippet uses Tailwind utilities only

---

## Architecture notes

Block iteration and `rendered_videos` counting happen inside a `{% capture %}` block. Liquid variable assignments inside `{% capture %}` persist to outer scope in Shopify Liquid, so `rendered_videos` is available for the empty state check after the capture completes.

The snippet does not own `data-c-carousel-item` semantics — it writes them on behalf of the blocks. If `c-carousel`'s item selector changes, this snippet must be updated in sync.

---

## Open questions

None.
