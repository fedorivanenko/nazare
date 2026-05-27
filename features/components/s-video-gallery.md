---
schemaVersion: 1

id: s-video-gallery
title: Video Gallery Section
status: done

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-video
  - c-button
  - c-carousel

surfaces:
  storefront:
    - sections/s-video-gallery.liquid

invariants:
  - Component ID is s-video-gallery
  - Installs through nazare add s-video-gallery
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Renders video cards from Shopify-hosted video block settings
  - Uses c-video for each video render
  - Uses c-button for optional section CTA render
  - Uses c-carousel for optional carousel and endless marquee layouts
  - Does not duplicate c-video playback or global mute coordination logic
  - Does not mutate theme scaffold source

nonGoals:
  - YouTube, Vimeo, or external iframe video embeds
  - Drag interactions
  - Pagination controls
  - Masonry layout
  - Per-video CTA buttons
  - Product media gallery integration
  - Autoplay or scroll-triggered playback
  - Custom CSS files
  - JavaScript beyond c-video and c-carousel dependency behavior
  - Theme scaffold template placement

codebaseOwnership:
  owns:
    repo:
      - components/s-video-gallery/**
      - nazare.registry.yml s-video-gallery metadata
      - test/ registry component validation for s-video-gallery
      - README.md default component notes if needed

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Video Gallery Section

## Goal

Add an installable Shopify section that presents a row or responsive grid of videos with section-level title, description, and CTA.

The section composes existing registry primitives: `c-video` owns video controls and mute coordination, while `c-button` owns CTA markup and styling.

---

## Scope

Included:

- `components/s-video-gallery/s-video-gallery.liquid`
- `nazare.registry.yml` component metadata for `s-video-gallery`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add s-video-gallery` installs the section and dependencies from the local registry
- section settings:
  - title
  - description
  - optional CTA label
  - optional CTA URL
  - CTA scheme: `solid`, `outline`, or `ghost`
  - layout density: `2 columns`, `3 columns`, or `4 columns` on large screens
  - layout mode: `grid`, `carousel`, or `marquee`
  - carousel direction: `left` or `right`
  - carousel speed: `slow`, `normal`, or `fast`
  - carousel pause on hover/focus
- video blocks:
  - `video`: required Shopify-hosted video object
  - `thumbnail`: optional Shopify image object
  - `thumbnail_alt`: optional thumbnail alt text

Component metadata:

```yaml
components:
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

Section render contract:

- Uses `{% render 'section-css', section_name: 's-video-gallery' %}`.
- Root section uses Tailwind utility classes only.
- Title renders from settings and has a safe default.
- Description renders only when present.
- CTA renders through `{% render 'c-button' %}` only when both CTA label and CTA URL are present.
- Videos render from section blocks in merchant-defined order.
- Each valid video block renders `{% render 'c-video' %}` with `video`, `thumbnail`, and `thumbnail_alt` arguments.
- Blocks without a selected video render nothing in the gallery grid and do not create empty cards.
- Empty gallery state renders helpful placeholder text in theme editor only, not on live storefront.
- Grid layout is a single-column stack on small screens and switches to the selected column count on large screens.
- Carousel layout captures each valid video block once and renders `c-carousel` with `mode: static`.
- Marquee layout captures each valid video block once and renders `c-carousel` with `mode: marquee`.
- Carousel and marquee item markup uses `data-c-carousel-item` and must not duplicate Shopify blocks.

---

## Success behavior

- `nazare list` shows `s-video-gallery` as available after registry update.
- `nazare add s-video-gallery` installs `sections/s-video-gallery.liquid` and required dependency files for `c-video`, `c-button`, and `c-carousel` when absent.
- Installed section renders title, optional description, optional CTA, and video blocks.
- Video blocks use `c-video`, including thumbnail, play/pause, mute/unmute, and global mute coordination behavior.
- CTA uses `c-button` and respects the selected scheme.
- Missing CTA label or URL omits CTA without broken links.
- Missing video in a block omits that block without broken media markup.
- Section uses Tailwind utility classes only.
- Grid layout remains default.
- Carousel and marquee layouts render valid video blocks through `c-carousel` without duplicating block markup.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Missing `c-video`, `c-button`, or `c-carousel` dependency metadata fails install/validation rather than generating partial broken dependency references.
- Empty optional settings must not render broken links, empty media wrappers, or placeholder content on live storefront.
- Failure cases must not mutate unrelated user files.

---

## Verification

Result: done.

- [x] component source exists at registry path
- [x] registry contains `s-video-gallery` metadata
- [x] registry declares dependencies on `c-video`, `c-button`, and `c-carousel`
- [x] registry checksum matches component source bytes
- [x] component metadata validates with component registry parser
- [x] section schema contains title, description, CTA label, CTA URL, CTA scheme, layout density, layout mode, carousel settings, and video block settings
- [x] section uses Tailwind utilities
- [x] CTA render is gated by URL and label and uses `c-button`
- [x] each valid video block renders `c-video`
- [x] invalid/empty video blocks render no broken media markup
- [x] carousel and marquee layouts render `c-carousel` with captured video block markup
- [x] `nazare add s-video-gallery` smoke installs section and dependencies from local registry

---

## Architecture notes

Keep `s-video-gallery` as composition only. Do not reimplement video control JavaScript or global mute behavior inside the section; those stay in `c-video`. Do not reimplement marquee motion inside the section; that stays in `c-carousel`.

Use static snippet renders so the existing Nazare build graph can follow dependencies:

```liquid
{% render 'c-video', video: block.settings.video, thumbnail: block.settings.thumbnail, thumbnail_alt: block.settings.thumbnail_alt %}
{% render 'c-button', label: section.settings.cta_label, url: section.settings.cta_url, scheme: section.settings.cta_scheme %}
{% render 'c-carousel', content: carousel_items, mode: carousel_mode, direction: section.settings.carousel_direction, speed: section.settings.carousel_speed %}
```

Use Liquid branches for layout column classes because section settings determine layout. Keep custom CSS out of the component.

Grid remains default. Carousel and marquee are opt-in layout modes backed by `c-carousel`.

---

## Open questions

None.
