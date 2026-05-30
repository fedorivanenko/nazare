# Agent Instructions

## Feature registries — source of truth

The YAML files in `features/` are the single source of truth for all features in this codebase. Before starting any feature-related task, look up the feature here first.

| File | Covers | ID prefix |
|---|---|---|
| `features/registry.cli.yaml` | CLI commands and build tooling | `cli-*`, `component-*`, `theme-*`, `update` |
| `features/registry.sections.yaml` | Shopify theme sections | `s-*` |
| `features/registry.snippets.yaml` | Shopify theme snippets / components | `c-*` |

**Workflow for any feature task:**
1. Find the feature entry in the relevant YAML by `id`.
2. Check its `status` and `file:` field.
3. If `file:` exists, read that MD for the full spec — goal, scope, invariants, dependencies, success/failure behavior, verification checklist.
4. Use `dependencies` and `sections` fields in the MD/YAML to understand related features and files before making changes.

Each YAML entry carries: `id`, `title`, `description`, `status`, and a `file:` pointer to its feature MD when one exists. Entries without `file:` are spec-discovered but not yet scoped for build (`status: not-started`).

**Design spec → registry → feature pipeline:**

Design screenshots are analysed into page specs (`docs/*-spec.md`). Those feed the YAML registries. When a feature is scoped for build, a `file:` pointer is added linking to `features/components/<id>.md` or `features/cli/<id>.md`.

Flow: `docs/*-spec.md` → `features/registry.*.yaml` (registry) → `features/{cli,components}/*.md` (build spec)

---

## Feature scoping

When asked to scope, plan, or describe a feature, read `workflow/feature.md` and `features/feature.schema.yaml` before drafting.

Feature docs are stored by surface:

- CLI features: `features/cli/<feature-id>.md`
- Storefront/component features: `features/components/<component-id>.md`

Use the schema-required frontmatter and sections. Keep scope small, define success/failure behavior, ownership boundaries, verification checklist, architecture notes, and open questions.

For component features, also read `docs/policies/naming-policy.md` and existing `features/components/*.md` examples. Component source lives under `components/<component-id>/`, registry metadata lives in `nazare.registry.yml`, and install targets follow the component type (`s-*` sections to `sections/*.liquid`, `c-*` snippets to `snippets/*.liquid`). Registry file entries need SHA-256 checksum metadata.

## Versioning

Follow `docs/policies/release-policy.md` for CLI versioning and releases

## Updating component files

When a component source file changes, you must:

1. Apply the fix to the source file under `components/<component-id>/`.
2. Recompute its SHA-256: `shasum -a 256 components/<component-id>/<file>`.
3. Update the `checksum.value` for that file in `nazare.registry.yml`.
4. Bump the component `version` (patch for bug fixes) in `nazare.registry.yml`.

Consumers run `nazare update <component-id>` to pull the new version — the CLI rejects installs where the local file SHA doesn't match the registry entry, so both the SHA and version must be updated before pushing.

**Dev server note:** `nazare-dev registry serve` reads files via `git show <ref>:<path>`, not from the working tree. Uncommitted changes to component sources or `nazare.registry.yml` are invisible to consumers. Commit before running `nazare update` against the local dev server.
