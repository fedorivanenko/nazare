---
schemaVersion: 1

id: update
title: Unified Update Command
status: ready

dependencies:
  - cli-install
  - cli-init
  - theme-scaffold
  - theme-build-plugin
  - theme-build-pipeline
  - theme-pull
  - component-registry
  - component-list
  - component-add
  - local-registry-dev-server

surfaces:
  cli:
    - nazare --version
    - nazare update self
    - nazare update self --latest
    - nazare update self --latest --dev
    - nazare update self --version <version>
    - nazare update self --source <ref>
    - nazare update theme
    - nazare update theme --latest
    - nazare update theme --latest --dev
    - nazare update theme --version <version>
    - nazare update theme --source <ref>
    - nazare update theme --force
    - nazare update theme --check
    - nazare update theme --skip-conflicts
    - nazare update <component>
    - nazare update <component> --latest
    - nazare update <component> --latest --dev
    - nazare update <component> --version <version>
    - nazare update <component> --source <ref>
    - nazare update <component> --dry-run
    - nazare update <component> --force
  devCli:
    - nazare-dev registry serve --git-refs

invariants:
  - `packages/nazare/package.json.version` remains the single CLI version source of truth
  - Stable release tags use `vMAJOR.MINOR.PATCH` and never include prerelease identifiers
  - Dev release tags use `vMAJOR.MINOR.PATCH-dev.N`
  - Stable update commands never select dev prerelease tags unless `--dev` is passed
  - `--dev` is valid only with `--latest`
  - `--latest`, `--version`, and `--source` are mutually exclusive
  - Theme and component updates use the current configured registry when no target selector is passed
  - Theme and component updates resolve target registry refs before planning file mutations
  - Registry metadata advances only after the selected theme/component update succeeds
  - Failed updates must leave unrelated files unchanged
  - Theme/component checksum validation remains required before mutation
  - Local modification detection uses lockfile checksums as authority
  - Legacy `nazare self update`, `nazare theme update`, and `nazare registry use` commands are not kept

nonGoals:
  - Publishing to npm or another package registry
  - Automatic background updates
  - Updating all installed components in one command
  - Installing missing components during update
  - Automatically merging user modifications
  - Update state, --continue, or --abort flows
  - Multiple named channels beyond stable and dev
  - JSON output mode
  - Public network hardening for the local dev server

codebaseOwnership:
  owns:
    repo:
      - packages/nazare/bin/nazare.js unified update command handling
      - packages/nazare-dev/bin/nazare-dev.js git-ref-aware file serving
      - packages/nazare/package.json version metadata
      - install.sh ownership and metadata behavior consumed by update self
      - README.md update instructions
      - docs/policies/release-policy.md update channel policy
      - workflow/release.md release/update verification notes
      - test/ CLI and dev CLI update coverage
      - nazare.lock.yml theme and component metadata in user theme repo
    install:
      - ~/.nazare install metadata
      - ~/.local/bin/nazare when Nazare-owned
      - nazare.config.yml registry block when theme/component update succeeds
      - nazare.lock.yml registry/theme/component blocks when theme/component update succeeds

  mustNotModify:
    - unrelated files under ~/.local/bin
    - unrelated files outside ~/.nazare
    - files outside selected theme/component update destinations
    - untracked local files unless they are explicit manifest targets and `--force` is passed
    - files owned by other components
    - existing modified user theme files unless `--force` is passed
---

# Unified Update Command

## Goal

Replace scattered update flows with one predictable command shape: `nazare update <target>`.

Users should update the CLI, theme scaffold, or an installed component with the same channel/version flags. Updating from stable, dev, a specific version, or an explicit ref should not require a separate registry source command.

---

## Scope

Included:

- `nazare --version`
- `nazare update self`
- `nazare update self --latest`
- `nazare update self --latest --dev`
- `nazare update self --version <version>`
- `nazare update self --source <ref>`
- `nazare update theme`
- `nazare update theme --latest`
- `nazare update theme --latest --dev`
- `nazare update theme --version <version>`
- `nazare update theme --source <ref>`
- `nazare update theme --force`
- `nazare update theme --check`
- `nazare update theme --skip-conflicts`
- `nazare update <component>`
- `nazare update <component> --latest`
- `nazare update <component> --latest --dev`
- `nazare update <component> --version <version>`
- `nazare update <component> --source <ref>`
- `nazare update <component> --dry-run`
- `nazare update <component> --force`
- `nazare-dev registry serve --git-refs`
- stable and dev Git tag resolution
- CLI tag/package version verification
- atomic registry metadata advancement for theme/component updates
- README, release policy, release workflow, and Vitest coverage

Removed command surfaces:

- `nazare self update`
- `nazare theme update`
- `nazare registry use`

### Version and tag contract

Allowed stable versions:

```text
0.14.0
14.1.0
```

Allowed dev versions:

```text
0.14.1-dev.0
0.14.1-dev.3
14.2.0-dev.12
```

Tag names must prefix the version with `v`:

```text
v0.14.0
v0.14.1-dev.3
```

`packages/nazare/package.json.version` is the source for the CLI version embedded in an install. A release tag must point to a commit whose package version exactly matches the tag without the leading `v`.

### Target selector contract

All update targets accept the same target selector model:

- no target selector: use the current install source for `self`, or current `nazare.config.yml` registry ref for `theme`/component
- `--latest`: resolve the newest stable tag `vMAJOR.MINOR.PATCH`
- `--latest --dev`: resolve the newest dev prerelease tag `vMAJOR.MINOR.PATCH-dev.N`
- `--version <version>`: normalize to tag `v<version>`
- `--source <ref>`: use the explicit branch, tag, full ref, or commit SHA

Validation:

- `--latest`, `--version`, and `--source` are mutually exclusive
- `--dev` requires `--latest`
- invalid SemVer values fail before mutation

### Command contract

Update CLI from current install source:

```sh
nazare update self
```

Update CLI from stable, dev, version, or source:

```sh
nazare update self --latest
nazare update self --latest --dev
nazare update self --version 0.15.0
nazare update self --source refs/heads/main
```

Update theme from current registry:

```sh
nazare update theme
```

Update theme from stable, dev, version, or source:

```sh
nazare update theme --latest --force
nazare update theme --latest --dev --force
nazare update theme --version 0.15.0 --check
nazare update theme --source v0.15.1-dev.0 --skip-conflicts
```

Update component from current registry:

```sh
nazare update c-button
```

Update component from stable, dev, version, or source:

```sh
nazare update c-button --latest --force
nazare update c-button --latest --dev --force
nazare update c-button --version 0.15.0 --dry-run
nazare update c-button --source v0.15.1-dev.0
```

### Theme update contract

`nazare update theme` safely fast-forwards installed Nazare scaffold files from the configured or selected registry without clobbering user edits.

Local state uses `nazare.lock.yml` checksums:

- unmodified: file exists and SHA-256 equals lockfile checksum
- modified: file exists and SHA-256 differs
- missing: file does not exist
- obsolete: tracked file no longer appears in current manifest by `path`/`source`
- untracked target: manifest target path absent from lockfile `theme.files`

Operation rules:

- validate config, lockfile, manifest, safe paths, and registry checksums before mutation
- update unmodified tracked files when registry content changed
- add checksum/source metadata when local content already equals selected registry content
- copy new manifest files only when target path is absent
- delete obsolete unmodified tracked files
- fail before mutation for modified, missing, obsolete modified, or untracked target conflicts unless `--force` or `--skip-conflicts` is passed
- `--force` may overwrite modified current files, restore missing current files, delete modified obsolete files, and overwrite existing untracked manifest targets
- `--skip-conflicts` skips unsafe file conflicts and continues safe operations
- `--check` prints selected registry ref and planned operations without mutating files, config, or lockfile
- successful mutation preserves component lockfile metadata
- successful mutation updates registry metadata only after file writes/deletes succeed

### Component update contract

`nazare update <component>` updates an installed registry component while protecting user edits.

Local state uses `nazare.lock.yml` checksums:

- untouched: current file checksum equals lockfile checksum
- touched: current file checksum differs from lockfile checksum
- missing: current file is absent
- untracked for this component: target path absent from component lockfile entry

Operation rules:

- validate config, lockfile, manifest, component metadata, safe paths, dependency graph, and registry checksums before mutation
- requested component must already be installed
- requested component dependencies must already be installed
- dependency components with registry changes update before the requested component
- new registry file absent locally -> write and track
- new registry file target exists untracked -> fail before mutation
- existing installed file replacement -> prompt before overwrite/manual conflict write unless `--force` is passed
- removed untouched installed file -> delete and untrack
- removed touched installed file -> prompt before delete/manual conflict write unless `--force` is passed
- missing installed file still present in registry -> prompt before recreate unless `--force` is passed
- skipped prompt answer mutates nothing and does not bump component lockfile metadata
- manual conflict marker choice writes only selected marker files and does not advance component or registry metadata
- `--dry-run` prints selected registry ref, planned operations, and prompts without mutating files, config, or lockfile
- successful mutation updates registry metadata only after file writes/deletes succeed

Prompt actions:

- `y`: allow planned write, recreate, or delete
- `N`: skip the operation; no normal mutations or metadata advance
- `m`: write manual conflict markers for that file only

Conflict marker format:

```txt
<<<<<<< local
<current local file content>
=======
<incoming registry file content>
>>>>>>> registry c-button@1.1.0
```

Delete conflict marker format:

```txt
<<<<<<< local
<current local file content>
=======
>>>>>>> registry c-button@1.1.0 (removed)
```

### CLI self update contract

`nazare update self` updates a Nazare-owned CLI install.

Rules:

- `nazare --version` prints `packages/nazare/package.json.version`
- update uses install metadata under `~/.nazare`
- update preserves a working `nazare` command on success
- failed update preserves the currently working install when possible
- existing non-Nazare `~/.local/bin/nazare` is not overwritten
- tag/package version mismatch fails before install metadata is recorded

### Local registry Git ref server contract

`nazare-dev registry serve --git-refs` serves `GET /raw/<path>?ref=<tag-or-commit>` from local Git refs.

Rules:

- validate `<path>` as safe relative path before invoking Git
- use argument arrays, never shell-concatenate user input
- missing refs or paths return `404`
- a request with `ref` must not fall back to working tree content
- without `--git-refs`, server keeps existing working-tree behavior

---

## Success behavior

- `nazare update self --latest` resolves newest stable tag, updates CLI install, and stores the resolved tag in install metadata.
- `nazare update self --latest --dev` resolves newest dev tag, updates CLI install, and stores the resolved tag in install metadata.
- `nazare update self --version <version>` updates CLI install from `v<version>`.
- `nazare update self --source <ref>` updates CLI install from the explicit ref.
- `nazare update theme` without selector updates from current configured registry ref.
- `nazare update theme` with selector updates from the selected registry ref and advances config/lockfile registry metadata only after successful file operations.
- `nazare update <component>` without selector updates from current configured registry ref.
- `nazare update <component>` with selector updates from the selected registry ref and advances config/lockfile registry metadata only after successful file operations.
- `--check` and `--dry-run` report selected registry ref and mutate nothing.
- Local dev server serves stable and dev tags when `--git-refs` is enabled.

---

## Failure behavior

Exit non-zero before mutation when:

- target is missing or unknown
- target selector flags conflict
- `--dev` is passed without `--latest`
- selected stable/dev tag does not exist
- `--version` is invalid SemVer
- selected CLI tag package version does not match the tag
- repo lacks required `nazare.config.yml` or `nazare.lock.yml` for theme/component updates
- config, lockfile, registry origin, manifest, theme block, components block, metadata, paths, files, or checksums are invalid
- theme/component file safety checks fail without `--force` or skip/manual choice
- prompt would be required in a non-interactive terminal without `--force`
- registry cannot be fetched or read
- local dev server receives unsafe path or missing Git ref/path

Failed theme/component updates must not mutate files, config registry metadata, lockfile registry metadata, or unrelated lockfile sections. Component manual conflict markers are the only explicit mutation allowed without metadata advancement.

---

## Verification

Result: ready for implementation.

- [ ] `nazare --version` prints installed CLI version.
- [ ] `nazare update self` updates from original install source.
- [ ] `nazare update self --latest` stores stable resolved tag in install metadata.
- [ ] `nazare update self --latest --dev` stores dev resolved tag in install metadata.
- [ ] `nazare update self --version <version>` updates from tag `v<version>`.
- [ ] `nazare update self --source <ref>` updates from explicit ref.
- [ ] CLI update rejects tag/package version mismatch.
- [ ] Stable tag resolver ignores dev prerelease tags.
- [ ] Dev tag resolver selects highest valid `*-dev.N` prerelease tag.
- [ ] `nazare update theme --latest` applies stable-tag theme changes and records registry metadata only after success.
- [ ] `nazare update theme --latest --dev` applies dev-tag theme changes and records registry metadata only after success.
- [ ] `nazare update theme --version <version>` applies version-tag theme changes and records registry metadata only after success.
- [ ] `nazare update theme --source <ref>` applies explicit-ref theme changes and records registry metadata only after success.
- [ ] Failed theme update leaves config and lockfile bytes unchanged.
- [ ] `nazare update theme --check` prints selected ref and mutates nothing.
- [ ] Theme update preserves existing component lockfile metadata.
- [ ] Theme update never deletes untracked files.
- [ ] `nazare update <component> --latest` applies stable-tag component changes and records registry metadata only after success.
- [ ] `nazare update <component> --latest --dev` applies dev-tag component changes and records registry metadata only after success.
- [ ] `nazare update <component> --version <version>` applies version-tag component changes and records registry metadata only after success.
- [ ] `nazare update <component> --source <ref>` applies explicit-ref component changes and records registry metadata only after success.
- [ ] Failed component update leaves config and lockfile bytes unchanged unless manual conflict markers are explicitly chosen.
- [ ] `nazare update <component> --dry-run` prints selected ref and mutates nothing.
- [ ] Component update preserves existing theme lockfile metadata.
- [ ] Component prompt `N` mutates nothing and does not advance metadata.
- [ ] Component prompt `m` writes conflict markers only and does not advance metadata.
- [ ] Legacy `nazare self update`, `nazare theme update`, and `nazare registry use` are absent from help and command dispatch.
- [ ] `nazare-dev registry serve --git-refs` serves manifest and source files from a local stable tag.
- [ ] `nazare-dev registry serve --git-refs` serves manifest and source files from a local dev tag.
- [ ] `nazare-dev registry serve --git-refs` returns `404` for missing refs or paths without falling back to working tree content.
- [ ] README documents stable, dev, version, downgrade, and local-tag testing flows.

---

## Architecture notes

Use one target parser for `nazare update <target>`:

1. Parse target: `self`, `theme`, or component ID.
2. Parse common selector flags: `--latest`, `--dev`, `--version`, `--source`.
3. Resolve target ref.
4. Dispatch to target-specific planner/executor.

Target-specific ownership:

- `self`: update CLI install under `~/.nazare`; do not touch project files.
- `theme`: resolve selected registry, validate theme manifest/checksums, plan file writes/deletes/skips, then write files and registry/theme lockfile metadata atomically after plan succeeds.
- component: resolve selected registry, validate component graph/checksums, collect prompt decisions, then write files and registry/component lockfile metadata atomically after plan succeeds.

Registry metadata advancement:

- No selector: preserve current registry metadata.
- Selector passed and update succeeds: write selected `repo`/`ref` to both `nazare.config.yml` and `nazare.lock.yml`.
- Selector passed and update fails: leave both files byte-for-byte unchanged, except explicit component manual conflict marker files.
- `--check` and `--dry-run`: never write registry metadata.

Tag resolution should use one helper that returns ordered stable or dev tags. Stable filtering must exclude prerelease identifiers. Dev filtering must require prerelease identifier `dev` and numeric prerelease counter.

Prefer `git show <ref>:<path>` for local dev server Git-ref reads after safe path validation.

Do not compare local files to current registry to detect edits. Lockfile checksums remain the local modification authority.

---

## Open questions

None. Dev tag resolution selects the latest dev tag globally. `--latest` and `--latest --dev` use the default GitHub registry repo for theme/component targets.
