---
schemaVersion: 1

id: F-001
title: Nazare CLI Versioning and Update
status: planned

dependencies:
  - F-000

surfaces:
  cli:
    - nazare --version
    - nazare self update
    - nazare --help

invariants:
  - CLI version output must match package metadata copied from package.json
  - Installed CLI metadata must record the originally installed ref/source
  - Update must leave a working nazare command on success
  - Failed update must preserve the currently working Nazare install when possible
  - Update must not overwrite unrelated user files

nonGoals:
  - Updating theme files or installed components
  - Implementing package manager distribution
  - Implementing private registry authentication
  - Automatically running updates before other commands

codebaseOwnership:
  owns:
    - bin/nazare.js
    - install.sh
    - README.md CLI update instructions
    - package.json
    - ~/.nazare
    - ~/.local/bin/nazare when Nazare-owned

  mustNotModify:
    - unrelated files under ~/.local/bin
    - unrelated files outside ~/.nazare
    - theme files
    - component files
---

# 001 — Nazare CLI Versioning and Update

## Goal

Let users inspect the installed Nazare CLI version and update a Nazare-owned CLI install.

Users should have a clear recovery path when a local CLI is old or broken before they run registry, theme, or component commands.

---

## Scope

Included:

- npm-standard `package.json` metadata
- generated install metadata under `~/.nazare`
- `nazare --version` output
- `nazare self update` command
- README update instructions
- reinstall/update flow for Nazare-owned installs created by `install.sh`
- clear update failure messages

---

## Success behavior

- `nazare --version` prints the installed CLI version and exits with code `0`.
- `nazare self update` updates a Nazare-owned install using the same install source as `install.sh`.
- After update, `nazare --help` works and exits with code `0`.
- Re-running `nazare self update` is safe and leaves a working `nazare` command.
- README documents the update command and Node.js requirement.

---

## Failure behavior

- Missing Node.js runtime exits non-zero with a clear error.
- Missing `curl` exits non-zero with a clear error.
- Download failure exits non-zero with a clear error.
- Existing non-Nazare `~/.local/bin/nazare` exits non-zero and is not overwritten.
- Missing or invalid `package.json` version metadata exits non-zero with a clear error.
- Invalid or missing installed CLI metadata exits non-zero with a clear error.
- Failed update must not mutate unrelated user files.

---

## Verification

Result: not tested yet.

- [ ] repo has valid npm-standard `package.json` version metadata
  - Verify by reading and validating `package.json`.
- [ ] install generates installed CLI metadata under `~/.nazare`
  - Verify with temp `HOME` install.
- [ ] `nazare --version` prints installed version and exits with code `0`
  - Verify with local CLI entrypoint and installed shim.
- [ ] `nazare self update` leaves `nazare --help` working
  - Verify with temp `HOME` install and local update source override.
- [ ] repeated update remains working
  - Verify by running update twice in temp `HOME`.
- [ ] update respects owned install path rules
  - Verify conflict test preserves unrelated `~/.local/bin/nazare`.
- [ ] README documents update command and Node.js requirement
  - Verify by review.

---

## Architecture notes

The repo must be an npm-standard package with `package.json` as source of truth for CLI package version.

Installer should copy enough package metadata into the installed CLI so `nazare --version` does not need network access.

Installer should also generate install metadata under `~/.nazare` that records installed version, installed ref/source, install time, and CLI source URL.

`nazare self update` should reuse installer ownership checks instead of introducing a second write policy.

`nazare self update` should update from the originally installed ref/source recorded in install metadata.

Update behavior should stay limited to the CLI install. Theme files and component files remain owned by later feature work.

---

## Open questions

- None
