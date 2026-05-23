# Nazare Test Plan Spec

## Purpose

This document defines the v1 test approach for Nazare CLI, Nazare Vite plugin, and Nazare runtime behavior.

## Test stack

V1 should use:

- `vitest` for unit and integration tests
- `jsdom` for runtime DOM tests
- filesystem fixtures in temporary directories for CLI and plugin tests
- snapshot or golden-file assertions for generated outputs and command output

V1 does not require browser end-to-end testing.

## Fixture strategy

Tests should use small fixture directories representing:

- registry repos
- initialized local theme repos
- local theme repos after theme pulls
- local theme repos after component adds
- plugin scanner input cases

Fixtures should be copied into temporary directories per test to avoid cross-test mutation.

## Registry manifest fixture cases

Required fixture cases:

- valid minimal manifest
- valid manifest with `components: {}`
- missing `theme` block
- theme present but missing `source`
- invalid theme version
- unsafe theme `from` path
- unsafe theme `to` path
- duplicate theme destination path
- missing requested component
- invalid component version
- dependency cycle
- unsafe component `to` path
- forbidden component destination
- missing declared source file

## CLI acceptance cases

### `init`

- creates `nazare.config.yml`
- creates initial `nazare.lock.yml`
- fails if `nazare.lock.yml` already exists

### `theme pull`

- copies missing theme files
- prompts on existing files in interactive TTY mode
- fails before writes on conflicts in non-interactive mode without `--yes`
- `--yes` overwrites all conflicts
- all skipped results in success and unchanged lockfile
- copied file updates lockfile theme metadata
- theme version is recorded in lockfile
- theme source is recorded in lockfile

### `add`

- installs component files
- installs transitive dependencies
- prompts on file conflicts for direct component files and dependency files in interactive TTY mode
- fails before writes on conflicts in non-interactive mode without `--yes`
- `--yes` overwrites all conflicts
- skipped files warn about incomplete local state
- lockfile updates only for components with written files

### `list`

- outputs component names with origin versions

### `installed`

- outputs theme when present
- outputs installed component names with installed versions

### `outdated`

- outputs all installed tracked items
- shows installed version and origin version for each item
- uses `nazare.config.yml` registry origin when config and lockfile registry provenance differ
- warns when config and lockfile registry provenance differ

### JSON output

- `list --json` outputs `{ "items": [...] }`
- `installed --json` outputs theme first when present, then components by name
- `outdated --json` outputs theme first when present, then components by name
- failing command with `--json` outputs `{ "error": { "code", "message" } }`

### Exit codes

- validation errors exit `2`
- registry fetch or origin resolution errors exit `3`
- user-canceled or unresolved conflict errors exit `4`
- skipped conflicts resolved by user choice still exit `0`

## Plugin fixture cases

### Render graph

- single section with no snippets
- section with one static snippet render
- nested static snippet renders
- dynamic render warning case
- missing snippet error case
- render cycle error case

### JS mounts

- section file with `data-nazare-use`
- snippet file with `data-nazare-use`
- multiple nodes using same module key
- invalid module key error
- missing module file error

### CSS directive

- no directive defaults to `normal`
- `nazare:css preload`
- duplicate directive error
- directive after first rendered output error
- directive inside snippet file error
- invalid directive value error
- missing section CSS bridge render warning

### Generated outputs

- generated `styles/<section-name>.css`
- generated `scripts/theme.js`
- generated `snippets/section-css.liquid`
- generated `snippets/section-css-preloads.liquid`
- stale generated file cleanup after section removal

### Output naming

- `sections/s-hero` maps to `assets/sections--s-hero.js`
- `snippets/c-video` maps to `assets/snippets--c-video.js`
- section CSS maps to `assets/<section-name>.css`

## Runtime tests

Required runtime tests:

- mounts each DOM node once per module key
- imports each module once per module key
- cleans mounted nodes on subtree destroy
- isolates module import failure from other mounts
- isolates `init(node)` failure from other mounts
- isolates `destroy(node)` failure from other cleanup
- clears mounted state even when `destroy(node)` throws
- does not mark nodes mounted when import fails
- does not mark nodes mounted when `init(node)` throws
- does not call `destroy(node)` for nodes that were not successfully initialized
- handles `shopify:section:load`
- handles `shopify:section:unload`

## Golden outputs

Use snapshot or golden-file assertions for:

- generated CSS entry files
- generated Liquid bridge snippets
- generated `scripts/theme.js`
- CLI text output for `list`, `installed`, and `outdated`

## Non-goals

V1 test plan does not require:

- browser end-to-end tests
- visual regression tests
- full Shopify preview automation
- networked integration against real GitHub repos in normal test runs
