# Agent Instructions

## Feature scoping

When asked to scope, plan, or describe a feature, read `workflow/feature.md` and `features/feature.schema.yaml` before drafting.

Feature docs are stored by surface:

- CLI features: `features/cli/<feature-id>.md`
- Storefront/component features: `features/components/<component-id>.md`

Use the schema-required frontmatter and sections. Keep scope small, define success/failure behavior, ownership boundaries, verification checklist, architecture notes, and open questions.

For component features, also read `docs/policies/naming-policy.md` and existing `features/components/*.md` examples. Component source lives under `components/<component-id>/`, registry metadata lives in `nazare.registry.yml`, and install targets follow the component type (`s-*` sections to `sections/*.liquid`, `c-*` snippets to `snippets/*.liquid`). Registry file entries need SHA-256 checksum metadata.

## Versioning

Follow `docs/policies/release-policy.md` for CLI versioning and releases
