# Canonical theme fixture

Only committed whole-theme semantic fixture. Small synthetic Shopify theme covering canonical whole-theme relationships:
structure, render occurrences and arguments, schema/settings, locales,
metafields, Nazare imports, unresolved targets, inferred capabilities, and
Liquid/CSS/JavaScript behavior contracts.

Use this corpus for topology and cold/incremental equivalence tests. It is also
the seed for `benchmarks/scaffold-theme.mjs`, which expands it into deterministic
400–800-file performance themes. Generated themes measure scaling; this small
corpus remains readable enough to audit semantic relationships by hand.

Source fragments are synthetic. Add minimized, rewritten shapes from real themes
when they expose a relationship this corpus does not cover; do not commit client
source.

## Queryable product-card slice

Use this small vertical slice when designing typed semantic entities, relations,
provenance, boundaries, and cross-language joins:

- `layout/theme.liquid` conditionally loads `assets/theme.js` and always loads
  `assets/theme.css`.
- `templates/index.json` configures `sections/featured-collection.liquid` with a
  literal setting.
- `templates/product.json` configures `sections/main-product.liquid` with a
  metafield dynamic-source expression.
- `sections/featured-collection.liquid` passes a Shopify runtime product through
  a render argument to `snippets/product-card.liquid`.
- `snippets/product-card.liquid` derives a DOM value with `handleize`, emits
  custom-element/class/data-attribute hooks, renders `snippets/price.liquid`,
  and reads `product.custom.subtitle`.
- `.shopify/metafields.json` supplies the optional external metafield definition.
- `assets/theme.js` defines and queries matching hooks, joins a dataset value to
  a dynamic selector, mutates shared state, and emits explicit runtime uncertainty.
- `assets/theme.css` selects the hooks under a media condition and deliberately
  reuses `.is-active` for an unrelated cart drawer, preventing name-only joins
  from being treated as scoped proof.

Run the same semantic scenario with and without the metafield snapshot. Absence
of the snapshot means `external-data-required`, not a missing definition.
