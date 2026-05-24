---
schemaVersion: 1

id: F-002
title: Initialize Nazare Theme Repo
status: planned

dependencies:
  - F-000
  - F-001

surfaces:
  cli:
    - nazare init
    - nazare init [directory]
    - nazare init --repo <repo>
    - nazare init --ref <ref>
    - nazare init [directory] --repo <repo> --ref <ref>

invariants:
  - Init must not overwrite existing nazare.lock.yml
  - Init must create valid initial config and lock files
  - Init must not pull theme files or components
  - Failed init must not partially mutate target state when avoidable

nonGoals:
  - Pulling registry theme files
  - Adding or updating components
  - Fetching or validating the remote registry manifest
  - Creating Shopify theme scaffold files
  - Adopting existing nazare.config.yml without a lockfile
  - Force-overwriting existing init files

codebaseOwnership:
  owns:
    repo:
      - bin/nazare.js
      - README.md init instructions
      - nazare.config.yml generated in user theme repo
      - nazare.lock.yml generated in user theme repo

  mustNotModify:
    - existing nazare.lock.yml
    - existing nazare.config.yml
    - theme files
    - component files
    - registry files
---

# 002 — Initialize Nazare Theme Repo

## Goal

Add `nazare init` so a user theme repo can be linked to the default Nazare registry origin.

The command should create the initial local Nazare state without pulling theme files or components.

---

## Scope

Included:

- `nazare init`
- optional project directory creation via `nazare init [directory]`
- optional registry origin override via `--repo <repo>`
- optional registry ref override via `--ref <ref>`
- `nazare.config.yml` creation
- `nazare.lock.yml` creation
- README init instructions
- clear failure when target already has `nazare.lock.yml`
- clear failure when target has `nazare.config.yml` without `nazare.lock.yml`

---

## Success behavior

- Running `nazare init` in a theme repo creates `nazare.config.yml` and `nazare.lock.yml` in the current directory.
- Running `nazare init [directory]` creates the project directory when needed and writes initial files there.
- Running `nazare init --repo <repo>` uses the provided registry repo in generated files.
- Running `nazare init --ref <ref>` uses the provided registry ref in generated files.
- Generated `nazare.config.yml` uses default registry metadata when `--repo` and `--ref` are omitted:

  ```yaml
  schemaVersion: 1

  registry:
    name: nazare
    repo: github.com/fedorivanenko/nazare
    ref: refs/heads/main
    manifest: nazare.registry.yml
  ```

- Generated `nazare.lock.yml` uses the same registry metadata as config and starts with no installed components:

  ```yaml
  schemaVersion: 1

  registry:
    name: nazare
    repo: github.com/fedorivanenko/nazare
    ref: refs/heads/main
    manifest: nazare.registry.yml

  components: {}
  ```

- Successful init prints created file paths and exits with code `0`.

---

## Failure behavior

- If target `nazare.lock.yml` already exists, init exits non-zero with a clear error.
- If target `nazare.config.yml` exists but `nazare.lock.yml` does not, init exits non-zero with a clear error.
- Init must not overwrite existing `nazare.lock.yml` or `nazare.config.yml`.
- If `--repo` is missing a value or has an invalid repo form, init exits non-zero with a clear error.
- If `--ref` is missing a value or is empty, init exits non-zero with a clear error.
- If `[directory]` contains path separators, init exits non-zero with a clear error.
- If target directory cannot be created, init exits non-zero with a clear error.
- If target files cannot be written, init exits non-zero with a clear error.
- Failed init must not mutate theme files or component files.

---

## Verification

Result: not tested yet.

- [ ] `nazare init` creates `nazare.config.yml`
  - Verify in temp directory.
- [ ] `nazare init` creates `nazare.lock.yml`
  - Verify in temp directory.
- [ ] generated files use default registry metadata
  - Verify file contents.
- [ ] `nazare init --repo <repo>` writes custom registry repo metadata
  - Verify config and lockfile contents.
- [ ] `nazare init --ref <ref>` writes custom registry ref metadata
  - Verify config and lockfile contents.
- [ ] `nazare init [directory]` creates target directory and initial files
  - Verify in temp parent directory.
- [ ] `nazare init [directory]` rejects directory values containing path separators
  - Verify with `/` and `\\` path separators.
- [ ] init fails when `nazare.lock.yml` exists
  - Verify existing lockfile content remains unchanged.
- [ ] init fails when `nazare.config.yml` exists without `nazare.lock.yml`
  - Verify existing config content remains unchanged.
- [ ] failed init does not mutate theme or component files
  - Verify with temp fixture files.

---

## Architecture notes

`nazare.init` should write only local config and lockfile state. Registry fetch and manifest validation belong to later theme/component commands.

`nazare.lock.yml` is the guard for an initialized repo. Existing lockfile means the target is already initialized.

Existing `nazare.config.yml` without `nazare.lock.yml` is ambiguous state. F-002 should fail instead of adopting or overwriting it.

A future `nazare init --adopt` could validate an existing `nazare.config.yml` and create a matching `nazare.lock.yml` without changing the config.

A future `nazare init --force` could reset init state by replacing config and lockfile, but it must require destructive confirmation behavior before writing.

`nazare init [directory]` should reject values containing `/` or `\\` path separators before creating directories. Nested target paths are out of scope for F-002.

`nazare init [directory]` should create the directory when it does not exist, then apply the same lockfile guard inside that directory.

Default registry repo should be `github.com/fedorivanenko/nazare`.

`--repo <repo>` should accept the public GitHub repo forms defined in `docs/theme-config.spec.md`.

Default registry ref should use `refs/heads/main` to match installer URL behavior and avoid ambiguous raw branch resolution.

`--ref <ref>` should accept any non-empty ref selector string, including branch names, full refs, tags, and commit SHAs. Full registry ref resolution belongs to later registry fetch behavior.

---

## Open questions

- None
