---
schemaVersion: 1

id: component-remove
title: Remove Component
status: planned

dependencies:
  - cli-install
  - cli-init
  - component-add
  - component-registry

surfaces:
  cli:
    - nazare remove <component>

invariants:
  - Requires initialized repo
  - Reads installed file list exclusively from nazare.lock.yml — never from registry
  - Never cascades to dependency components
  - Warns and prompts y/N when other installed components depend on the target; --force skips the prompt
  - Treats a file as unmodified when its on-disk checksum matches the lockfile checksum
  - Treats a file as modified when its on-disk checksum differs from the lockfile checksum
  - Modified files are skipped by default; --force deletes them without prompting
  - Missing files are silently skipped — already gone, lockfile entry still removed
  - Removes the component entry from nazare.lock.yml only after all planned deletions succeed
  - Never mutates files belonging to other components
  - Never mutates theme scaffold files

nonGoals:
  - Cascade removal of dependency components
  - Removing theme scaffold files
  - Removing untracked local files
  - Interactive per-file prompts
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - bin/nazare.js remove command handling
      - README.md remove instructions
      - test/ CLI remove tests

  mustNotModify:
    - files owned by other installed components
    - nazare.lock.yml theme metadata
    - nazare.lock.yml entries for other components
    - theme scaffold files
    - install metadata
---

# Remove Component

## Goal

Add `nazare remove <component>` to uninstall a previously installed registry component. Remove reads the installed file list from `nazare.lock.yml`, deletes unmodified owned files, and removes the lockfile entry. It never touches files that belong to other components, never cascades to dependencies, and refuses by default when other installed components depend on the target.

---

## Scope

Included:

- `nazare remove <component>`
- `--force` to delete modified owned files and override dependent-component guard
- `--dry-run` to preview the removal plan without mutation
- lockfile-based file resolution — no registry fetch required
- dependent-component check from lockfile graph
- per-file unmodified/modified/missing classification via lockfile checksum
- lockfile entry removal after successful deletions
- README instructions and Vitest coverage

### Operation rules

- Component not in lockfile → fail before mutation.
- Other installed components declare the target as a dependency → warn, list dependents, prompt `y/N`; proceed only on `y`. `--force` skips prompt.
- File on-disk checksum matches lockfile checksum → delete.
- File on-disk checksum differs from lockfile checksum → skip and warn, unless `--force` (delete).
- File missing on disk → skip silently; lockfile entry still removed.
- All planned deletions succeed → remove component entry from `nazare.lock.yml`.
- Any planned deletion fails → abort; leave lockfile unchanged.

### No cascade

`nazare remove c-carousel` removes only `c-carousel`. `c-drag-scroll` is untouched even though it was installed as a dependency. To remove both, the user runs two explicit commands:

```sh
nazare remove c-carousel
nazare remove c-drag-scroll
```

---

## Success behavior

- Reads installed file list from `nazare.lock.yml`; no registry fetch.
- When other installed components depend on the target: warns, lists them, prompts `y/N`. Aborts on `n`. `--force` skips prompt.
- Classifies each file: unmodified, modified, or missing.
- Deletes unmodified files. Skips modified files with a warning (unless `--force`). Skips missing files silently.
- Removes component entry from `nazare.lock.yml` after deletions.
- Prints each deleted path and a final removed confirmation.
- Exits `0` when component entry is removed from lockfile.

With `--dry-run`:

- Prints the removal plan (would delete / would skip / already missing) without touching files or lockfile.
- Exits `0`.

---

## Failure behavior

Exit non-zero before mutation when:

- repo lacks `nazare.config.yml` or `nazare.lock.yml`
- lockfile is invalid
- component ID is missing, invalid, or not installed
- user answers `n` to the dependent-component prompt
- a planned file deletion fails at the OS level

Skipped modified files are reported as warnings, not errors. Component entry is still removed from the lockfile even when some files are skipped.

Failure must not mutate component files, lockfile entries, or files outside the target component's owned paths.

---

## Verification

- [ ] installed component with unmodified files: all files deleted, lockfile entry removed
- [ ] installed component with missing files: skipped silently, lockfile entry removed
- [ ] installed component with modified files: files skipped with warning, lockfile entry removed
- [ ] `--force` with modified files: modified files deleted, lockfile entry removed
- [ ] `--dry-run`: prints plan, mutates nothing
- [ ] component not installed: fails before mutation
- [ ] dependent component installed, user answers `y`: removes target component
- [ ] dependent component installed, user answers `n`: aborts, mutates nothing
- [ ] `--force` with dependent component: skips prompt, removes target component
- [ ] only the target component's lockfile entry is removed; other entries unchanged
- [ ] files owned by other components are not touched
- [ ] OS-level deletion failure aborts and leaves lockfile unchanged

---

## Architecture notes

No registry fetch. All information (file paths, checksums, dependency graph) comes from `nazare.lock.yml`.

Plan: validate args/init → parse lockfile → check target is installed → check reverse dependencies → classify files → print plan (`--dry-run` exits here) → delete unmodified files → remove lockfile entry.

Reverse dependency check: scan all lockfile component entries for `dependencies` arrays containing the target ID.

Modified files are skipped by default to protect user edits. `--force` overrides both the modified-file guard and the reverse-dependency prompt with a single flag — keeping the surface minimal. If the distinction matters later (e.g. `--force-modified` vs `--force-deps`), add flags then.

This additive CLI command is a minor release per `docs/policies/release-policy.md`.

---

## Open questions

None.
