---
schemaVersion: 1

id: c-ratings-judgeme
title: Judge.me Ratings Adapter
status: done

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-ratings

surfaces:
  storefront:
    - snippets/c-ratings-judgeme.liquid
    - scripts/snippets/c-ratings-judgeme.js

invariants:
  - Component ID is c-ratings-judgeme
  - Installs through nazare add c-ratings-judgeme
  - Registry metadata includes checksum for every component file
  - Renders a hidden page-level trigger element with no visible output
  - Must be rendered once per page, typically in theme.liquid
  - Makes one batched request to the Judge.me public widget API per page load
  - Calls NazareRatings.update() for each product whose ratings are returned
  - Does not render any visible markup or styles
  - Does not re-implement star display logic

nonGoals:
  - Star or count display (that is c-ratings)
  - Review list or review form embedding
  - Authenticated Judge.me API access (uses public widget API only)
  - Multiple simultaneous provider adapters on the same page
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/c-ratings-judgeme/**
      - nazare.registry.yml c-ratings-judgeme metadata
      - test/ registry component validation for c-ratings-judgeme
  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
    - components/c-ratings/**

---

# Judge.me Ratings Adapter

## Goal

Add an installable adapter that fetches product ratings from Judge.me and feeds them into the `c-ratings` display component.

The adapter is a page-level service: it renders once in the theme layout, collects all product handles on the page that need ratings, makes one batched API call to Judge.me, and pushes the results into `c-ratings` instances via the shared `NazareRatings` store. No display logic lives here.

---

## Scope

Included:

- `components/c-ratings-judgeme/c-ratings-judgeme.liquid`
- `components/c-ratings-judgeme/c-ratings-judgeme.js`
- `nazare.registry.yml` component metadata for `c-ratings-judgeme`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-ratings-judgeme` installs the snippet and script from the local registry
- snippet parameters: none — the snippet renders a fixed hidden trigger element

Component metadata:

```yaml
components:
  c-ratings-judgeme:
    version: 1.0.0
    type: snippet
    dependencies:
      - c-ratings
    files:
      - from: components/c-ratings-judgeme/c-ratings-judgeme.liquid
        to: snippets/c-ratings-judgeme.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
      - from: components/c-ratings-judgeme/c-ratings-judgeme.js
        to: scripts/snippets/c-ratings-judgeme.js
        checksum:
          algorithm: sha256
          value: <sha256>
```

Snippet render contract:

- Root element is a `<div hidden data-nazare-use="snippets/c-ratings-judgeme">`.
- No visible output, no settings, no configurable parameters.
- Placed once in `theme.liquid` (or equivalent layout file) so the Nazare runtime initializes it once per page.
- The Liquid file is intentionally minimal — all logic lives in the JS module.

Render contract example:

```liquid
{% comment %} In theme.liquid, before </body>: {% endcomment %}
{% render 'c-ratings-judgeme' %}
```

JavaScript behavior contract:

- `init(root)` is called once when the Nazare runtime encounters the trigger element.
- On init:
  1. Reads `window.Shopify.shop` for the store domain (required by Judge.me API).
  2. Queries `document.querySelectorAll('[data-c-ratings-product]')` to collect all product handles on the page.
  3. Deduplicates handles and filters to those returned by `NazareRatings.pendingHandles()` (skipping products already seeded server-side).
  4. If no pending handles, exits without a network request.
  5. Makes one or more requests to the Judge.me public widget API to fetch scores and review counts for all pending handles.
  6. For each result, calls `NazareRatings.update(handle, score, count)`.
- `destroy(root)`: no-op — the adapter makes no persistent subscriptions.
- If `window.Shopify.shop` is absent, logs a warning and exits without a network request.
- Failed or empty API responses are handled per-handle: handles that return no data are left in placeholder state, no errors thrown.

---

## Success behavior

- `nazare list` shows `c-ratings-judgeme` as available.
- `nazare add c-ratings-judgeme` installs `snippets/c-ratings-judgeme.liquid`, `scripts/snippets/c-ratings-judgeme.js`, and transitively installs `c-ratings`.
- `{% render 'c-ratings-judgeme' %}` in theme.liquid renders a hidden element with no visible output.
- On page load, all `c-ratings` instances whose products have Judge.me reviews are populated with score and count.
- Products already seeded server-side (score present at init) are skipped in the API request.
- If no `c-ratings` instances are on the page, no network request is made.
- Judge.me API errors leave affected `c-ratings` instances in placeholder state without throwing.
- Checksums match registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails component validation tests.
- Missing `window.Shopify.shop` logs a warning and skips the API call without throwing.
- Network failure or non-200 response from Judge.me leaves affected instances in placeholder state.
- Malformed API response for a single handle is skipped; other handles are still processed.
- Missing `c-ratings` dependency (NazareRatings store absent) logs a warning and exits cleanly.
- Failure cases do not mutate unrelated user files.

---

## Verification

- [x] component source exists at registry paths
- [x] registry contains `c-ratings-judgeme` metadata with Liquid, JS, and c-ratings dependency
- [x] registry checksums match component source bytes
- [ ] component metadata validates with component registry parser
- [x] snippet renders a hidden element with `data-nazare-use="snippets/c-ratings-judgeme"`
- [x] snippet renders no visible output
- [x] JS collects product handles from `[data-c-ratings-product]` elements on page
- [x] JS skips handles already seeded server-side via `NazareRatings.pendingHandles()`
- [x] JS makes no network request when no pending handles exist
- [x] JS calls `NazareRatings.update()` for each handle returned by Judge.me
- [ ] c-ratings instances update their display after adapter runs
- [x] missing `window.Shopify.shop` exits without throwing
- [ ] `nazare add c-ratings-judgeme` smoke installs snippet and script from local registry

---

## Architecture notes

This adapter is the canonical example for implementing any ratings provider. A new provider (Yotpo, Stamped, Okendo, etc.) follows the same shape: a hidden trigger Liquid, a JS module that queries `[data-c-ratings-product]`, fetches from the provider's API, and calls `NazareRatings.update()`. Only the fetch logic changes.

The Judge.me public widget API does not require authentication — it uses the shop domain as the identifier. One request per product handle is sufficient; if the API supports a batch endpoint, use it to minimize round-trips.

Placing the `{% render 'c-ratings-judgeme' %}` call at the bottom of `theme.liquid` (before `</body>`) ensures the Nazare runtime encounters it after all `c-ratings` instances in the page body have been initialized. This makes `NazareRatings.pendingHandles()` reliable.

Do not import or call anything from `c-ratings.js` directly. The only coupling between adapter and display is `window.NazareRatings`.

---

## Open questions

- Does Judge.me expose a public batch endpoint that accepts multiple handles in one request, or does it require one request per product? Investigate before implementation to choose the right fetch strategy.
