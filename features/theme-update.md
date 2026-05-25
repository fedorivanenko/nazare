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

invariants:
  - Theme update must require an initialized Nazare theme repo
  - Theme update must require existing theme metadata in nazare.lock.yml
  - Theme update must read the registry origin from nazare.config.yml
  - Theme update must update only files declared by the registry manifest theme block
  - Theme update must check every installed theme file before writing any file
  - Theme update must overwrite installed theme files only when local content is unchanged from the last installed content
  - Theme update must fail when any current installed theme file was locally modified or deleted
  - Theme update must never silently overwrite modified user files
  - Theme update may delete obsolete installed theme files only when local content is unchanged from the last installed content
  - Lockfile theme metadata must change only when at least one theme file is written
  - Failed theme update must not partially mutate theme files or lockfile metadata when avoidable

nonGoals:
  - Implementing nazare theme pull
  - Adding or updating components
  - Implementing nazare add <component>
  - Implementing nazare pull <component>
  - Implementing a generic nazare update command
  - Removing untracked or modified old theme files
  - Reverting user modifications
  - Merging user modifications with registry changes
  - Theme drift reconciliation beyond installed-file safety checks
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
    - generated Vite plugin output files unless they are declared theme.files entries by a later feature
    - install metadata
---

# Update Theme

## Goal

Add `nazare theme update` so an initialized theme repo can safely update installed Nazare scaffold files from the configured registry without clobbering user edits.

The command should behave like a safe fast-forward for theme scaffold files: if an installed file is unchanged locally, overwrite it with the newer registry copy; if an installed file was modified locally, fail before writing anything.

---

## Scope

Included:

- `nazare theme update`
- registry origin resolution from `nazare.config.yml`
- registry manifest read from the resolved origin snapshot
- manifest `theme` block validation using the same rules as `theme-pull`
- installed-file safety checks using `nazare.lock.yml` theme file metadata
- overwrite of unmodified installed files with current registry content
- deletion of obsolete installed files that are no longer declared by the current registry manifest and are unmodified locally
- creation of new manifest-declared theme files when they are not tracked yet and the target path does not already exist
- lockfile `theme` metadata updates after successful writes or deletes
- README theme update instructions
- Vitest coverage for safe update, modified-file failure, and lockfile behavior

### Installed-file modification check

Each installed theme file entry in `nazare.lock.yml` must include the content checksum that was installed last:

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

Update uses the checksum to classify local state:

- unmodified: local file exists and its SHA-256 checksum equals the lockfile checksum value
- modified: local file exists and its SHA-256 checksum differs from the lockfile checksum value
- deleted: local file does not exist
- untracked target: manifest declares a target path that is not present in lockfile `theme.files`

Modified installed files are errors. Deleted installed files that are still declared by the current manifest are errors. Deleted installed files that are obsolete because they are no longer declared by the current manifest are treated as already removed and may be removed from lockfile metadata during a successful update.

Lock entries missing checksum metadata are unsafe for update. `nazare theme update` must fail with a clear error that asks the user to reinstall or repull theme metadata before using update.

### New manifest files

When the current registry manifest declares a theme file that is not yet tracked in `nazare.lock.yml`:

- if the target path does not exist locally, update may copy it and add it to lockfile metadata
- if the target path exists locally, update must fail before writing anything because ownership is ambiguous

### Obsolete installed files

When a file is tracked in lockfile `theme.files` but its `source` or `path` is no longer present in the current registry manifest, update treats it as obsolete.

Obsolete installed files are deleted only when all of these are true:

- the file exists locally
- the lockfile entry has checksum metadata
- the local file SHA-256 checksum equals the lockfile checksum value
- the path is a safe relative theme path

If an obsolete installed file is modified locally, update must fail before writing or deleting anything and list the path. If an obsolete installed file is already missing locally, update may remove its lockfile entry during a successful update.

Update must never delete untracked files.

---

## Success behavior

- Running `nazare theme update` in an initialized repo resolves the configured registry origin and reads the configured manifest.
- If all installed theme files are unmodified, files whose registry content changed are overwritten with current registry content.
- If a tracked installed file is no longer declared by the current registry manifest and is unmodified locally, it is deleted and removed from lockfile metadata.
- If a new manifest-declared target path is not tracked and does not exist locally, it is copied from the registry and added to lockfile metadata.
- If no files need to change, update exits with code `0`, prints a no-op message, and leaves `nazare.lock.yml` unchanged.
- If at least one file is written or deleted, `nazare.lock.yml` is updated after file operations complete.
- Successful update prints written and deleted file paths and exits with code `0`.

Expected lockfile rules after a write:

- `theme.version` is copied from current manifest `theme.version`.
- `theme.source` is copied from current manifest `theme.source`.
- `theme.installedAt` is preserved from the original theme install when present.
- `theme.updatedAt` is set to update time as an RFC 3339 timestamp.
- `theme.files[].path` is the target theme path.
- `theme.files[].source` is the current manifest source path.
- `theme.files[].checksum.algorithm` is `sha256`.
- `theme.files[].checksum.value` is the SHA-256 checksum of the newly written registry content.
- Previously tracked files that are no longer present in the manifest are removed from lockfile metadata only after their local files are safely deleted or confirmed already missing.

---

## Failure behavior

- If current directory is not initialized with `nazare.config.yml` and `nazare.lock.yml`, theme update exits non-zero with a clear error.
- If `nazare.lock.yml` has no `theme` metadata, theme update exits non-zero with a clear error telling the user to run `nazare theme pull` first.
- If any tracked theme file entry lacks checksum metadata, theme update exits non-zero before writing files.
- If any installed theme file is modified locally, theme update exits non-zero before writing or deleting files and lists modified paths.
- If any current manifest-declared installed theme file is missing locally, theme update exits non-zero before writing or deleting files and lists missing paths.
- If any obsolete installed theme file is modified locally, theme update exits non-zero before writing or deleting files and lists obsolete modified paths.
- If any new manifest-declared target path already exists locally but is not tracked in lockfile theme metadata, theme update exits non-zero before writing files and lists ambiguous paths.
- If `nazare.config.yml` is invalid, theme update exits non-zero with a clear error before writing theme files.
- If `nazare.lock.yml` is invalid, theme update exits non-zero with a clear error before writing theme files.
- If registry origin cannot be resolved, theme update exits non-zero with a clear error before writing theme files.
- If registry manifest is missing or invalid, theme update exits non-zero with a clear error before writing theme files.
- If manifest has no `theme` block, theme update exits non-zero with a clear error.
- If `theme.version`, `theme.source`, or `theme.files` is invalid, theme update exits non-zero with a clear error before writing theme files.
- If any theme file path is unsafe, theme update exits non-zero with a clear error before writing theme files.
- If any declared `from` file is missing in the registry snapshot, theme update exits non-zero with a clear error before writing theme files.
- Failed theme update must not mutate component lockfile entries.
- Failed theme update must not mutate files outside current or previously tracked `theme.files` destinations.

---

## Verification

Result: planned.

- [ ] `nazare theme update` updates unmodified installed files
  - Verify tracked file checksum matches lockfile before update and file content changes to new registry content.
- [ ] modified installed file fails before writing files
  - Verify modified file remains unchanged and no other theme files are written.
- [ ] deleted current installed file fails before writing files
  - Verify clear missing-path error and lockfile unchanged.
- [ ] obsolete unmodified installed file is deleted
  - Verify local file is removed and lockfile entry is removed after successful update.
- [ ] obsolete modified installed file fails before writing or deleting files
  - Verify modified file remains unchanged and lockfile unchanged.
- [ ] obsolete already-missing installed file is removed from lockfile metadata
  - Verify no file delete is attempted and lockfile entry is removed after successful update.
- [ ] tracked file missing checksum fails before writing files
  - Verify clear metadata error and lockfile unchanged.
- [ ] new manifest file is copied when target path is absent
  - Verify file is created and added to `theme.files` with checksum metadata.
- [ ] new manifest file fails when target path exists untracked
  - Verify ambiguous path error and target content unchanged.
- [ ] no-op update leaves lockfile unchanged
  - Verify exact lockfile content before and after.
- [ ] successful update preserves `theme.installedAt`
  - Verify `installedAt` is unchanged and `updatedAt` is set after a write.
- [ ] successful update stores SHA-256 checksums
  - Verify checksum value equals written file content checksum.
- [ ] untracked files are not deleted
  - Verify files absent from lockfile remain untouched even when absent from the new manifest.
- [ ] missing `nazare.config.yml` fails before writing files
  - Verify target directory remains unchanged.
- [ ] missing `nazare.lock.yml` fails before writing files
  - Verify target directory remains unchanged.
- [ ] missing lockfile `theme` metadata fails before writing files
  - Verify clear instruction to run `nazare theme pull` first.
- [ ] invalid config fails before writing files
  - Verify no theme files are changed.
- [ ] invalid lockfile fails before writing files
  - Verify no theme files are changed.
- [ ] missing manifest fails before writing files
  - Verify clear error and unchanged target files.
- [ ] missing manifest `theme` block fails before writing files
  - Verify clear error and unchanged target files.
- [ ] unsafe `from` and `to` paths fail before writing files
  - Verify absolute paths, `..`, backslashes, and escaping target root are rejected.
- [ ] duplicate `to` paths fail before writing files
  - Verify clear validation error.

---

## Architecture notes

`nazare theme update` should reuse registry, manifest, path-safety, config, and lockfile parsing primitives from `theme-pull`.

Update should be planned in three phases before any write:

1. Validate config, lockfile, manifest, and every manifest path.
2. Compare every installed local file checksum against lockfile checksum metadata.
3. Build the operation plan for changed tracked files, obsolete tracked file deletes, and safe new manifest files.

Only after all checks pass should the command write or delete theme files. Lockfile writes should happen after file operations and should reflect only files actually written, deleted, newly tracked, or removed from tracking.

Checksum metadata is the authority for local modification detection. Comparing local files to the current registry is not safe because the registry may have changed. Comparing local files to historical registry content is not required in v1 because the lockfile records the installed content checksum.

The command should not attempt a three-way merge. Modified files are user-owned; the correct behavior is to stop and tell the user which paths need manual resolution.

The command may delete obsolete installed files, but only when checksum metadata proves the local file is unchanged from the last installed content. Untracked files are never deleted.

---

## Open questions

- Should a future `nazare theme update --force` overwrite modified files after explicit confirmation?
- Should a future `nazare theme update --check` report pending updates without writing files?
