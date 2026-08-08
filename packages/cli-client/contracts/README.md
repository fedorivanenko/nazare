# Stable theme-inspection contracts

The stable machine interface is one-shot JSON from:

- `nazare inspect theme --format json` — `theme-inspection-v1.schema.json`
- `nazare inspect impact … --format json` — `theme-impact-v1.schema.json`
- `nazare inspect metafield … --format json` — `theme-metafield-v2.schema.json`

`text` and `dot` formats are human-facing renderings. Their wording, spacing, and layout are not compatibility contracts.

## Compatibility policy

Contract versions are independent from the package version and appear in every JSON result.

For an existing contract version, Nazare preserves:

- required and optional field names
- field types and enum meanings
- stable IDs and deterministic array ordering
- diagnostic shape
- uncertainty and certainty semantics

Adding, removing, renaming, or reinterpreting a field requires a new result version and a new schema filename. Existing schema and golden files remain immutable. A superseded stable version receives a deprecation notice for at least one minor release before its implementation may be removed.

Bug fixes may change values when the old value violated the documented semantics. Such changes require a golden-contract review in the pull request.

## Enforcement

`inspection-contracts.test.mjs` builds a deterministic mixed Shopify fixture, validates live results against the committed JSON Schemas, then compares exact results with committed golden examples. A contract change therefore fails CI unless its schema/version and compatibility decision are explicit.

Low-level `inspect ast|ir|graph|schema|artifact|dump` projections are not covered. They expose compiler implementation details and remain experimental under feature `compiler-inspection`.
