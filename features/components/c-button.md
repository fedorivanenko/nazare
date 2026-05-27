---
schemaVersion: 1

id: c-button
title: Button Snippet
status: done

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - snippets/c-button.liquid

invariants:
  - Component ID is c-button
  - Installs through nazare add c-button
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not require JavaScript
  - Supports one fixed size
  - Supports solid, outline, and ghost color schemes
  - Does not mutate theme scaffold source

nonGoals:
  - Multiple button sizes
  - Icon slots
  - Loading state
  - JavaScript behavior
  - Form submission helpers beyond native link/button markup
  - Theme scaffold template placement
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/c-button/**
      - nazare.registry.yml c-button metadata
      - test/ registry component validation for c-button
      - README.md default component notes if needed

  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Button Snippet

## Goal

Add an installable Shopify button snippet for consistent storefront actions across registry sections.

The snippet gives future components a small shared CTA primitive with one standard size and three visual schemes: solid, outline, and ghost.

---

## Scope

Included:

- `components/c-button/c-button.liquid`
- `nazare.registry.yml` component metadata for `c-button`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-button` installs the snippet from the local registry
- snippet parameters:
  - `label`
  - `url`
  - `scheme`: `solid`, `outline`, or `ghost`
  - optional `class`

Component metadata:

```yaml
components:
  c-button:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-button/c-button.liquid
        to: snippets/c-button.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

Snippet render contract:

```liquid
{% render 'c-button', label: 'Shop now', url: routes.all_products_collection_url, scheme: 'solid' %}
```

- Renders an anchor when both `label` and `url` are present.
- Renders nothing when `label` or `url` is blank.
- Uses a fixed medium size.
- Defaults to `solid` when `scheme` is blank or unknown.
- `solid` renders a filled primary action.
- `outline` renders a bordered secondary action.
- `ghost` renders a low-emphasis text action.
- Optional `class` appends caller-provided Tailwind utility classes to the root anchor.

---

## Success behavior

- `nazare list` shows `c-button` as available after registry update.
- `nazare add c-button` installs `snippets/c-button.liquid`.
- Installed snippet renders a working link when `label` and `url` are provided.
- Blank `label` or blank `url` renders no anchor.
- Missing or invalid `scheme` falls back to `solid`.
- Snippet supports exactly three schemes: `solid`, `outline`, and `ghost`.
- Snippet uses one fixed size for all schemes.
- Snippet uses Tailwind utility classes only.
- Component source checksum matches registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails existing component validation/tests.
- Missing component source file fails registry component tests.
- Snippet must not depend on JavaScript, sections, templates, or scaffold changes.
- Blank inputs must not render broken links or empty interactive elements.

---

## Verification

Result: done.

- [x] component source exists at registry path
- [x] registry contains `c-button` metadata
- [x] registry checksum matches component source bytes
- [x] component metadata validates with component registry parser
- [x] snippet renders link when label and URL are present
- [x] snippet renders nothing when label or URL is blank
- [x] snippet supports solid, outline, and ghost schemes
- [x] invalid or missing scheme falls back to solid
- [x] snippet uses one fixed size
- [x] snippet uses Tailwind utilities
- [x] `nazare add c-button` smoke installs snippet from local registry

---

## Architecture notes

Keep this component self-contained. No JavaScript asset, no section, no template changes, and no custom CSS.

Use Liquid branches for scheme-specific Tailwind classes. Keep markup minimal so registry sections can render it without coupling to section-specific settings.

The snippet is a presentational CTA link primitive. Native `<button>` rendering is deferred until a form-specific use case appears.

---

## Open questions

None.
