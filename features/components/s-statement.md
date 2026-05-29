---
schemaVersion: 1

id: s-statement
title: Statement Section
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-button
  - c-person

surfaces:
  storefront:
    - sections/s-statement.liquid

invariants:
  - Component ID is s-statement
  - Installs through nazare add s-statement
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript
  - Background image is always rendered as the section background
  - Heading is always rendered
  - Body text, CTA, quote text, and person are each optional
  - CTA renders only when both cta_url and cta_label exist
  - Quote card renders only when quote_text is non-empty
  - Person renders inside the quote card only when at least name or person image is present
  - Does not mutate theme scaffold source

nonGoals:
  - Video background
  - Multiple quotes or testimonials
  - JavaScript animations
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/s-statement/**
      - nazare.registry.yml s-statement metadata
      - test/ registry component validation for s-statement

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Statement Section

## Goal

Add an installable Shopify section that places bold brand narrative over a full-bleed background image, with an optional floating quote card attributed to a founder or spokesperson.

The section is designed for brand storytelling — the left side delivers the statement (heading, body, CTA) and the right side gives a personal human voice to the story through a quoted founder card. The quote card uses `c-person` for the attribution; the section owns the card shell and the background image layout.

---

## Scope

Included:

- `components/s-statement/s-statement.liquid`
- `nazare.registry.yml` component metadata for `s-statement`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add s-statement` installs the section from the local registry
- configurable section settings:
  - background image (required display)
  - background image alt text (optional)
  - heading text (required display; plain text)
  - body text (optional; rich text)
  - optional CTA URL
  - optional CTA label
  - CTA style: `solid`, `outline`, `ghost` — default `outline`
  - quote text (optional; plain text or textarea)
  - person image (optional; forwarded to `c-person`)
  - person image alt (optional; forwarded to `c-person`)
  - person name (optional; forwarded to `c-person`)
  - person role (optional; forwarded to `c-person`)

Layout contract:

- Section root is a `relative` container; background image is absolutely positioned and fills the section with `object-fit: cover`.
- Content sits above the background image in a two-column grid.
- Left column: heading → body text → CTA, stacked vertically. Text color set for legibility over the background image.
- Right column: floating quote card — white/light rounded card with `relative` z-index above the background image.
- Quote card contains: quote text → `{% render 'c-person', ... %}` stacked vertically.
- Quote card renders only when `quote_text` is non-empty.
- `c-person` renders inside the quote card only when at least `person_name` or `person_image` is present.
- CTA renders via `{% render 'c-button', ... %}` only when both `cta_url` and `cta_label` exist.
- On mobile: columns stack vertically — left column content above, quote card below.

Component metadata:

```yaml
components:
  s-statement:
    version: 1.0.0
    type: section
    dependencies:
      - c-button
      - c-person
    files:
      - from: components/s-statement/s-statement.liquid
        to: sections/s-statement.liquid
        checksum:
          algorithm: sha256
          value: ""
```

---

## Success behavior

- `nazare list` shows `s-statement` as available after registry update.
- `nazare add s-statement` installs `sections/s-statement.liquid` and transitively installs `c-button` and `c-person`.
- Background image always renders as full-bleed section background.
- Heading always renders over the background.
- Body text renders when non-empty; absent otherwise.
- CTA renders when both URL and label are set; absent otherwise.
- Quote card renders when `quote_text` is non-empty; absent otherwise.
- `c-person` renders inside the quote card when name or person image is present; absent otherwise.
- Quote card is absent when `quote_text` is empty even if person settings are filled.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Empty `quote_text` renders no card without broken markup.
- Empty CTA URL or label renders no button without broken markup.
- Missing background image renders a section with no background without broken layout.
- Missing dependency snippets do not crash section render — registry resolves transitively.

---

## Verification

- [ ] component source exists at registry path
- [ ] registry contains `s-statement` metadata with c-button and c-person dependencies
- [ ] registry checksum matches component source bytes
- [ ] component metadata validates with component registry parser
- [ ] background image renders full-bleed
- [ ] heading always renders
- [ ] body text renders when non-empty, absent otherwise
- [ ] CTA renders when URL and label set, absent otherwise
- [ ] quote card renders when quote_text non-empty, absent otherwise
- [ ] c-person renders inside card when name or image present
- [ ] quote card absent when quote_text empty regardless of person settings
- [ ] section uses Tailwind utilities only
- [ ] `nazare add s-statement` smoke installs section and transitive dependencies

---

## Architecture notes

The background image uses `absolute inset-0 w-full h-full object-cover` so the section height is driven by the content, not the image. This prevents the section from collapsing when content is short while still allowing the image to fill whatever height the content requires.

The quote card is a self-contained white card (`bg-white rounded-2xl p-8` or similar) positioned in the right column. It has no dependency on the background — it could render on any background. The `c-person` attribution inside the card is optional; a quote without attribution is valid.

Left column text color must be set for legibility against the background image. Since background images vary, the section should expose a `text_color` setting (`light` / `dark`) that applies the appropriate Tailwind text utility to the left column.

---

## Open questions

- Should the section expose a `text_color` setting for the left column (light text for dark backgrounds, dark text for light backgrounds)? The current design uses dark text over a light blue image — other background images may require light text.
- Should the quote card position be configurable (e.g. vertically centered vs. top-aligned within the right column)?
