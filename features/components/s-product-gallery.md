---
schemaVersion: 1

id: s-product-gallery
title: Product Gallery Section
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-button
  - c-product-carousel

surfaces:
  storefront:
    - sections/s-product-gallery.liquid

invariants:
  - Component ID is s-product-gallery
  - Installs through nazare add s-product-gallery
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript beyond what c-product-carousel dependencies provide
  - Heading is always rendered; body text and CTA are each optional
  - CTA renders only when both URL and label exist
  - Product carousel renders nothing when the configured source yields zero products
  - Each product is wrapped in data-c-carousel-item and rendered via c-product-card exactly once
  - c-carousel mode is merchant-configurable: static or marquee
  - Does not mutate theme scaffold source

nonGoals:
  - Previous/next navigation buttons
  - Pagination dots
  - Quick-view modal
  - Add-to-cart from the carousel
  - Filtering or sorting products within the section
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/s-product-gallery/**
      - nazare.registry.yml s-product-gallery metadata
      - test/ registry component validation for s-product-gallery

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Product Gallery Section

## Goal

Add an installable Shopify section that pairs an editorial header with a horizontal product carousel.

The section gives merchants a high-converting collection placement: a bold headline and supporting copy establish the hook on the left, a CTA button anchors the top-right, and the product carousel below lets shoppers browse without leaving the page. All product card rendering is delegated to `c-product-card`; all carousel motion to `c-carousel`.

---

## Scope

Included:

- `components/s-product-gallery/s-product-gallery.liquid`
- `nazare.registry.yml` component metadata for `s-product-gallery`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add s-product-gallery` installs the section from the local registry
- configurable section settings:
  - heading text (required display; plain text)
  - body text (optional; rich text)
  - optional CTA URL
  - optional CTA label
  - optional CTA button style: solid, outline, ghost
  - source mode: `collection` or `manual`
  - collection picker (active when source mode is `collection`)
  - products to show count: 4–20, default 8 (active when source mode is `collection`)
  - carousel mode: `static` or `marquee`, default `static`
  - marquee direction: `left` or `right`, default `left` (active when mode is `marquee`)
  - marquee speed: `slow`, `normal`, or `fast`, default `normal` (active when mode is `marquee`)
  - pause on hover: boolean, default `true` (active when mode is `marquee`)
  - badge tags — comma-separated tag values rendered as filled badges on matching products
  - show ratings: boolean, default `true`
  - show swatches: boolean, default `true`
  - color option name: default `Color`
- section blocks (type: `product`, active when source mode is `manual`):
  - product picker

Layout contract:

- Section uses `page-width` container for horizontal padding.
- Header zone: two-column row. Left column holds heading (large, bold) above body text. Right column holds the CTA button, top-aligned.
- CTA renders via `{% render 'c-button', ... %}` only when both `cta_url` and `cta_label` are present.
- Body text renders only when non-empty.
- Carousel zone sits below the header with consistent vertical spacing.
- Carousel zone renders via `{% render 'c-product-carousel', products: ..., mode: ..., direction: ..., speed: ..., pause_on_hover: ..., badge_tags: ..., show_ratings: ..., show_swatches: ..., color_option_name: ... %}`.
- Carousel zone renders nothing when the product source yields zero products.

Component metadata:

```yaml
components:
  s-product-gallery:
    version: 1.0.0
    type: section
    dependencies:
      - c-button
      - c-product-carousel
    files:
      - from: components/s-product-gallery/s-product-gallery.liquid
        to: sections/s-product-gallery.liquid
        checksum:
          algorithm: sha256
          value: ""
```

---

## Success behavior

- `nazare list` shows `s-product-gallery` as available after registry update.
- `nazare add s-product-gallery` installs `sections/s-product-gallery.liquid` and transitively installs `c-button`, `c-product-carousel`, `c-carousel`, `c-product-card`, `c-badge`, `c-ratings`, and `c-swatch`.
- Heading renders for any non-empty heading setting.
- Body text renders when non-empty; absent otherwise.
- CTA renders when both URL and label are set; absent otherwise.
- CTA is positioned top-right of the header zone, opposite the heading.
- In collection mode, up to the configured count of products from the selected collection are rendered.
- In manual mode, each product block renders as a card in the order added.
- Each product is rendered exactly once — no duplication of card markup.
- In static mode the carousel is drag-scrollable with no automatic motion.
- In marquee mode the carousel moves continuously at the configured direction and speed; drag pauses motion and resumes on release.
- Pause on hover pauses marquee on pointer hover and keyboard focus when enabled.
- Zero products from the selected source renders no carousel zone without broken markup.
- Swatch selection on any card swaps that card's image; other cards are unaffected.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Empty or unpublished collection renders no carousel zone without Liquid errors.
- Manual mode with no product blocks renders no carousel zone without broken markup.
- Empty CTA URL or label renders no button without broken markup.
- Missing dependency snippets do not crash section render — registry resolves transitively.

---

## Verification

- [ ] component source exists at registry path
- [ ] registry contains `s-product-gallery` metadata with c-button and c-product-carousel dependencies
- [ ] registry checksum matches component source bytes
- [ ] component metadata validates with component registry parser
- [ ] heading renders for non-empty setting
- [ ] body text renders when non-empty, absent otherwise
- [ ] CTA renders when both URL and label set, absent otherwise
- [ ] CTA positioned top-right opposite heading
- [ ] collection mode renders products from selected collection up to configured count
- [ ] manual mode renders products from product blocks in order
- [ ] each product card appears exactly once in rendered HTML
- [ ] static mode renders drag-scrollable row with no automatic motion
- [ ] marquee mode moves cards continuously at configured direction and speed
- [ ] pause on hover pauses marquee on hover and focus when enabled
- [ ] zero products renders no carousel zone
- [ ] swatch selection swaps correct card image without affecting other cards
- [ ] section uses Tailwind utilities only
- [ ] `nazare add s-product-gallery` smoke installs section and all transitive dependencies

---

## Architecture notes

The section is split into two independent zones rendered top-to-bottom: the header zone (heading + body + CTA) and the carousel zone (products). Neither zone depends on the other — an empty product source hides the carousel but leaves the header intact, and an empty CTA leaves the carousel unaffected.

The header uses a two-column flex or grid layout: heading and body stack on the left, CTA floats to the top-right. On mobile both columns stack vertically with the CTA moving below the body text.

The carousel zone delegates entirely to `c-product-carousel`. The section resolves the product source (collection or manual blocks) into an array, then passes it straight to the snippet along with carousel and card settings. No capture or rendering logic lives in the section.

All motion, drag, and image-swap behavior is owned by `c-product-carousel` and its dependencies. The section passes settings through without interpreting them.

---

## Open questions

- Should the CTA on mobile move below the carousel rather than below the body text, so it acts as a "see more" anchor at the bottom of the section?
- Should the section support a secondary subheading between the heading and body text?
