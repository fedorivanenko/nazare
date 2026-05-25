---
schemaVersion: 1

id: theme-update
title: Update Theme
status: planned

dependencies:
  - cli-install
  - cli-self-update
  - cli-init
  - theme-scaffold
  - theme-build-plugin
  - theme-build-pipeline
  - theme-pull

surfaces:
  cli:
    - nazare theme update
    - nazare theme update --force
    - nazare theme update --check

invariants:
  - Requires initialized repo and existing lockfile theme metadata
  - Reads registry origin from nazare.config.yml
  - Uses current registry manifest theme block as update target
  - Checks all tracked installed theme files before any write or delete
  - Overwrites only unmodified tracked files unless --force is explicitly passed
  - Deletes only unmodified obsolete tracked files unless --force is explicitly passed
  - Fails before mutation when current tracked files are modified or missing
  - Fails before mutation when obsolete tracked files are modified
  - Never overwrites modified user files unless --force is explicitly passed
  - Never deletes untracked files
  - Updates lockfile theme metadata only after successful file operations

nonGoals:
  - Implementing nazare theme pull
  - Adding or updating components
  - Implementing nazare add <component>
  - Implementing nazare pull <component>
  - Implementing a generic nazare update command
  - Removing untracked old theme files
  - Merging user modifications
  - Adopting existing Shopify themes
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - bin/nazare.js theme update command handling
      - README.md theme update instructions
      - test/ CLI theme update tests
      - nazare.lock.yml theme checksum metadata in user theme repo

  mustNotModify:
    - theme/default/ scaffold source content
    - component registry behavior
    - component files
    - existing modified user theme files
    - generated Vite plugin output files unless declared by theme.files in a later feature
    - install metadata
---

# Update Theme

## Goal

Add `nazare theme update` to safely fast-forward installed Nazare scaffold files from the configured registry without clobbering user edits.

Unmodified tracked files update. Modified tracked files stop the command before any mutation unless `--force` is passed. Obsolete unmodified tracked files may be deleted. Untracked files are never deleted. `--check` reports the plan without mutating files.

---

## Scope

Included:

- `nazare theme update`
- `nazare theme update --force`
- `nazare theme update --check`
- registry resolution from `nazare.config.yml`
- current manifest `theme` block validation using `theme-pull` rules
- tracked-file safety checks using `nazare.lock.yml` checksum metadata
- update of unmodified tracked files
- deletion of obsolete unmodified tracked files
- copy of new manifest files only when target path is absent
- lockfile metadata updates after successful writes/deletes
- README instructions and Vitest coverage

### Lockfile checksum contract

Each tracked theme file must have last-installed content checksum:

```yaml
theme:
  version: 1.0.0
  source: theme/default
  installedAt: "2026-05-25T00:00:00.000Z"
  updatedAt: "2026-05-26T00:00:00.000Z"
  files:
    - path: layout/theme.liquid
      source: theme/default/layout/theme.liquid
      checksum:
        algorithm: sha256
        value: 3b7b7f1f4c8c0d36c9d6f2f3d1b2a1a0c9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4
```

Local state:

- unmodified: file exists and SHA-256 equals lockfile checksum
- modified: file exists and SHA-256 differs
- missing: file does not exist
- obsolete: tracked file no longer appears in current manifest by `path`/`source`
- untracked target: manifest target path absent from lockfile `theme.files`

Missing checksum metadata is migrated when it can be proven safe: if a current tracked local file equals current registry content, update may add checksum metadata without rewriting the file. If the local file differs, update must fail unless `--force` is passed. Missing obsolete files without checksum metadata may be untracked.

### Operation rules

- Current tracked file + unmodified + registry content changed -> overwrite and update checksum.
- Current tracked file + missing checksum + local equals registry -> add checksum metadata.
- Current tracked file + missing checksum + local differs from registry -> fail before mutation.
- Current tracked file + missing checksum + local differs from registry + `--force` -> overwrite and update checksum.
- Current tracked file + modified -> fail before mutation.
- Current tracked file + modified + `--force` -> overwrite and update checksum.
- Current tracked file + missing -> fail before mutation.
- Current tracked file + missing + `--force` -> restore from registry and update checksum.
- Obsolete tracked file + unmodified -> delete file and remove lockfile entry.
- Obsolete tracked file + modified -> fail before mutation.
- Obsolete tracked file + modified + `--force` -> delete file and remove lockfile entry.
- Obsolete tracked file + missing -> remove lockfile entry during successful update.
- New manifest target + absent locally -> copy and add lockfile entry.
- New manifest target + exists locally -> fail before mutation because ownership is ambiguous.
- New manifest target + exists locally + `--force` -> overwrite and add lockfile entry.
- Untracked local files -> never delete unless they are current manifest targets and `--force` is passed.

---

## Success behavior

- Resolves registry, reads current manifest, validates paths, and plans all operations before mutation.
- Writes changed unmodified tracked files with current registry content.
- Deletes obsolete unmodified tracked files.
- Copies new manifest files whose target paths are absent.
- No-op update exits `0`, prints no-op message, and leaves lockfile unchanged.
- Successful mutation prints written/deleted paths and exits `0`.
- `--check` exits `0` when update can proceed safely, prints planned writes/deletes/no-op, and does not mutate files or lockfile.
- `--check` exits non-zero for the same safety errors as normal update and does not mutate files or lockfile.
- `--force` may overwrite modified current files, restore missing current files, delete modified obsolete files, and overwrite existing untracked manifest targets.

After successful mutation:

- `theme.version` and `theme.source` come from current manifest.
- `theme.installedAt` is preserved when present.
- `theme.updatedAt` is set to update time as RFC 3339 timestamp.
- written/new files have `path`, `source`, and `checksum: { algorithm: sha256, value: <written-content-sha256> }`.
- obsolete deleted/already-missing files are removed from `theme.files`.
- component lockfile data is unchanged.

---

## Failure behavior

Before any mutation, exit non-zero with clear error when:

- repo lacks `nazare.config.yml` or `nazare.lock.yml`
- lockfile lacks `theme` metadata
- config, lockfile, registry origin, manifest, manifest `theme` block, version, source, or files are invalid
- any manifest `from`/`to` path is unsafe, duplicate, or missing in registry snapshot
- any tracked entry lacks checksum metadata and cannot be safely migrated
- any current tracked installed file is modified or missing, unless `--force` is passed
- any obsolete tracked file is modified, unless `--force` is passed
- any new manifest target exists locally but is untracked, unless `--force` is passed

Failed update must not mutate theme files, component lockfile entries, or files outside current/previously tracked `theme.files` destinations.

---

## Verification

Result: planned.

- [ ] unmodified tracked file updates
  - Verify checksum match before update, new content after update, new checksum in lockfile.
- [ ] modified current tracked file fails before mutation
  - Verify all files and lockfile unchanged.
- [ ] `--force` overwrites modified current tracked file
  - Verify file becomes registry content and checksum updates.
- [ ] missing current tracked file fails before mutation
  - Verify clear missing-path error and lockfile unchanged.
- [ ] `--force` restores missing current tracked file
  - Verify file is recreated from registry and checksum updates.
- [ ] obsolete unmodified tracked file deletes
  - Verify file removed and lockfile entry removed.
- [ ] obsolete modified tracked file fails before mutation
  - Verify file and lockfile unchanged.
- [ ] `--force` deletes obsolete modified tracked file
  - Verify file and lockfile entry removed.
- [ ] obsolete already-missing tracked file untracks
  - Verify lockfile entry removed without delete attempt.
- [ ] missing checksum metadata is added when local file equals registry
  - Verify lockfile gets checksum and file content remains unchanged.
- [ ] missing checksum metadata fails when local file differs from registry
  - Verify clear metadata error and lockfile unchanged.
- [ ] new manifest file copies when target absent
  - Verify file created and lockfile entry has checksum.
- [ ] new manifest file fails when target exists untracked
  - Verify ambiguous-path error and target unchanged.
- [ ] `--force` overwrites existing untracked manifest target
  - Verify file becomes registry content and lockfile entry is added.
- [ ] no-op update leaves lockfile unchanged
  - Verify exact before/after lockfile.
- [ ] `--check` reports planned operations without mutation
  - Verify files and lockfile unchanged for write/delete plan.
- [ ] `--check` reports safety errors without mutation
  - Verify non-zero exit and unchanged files/lockfile.
- [ ] successful update preserves `theme.installedAt` and sets `theme.updatedAt`
- [ ] untracked files are never deleted
- [ ] standard validation failures mutate nothing
  - Verify missing/invalid config, lockfile, manifest, theme block, unsafe paths, duplicate paths, and missing registry files.

---

## Architecture notes

Reuse `theme-pull` primitives for config, lockfile, registry, manifest, and safe path validation.

Plan phases:

1. Validate config, lockfile, manifest, and all paths.
2. Classify tracked files by checksum and current manifest membership.
3. Build full operation plan: writes, deletes, new copies, lockfile changes.
4. Execute file operations only after full plan is safe.
5. Update lockfile only after file operations finish.

Checksum metadata is the local-modification authority. Do not compare local files to current registry to detect edits; registry may have changed. Do not attempt three-way merge.

`--force` is explicit confirmation for destructive overwrite/delete behavior. It still must not affect paths outside current manifest targets or previously tracked theme files.

`--check` uses the same planner as update, but stops before mutation and reports the plan.

---

## Open questions

None.
