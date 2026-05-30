---
schemaVersion: 1

id: c-bundle-item
title: Bundle Item Snippet
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - snippets/c-bundle-item.liquid

invariants:
  - Component ID is c-bundle-item
  - Installs through nazare add c-bundle-item
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript
  - Renders nothing when both product and name are blank
  - Product image renders only when product is present and has a featured image
  - Benefit checkmark icons are inline SVG — no external asset dependency
  - Benefits list renders only when benefits string is non-empty
  - Does not mutate theme scaffold source

nonGoals:
  - Price display
  - Ratings
  - Swatches or variant selection
  - Add-to-cart
  - Link to product page
  - JavaScript behavior
  - Custom CSS files
  - Theme scaffold template placement

codebaseOwnership:
  owns:
    repo:
      - components/c-bundle-item/**
      - nazare.registry.yml c-bundle-item metadata
      - test/ registry component validation for c-bundle-item

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Bundle Item Snippet

## Goal

Add an installable Shopify snippet for displaying a single product within a bundle — its image, name, and a short list of benefit bullet points with inline checkmark icons.

The snippet is intentionally stripped of commerce elements (no price, no CTA, no swatches) so it reads as a component of a larger bundle offer rather than a standalone purchasable product. It is distinct from `c-product-card` and `c-product-chip` in both purpose and content.

---

## Scope

Included:

- `components/c-bundle-item/c-bundle-item.liquid`
- `nazare.registry.yml` component metadata for `c-bundle-item`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-bundle-item` installs the snippet from the local registry
- snippet parameters:
  - `product` (optional) — Shopify product object; used for the featured image
  - `name` (optional) — display name; defaults to `product.title` when product is present
  - `benefits` (optional) — newline-separated string of benefit lines, e.g. `"Alkalizes your gut\nProvides steady energy"`
  - optional `class`

Component metadata:

```yaml
components:
  c-bundle-item:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-bundle-item/c-bundle-item.liquid
        to: snippets/c-bundle-item.liquid
        checksum:
          algorithm: sha256
          value: ""
```

Snippet render contract:

```liquid
{% render 'c-bundle-item',
  product: product,
  benefits: 'Alkalizes your gut\nProvides steady energy'
%}
```

- Renders nothing when both `product` and `name` are blank.
- Product image renders above the name when `product` is present and has a featured image; renders nothing in the image slot when image is absent.
- Name renders in bold type; uses `product.title` when `name` is blank and `product` is present.
- Benefits string is split by newline (`\n`) in Liquid; each line renders as a list item with an inline SVG checkmark icon.
- Benefits list renders only when `benefits` is non-empty.
- Optional `class` appends caller-provided Tailwind utility classes to the root element.

---

## Success behavior

- `nazare list` shows `c-bundle-item` as available after registry update.
- `nazare add c-bundle-item` installs `snippets/c-bundle-item.liquid`.
- Blank product and blank name renders nothing.
- Product image renders when product has a featured image.
- Image slot renders nothing when product has no featured image.
- Name renders in bold; falls back to product.title when name param is blank.
- Each benefit line renders as a list item with an inline SVG checkmark.
- Benefits list is absent when benefits string is empty.
- Snippet uses Tailwind utility classes only.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Blank product and blank name renders nothing without broken markup.
- Empty benefits string renders no list without empty `<ul>` element.
- Snippet must not depend on JavaScript, sections, templates, or scaffold changes.

---

## Verification

- [ ] component source exists at registry path
- [ ] registry contains `c-bundle-item` metadata with no dependencies
- [ ] registry checksum matches component source bytes
- [ ] component metadata validates with component registry parser
- [ ] blank product and blank name renders nothing
- [ ] product image renders when featured image present
- [ ] image slot absent when no featured image
- [ ] name renders in bold, falls back to product.title
- [ ] each benefit line renders with inline SVG checkmark
- [ ] empty benefits renders no list element
- [ ] snippet uses Tailwind utilities only
- [ ] `nazare add c-bundle-item` smoke installs snippet from local registry

---

## Architecture notes

Benefits are passed as a newline-separated string rather than a Liquid array because Shopify section block settings do not support arrays. Callers (sections) store benefits in a `textarea` setting and pass the raw value; the snippet splits on `\n` using Liquid's `split` filter.

Checkmark icons are inline SVG in the Liquid loop — one `<svg>` per benefit line. No asset request, no snippet dependency.

The snippet has no link to the product page by design. Bundle items are presented as components of an offer, not as individual purchase targets. Callers that need a linked version should use `c-product-chip` instead.

---

## Open questions

None.
