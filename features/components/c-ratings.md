---
schemaVersion: 1

id: c-ratings
title: Ratings Display Snippet
status: planned

dependencies:
  - component-registry
  - component-list
  - component-add

surfaces:
  storefront:
    - snippets/c-ratings.liquid
    - scripts/snippets/c-ratings.js

invariants:
  - Component ID is c-ratings
  - Installs through nazare add c-ratings
  - Registry metadata includes checksum for every component file
  - Uses Tailwind utilities for all styling
  - Does not fetch ratings from any provider
  - All star rendering happens in JavaScript, not Liquid
  - Score and count can be seeded server-side via Liquid parameters or populated client-side by a provider adapter
  - Renders a placeholder state when score is not available at init time
  - Exposes a global NazareRatings store so provider adapters can push data without coupling to display internals
  - Accessible aria-label reflects current score and count when populated
  - Renders nothing when the product handle is blank

nonGoals:
  - Fetching ratings from any provider (that belongs to provider adapter components)
  - Review list, review form, or review submission UI
  - Cross-provider aggregation or fallback
  - Shopify metafield read logic (caller passes score and count if available from metafields)
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/c-ratings/**
      - nazare.registry.yml c-ratings metadata
      - test/ registry component validation for c-ratings
  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
---

# Ratings Display Snippet

## Goal

Add an installable Shopify snippet that renders a star rating display for a product.

The snippet owns only the display — stars, count, accessible label, and placeholder state. It exposes a global store so any provider adapter can push score and count data without knowing how the display works. This decoupling means the theme installs one display component and one provider-specific adapter, and the two communicate through a stable contract.

---

## Scope

Included:

- `components/c-ratings/c-ratings.liquid`
- `components/c-ratings/c-ratings.js`
- `nazare.registry.yml` component metadata for `c-ratings`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-ratings` installs the snippet and script from the local registry
- snippet parameters:
  - `product`: required Shopify product object; `product.handle` is the key used to match adapter updates
  - `score`: optional number 0–5; seeds the display server-side (e.g. from a metafield) without waiting for an adapter fetch
  - `count`: optional integer review count; seeds the display server-side
  - `url`: optional URL to link the rating widget to (e.g. the reviews section anchor)
  - `class`: optional additional classes on the root element

Component metadata:

```yaml
components:
  c-ratings:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-ratings/c-ratings.liquid
        to: snippets/c-ratings.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
      - from: components/c-ratings/c-ratings.js
        to: scripts/snippets/c-ratings.js
        checksum:
          algorithm: sha256
          value: <sha256>
```

Snippet render contract:

- Root element uses `data-nazare-use="snippets/c-ratings"` so the Nazare runtime loads `scripts/snippets/c-ratings.js`.
- Root element carries `data-c-ratings-product="{{ product.handle }}"` as the stable key.
- When `score` and `count` are provided by the caller, root carries `data-c-ratings-score` and `data-c-ratings-count`; JS reads these on init and renders immediately without waiting for an adapter.
- When score is absent at init time, JS renders a placeholder (empty stars or skeleton) until an adapter calls `NazareRatings.update()`.
- Star rendering always happens in JS — no star markup in Liquid.
- When `url` is provided the root element is an `<a>` tag; otherwise a `<div>`.
- Renders nothing when `product` is blank.

Render contract example:

```liquid
{% render 'c-ratings', product: product %}

{% comment %} With server-side metafield seed: {% endcomment %}
{% render 'c-ratings',
  product: product,
  score: product.metafields.reviews.rating.value.rating,
  count: product.metafields.reviews.rating_count.value,
  url: '#reviews'
%}
```

JavaScript behavior contract:

- `init(root)` is idempotent; re-calling on the same root is a no-op.
- On init: reads `data-c-ratings-score` and `data-c-ratings-count`.
  - If both present: renders stars and count immediately.
  - If absent: renders placeholder state.
- Registers the instance in `window.NazareRatings` keyed by product handle.
- `window.NazareRatings`:
  - Created once if absent, reused by all instances and adapters.
  - `register(handle, instance)` — called by `init`.
  - `unregister(root)` — called by `destroy`.
  - `update(handle, score, count)` — called by provider adapters; finds all registered instances for that handle and re-renders with new data.
  - `pendingHandles()` — returns the set of product handles whose instances have no score yet; adapters can use this to know what to fetch.
- `destroy(root)`: unregisters from the store and clears the mount map entry.
- Stars are rendered as a row of SVG or Unicode symbols with aria-hidden; the root carries the accessible label.

---

## Success behavior

- `nazare list` shows `c-ratings` as available.
- `nazare add c-ratings` installs `snippets/c-ratings.liquid` and `scripts/snippets/c-ratings.js`.
- `{% render 'c-ratings', product: product %}` renders without Liquid errors.
- Without score/count, the component renders a placeholder state.
- With score/count provided, the component renders stars and count immediately on page load.
- A provider adapter calling `NazareRatings.update(handle, score, count)` causes all matching instances on the page to re-render with live data.
- `NazareRatings.pendingHandles()` returns handles for instances that have no score yet.
- Accessible label reflects populated score and count.
- `destroy(root)` unregisters instances from the store.
- Checksums match registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails component validation tests.
- Missing `product` parameter renders nothing without Liquid errors.
- `NazareRatings.update()` called with an unknown handle is a no-op and does not throw.
- Score out of the 0–5 range clamps gracefully rather than breaking the star layout.
- JS initialization failure leaves the root element in its placeholder state.
- Failure cases do not mutate unrelated user files.

---

## Verification

- [ ] component source exists at registry paths
- [ ] registry contains `c-ratings` metadata with Liquid and JS files
- [ ] registry checksums match component source bytes
- [ ] component metadata validates with component registry parser
- [ ] snippet root declares `data-nazare-use="snippets/c-ratings"`
- [ ] snippet uses Tailwind utilities only
- [ ] snippet renders nothing when `product` is blank
- [ ] JS renders placeholder when no score/count on init
- [ ] JS renders stars immediately when score/count are present as data attributes
- [ ] `NazareRatings.update(handle, score, count)` re-renders all matching instances
- [ ] `NazareRatings.pendingHandles()` returns correct set before adapter runs
- [ ] accessible label reflects score and count after update
- [ ] `destroy(root)` removes instance from store
- [ ] `nazare add c-ratings` smoke installs snippet and script from local registry

---

## Architecture notes

All rendering lives in JS. Liquid emits only the root element with data attributes — no star SVGs, no count text. This keeps the server-rendered HTML minimal and ensures the placeholder → populated transition is handled in one place.

The `NazareRatings` global is the only contract between this component and any adapter:

```js
window.NazareRatings = window.NazareRatings || {
  instances: new Map(),   // handle → Set<instance>
  register(handle, instance) {},
  unregister(root) {},
  update(handle, score, count) {},
  pendingHandles() {},
};
```

Adapters must not import or depend on `c-ratings.js` directly. They interact only through `window.NazareRatings`. This means adapters can be developed and installed independently.

The `url` parameter controls whether the root is an `<a>` or `<div>`. Decide in Liquid, not JS, so the correct element type is in the initial HTML.

---

## Open questions

None.
