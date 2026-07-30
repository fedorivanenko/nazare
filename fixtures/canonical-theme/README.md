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
