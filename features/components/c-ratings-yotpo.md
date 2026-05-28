---
schemaVersion: 1

id: c-ratings-yotpo
title: Yotpo Ratings Adapter
status: done

dependencies:
  - component-registry
  - component-list
  - component-add
  - c-ratings

surfaces:
  storefront:
    - snippets/c-ratings-yotpo.liquid
    - scripts/snippets/c-ratings-yotpo.js

invariants:
  - Component ID is c-ratings-yotpo
  - Installs through nazare add c-ratings-yotpo
  - Registry metadata includes checksum for every component file
  - Renders a hidden page-level trigger element with no visible output
  - Must be rendered once per page, typically in theme.liquid
  - Reads the Yotpo public app key from shop.metafields.integrations.yotpo_app_key
  - Renders nothing when the app key metafield is blank
  - Makes one or more requests to the Yotpo public bottomline API per page load
  - Calls NazareRatings.update() for each product whose ratings are returned
  - Does not render any visible markup or styles
  - Does not re-implement star display logic
  - Does not modify settings_schema.json or any scaffold source

nonGoals:
  - Star or count display (that is c-ratings)
  - Review list or review form embedding
  - Authenticated Yotpo API access (uses public app key only)
  - Multiple simultaneous provider adapters on the same page
  - Custom CSS files

codebaseOwnership:
  owns:
    repo:
      - components/c-ratings-yotpo/**
      - nazare.registry.yml c-ratings-yotpo metadata
      - test/ registry component validation for c-ratings-yotpo
  mustNotModify:
    - theme/default/ scaffold source content
    - bin/nazare.js command behavior
    - install metadata
    - existing component source files
    - components/c-ratings/**
---

# Yotpo Ratings Adapter

## Goal

Add an installable adapter that fetches product ratings from Yotpo and feeds them into the `c-ratings` display component.

The adapter follows the same page-level service pattern as other provider adapters: one hidden trigger element in the theme layout, one batched fetch per page, results pushed into `c-ratings` via `NazareRatings.update()`. The Yotpo public app key is read from a shop metafield set once in the Shopify admin — no Liquid parameters, no scaffold changes, no hardcoded values in theme source.

---

## Scope

Included:

- `components/c-ratings-yotpo/c-ratings-yotpo.liquid`
- `components/c-ratings-yotpo/c-ratings-yotpo.js`
- `nazare.registry.yml` component metadata for `c-ratings-yotpo`
- checksum validation coverage for committed component source files
- smoke coverage that `nazare add c-ratings-yotpo` installs the snippet and script from the local registry
- snippet parameters: none

App key setup (one-time, done by merchant in Shopify admin):

1. Shopify admin → **Custom data → Shops**
2. Add metafield: namespace `integrations`, key `yotpo_app_key`, type *Single line text*
3. Paste Yotpo public app key as the value

Component metadata:

```yaml
components:
  c-ratings-yotpo:
    version: 1.0.0
    type: snippet
    dependencies:
      - c-ratings
    files:
      - from: components/c-ratings-yotpo/c-ratings-yotpo.liquid
        to: snippets/c-ratings-yotpo.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
      - from: components/c-ratings-yotpo/c-ratings-yotpo.js
        to: scripts/snippets/c-ratings-yotpo.js
        checksum:
          algorithm: sha256
          value: <sha256>
```

Snippet render contract:

- Liquid reads `shop.metafields.integrations.yotpo_app_key`.
- If the metafield is blank, renders nothing.
- If present, renders `<div hidden data-nazare-use="snippets/c-ratings-yotpo" data-c-ratings-yotpo-app-key="{{ app_key | escape }}">`.
- No visible output, no parameters on the render call.
- Placed once in `theme.liquid` before `</body>`.

Render contract example:

```liquid
{% comment %} In theme.liquid, before </body>: {% endcomment %}
{% render 'c-ratings-yotpo' %}
```

JavaScript behavior contract:

- `init(root)` is called once when the Nazare runtime encounters the trigger element.
- On init:
  1. Reads `data-c-ratings-yotpo-app-key` from the root element.
  2. If the key is absent or empty, logs a warning and exits.
  3. Queries `document.querySelectorAll('[data-c-ratings-product]')` to collect all product handles on the page.
  4. Filters to `NazareRatings.pendingHandles()` (skips products already seeded server-side).
  5. If no pending handles, exits without a network request.
  6. Fetches ratings from the Yotpo public bottomline API using the app key and product identifiers.
  7. For each result, calls `NazareRatings.update(handle, score, count)`.
- `destroy(root)`: no-op — the adapter makes no persistent subscriptions.
- Failed or empty API responses per product are handled gracefully: that product stays in placeholder state, no errors thrown.

---

## Success behavior

- `nazare list` shows `c-ratings-yotpo` as available.
- `nazare add c-ratings-yotpo` installs `snippets/c-ratings-yotpo.liquid`, `scripts/snippets/c-ratings-yotpo.js`, and transitively installs `c-ratings`.
- `{% render 'c-ratings-yotpo' %}` renders a hidden element when the app key metafield is set, nothing when it is blank.
- On page load, all `c-ratings` instances whose products have Yotpo reviews are populated with score and count.
- Products already seeded server-side are skipped in the API request.
- Blank app key metafield renders no element and makes no network request.
- If no `c-ratings` instances are on the page, no network request is made.
- Yotpo API errors leave affected instances in placeholder state without throwing.
- Checksums match registry metadata.

---

## Failure behavior

- Invalid registry metadata or checksum mismatch fails component validation tests.
- Blank app key metafield renders nothing and makes no network request.
- Blank app key data attribute (edge case: metafield set to whitespace) logs a warning and skips the API call without throwing.
- Network failure or non-200 response from Yotpo leaves affected instances in placeholder state.
- Malformed API response for a single product is skipped; other products are still processed.
- Missing `c-ratings` dependency (`NazareRatings` store absent) logs a warning and exits cleanly.
- Failure cases do not mutate unrelated user files.

---

## Verification

- [x] component source exists at registry paths
- [x] registry contains `c-ratings-yotpo` metadata with Liquid, JS, and c-ratings dependency
- [x] registry checksums match component source bytes
- [ ] component metadata validates with component registry parser
- [x] snippet reads app key from `shop.metafields.integrations.yotpo_app_key`
- [x] snippet renders nothing when metafield is blank
- [x] snippet renders hidden element with `data-nazare-use="snippets/c-ratings-yotpo"` when metafield is set
- [x] JS reads app key from data attribute, not a global variable
- [x] JS collects product handles from `[data-c-ratings-product]` elements on page
- [x] JS skips handles already seeded server-side via `NazareRatings.pendingHandles()`
- [x] JS makes no network request when no pending handles exist
- [x] JS calls `NazareRatings.update()` for each handle returned by Yotpo
- [ ] `c-ratings` instances update their display after adapter runs
- [x] blank app key data attribute exits without throwing
- [ ] `nazare add c-ratings-yotpo` smoke installs snippet and script from local registry

---

## Architecture notes

The app key is stored in a shop metafield (`shop.metafields.integrations.yotpo_app_key`) rather than passed as a Liquid parameter or hardcoded in theme source. This keeps the render call parameter-free, lets merchants update the key from the Shopify admin without touching Liquid files, and requires no changes to `settings_schema.json`.

The Yotpo public bottomline API endpoint:

```
GET https://api.yotpo.com/products/{app_key}/{external_product_id}/bottomline
```

The `external_product_id` in Yotpo maps to the value set when the product was synced. By default the Yotpo Shopify app uses the Shopify numeric product ID. The handle stored in `data-c-ratings-product` is a string — confirm during implementation whether the store's Yotpo configuration uses handles or numeric IDs, and read the appropriate attribute (`data-c-ratings-product` vs a new `data-c-ratings-product-id`). If numeric IDs are needed, add `data-c-ratings-product-id="{{ product.id }}"` to `c-ratings` Liquid.

---

## Open questions

- Does Yotpo's public API expose a batch endpoint (multiple products per request), or does it require one request per product? A batch endpoint significantly reduces page-load requests on collection pages. Investigate before choosing the fetch strategy.
- Does the target store's Yotpo configuration use product handles or numeric Shopify product IDs as the external product identifier? This determines which attribute the adapter reads.
