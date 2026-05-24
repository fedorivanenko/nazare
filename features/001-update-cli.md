---
schemaVersion: 1

id: F-001
title: Nazare CLI Versioning and Update
status: done

dependencies:
  - F-000

surfaces:
  cli:
    - nazare --version
    - nazare self update
    - nazare self update latest
    - nazare self update --source <ref>
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
    repo:
      - bin/nazare.js
      - install.sh
      - README.md CLI update instructions
      - package.json
      - package-lock.json
      - test/ CLI smoke tests
    install:
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
- `nazare self update latest` stable release channel
- `nazare self update --source <ref>` override
- README update instructions
- reinstall/update flow for Nazare-owned installs created by `install.sh`
- clear update failure messages
- Vitest CLI smoke coverage for version/help behavior

---

## Success behavior

- `nazare --version` prints the installed CLI version and exits with code `0`.
- `nazare self update` updates a Nazare-owned install using the same install source as `install.sh`.
- `nazare self update latest` resolves the latest stable GitHub release tag, updates from that tag, and records it as the new install source.
- `nazare self update --source <ref>` updates from the requested branch, tag, full ref, or commit SHA and records it as the new install source.
- After update, `nazare --help` works and exits with code `0`.
- Re-running `nazare self update` is safe and leaves a working `nazare` command.
- README documents the update command and Node.js requirement.

---

## Failure behavior

- Missing Node.js runtime exits non-zero with a clear error.
- Missing `curl` exits non-zero with a clear error.
- Download failure exits non-zero with a clear error.
- Latest release resolution failure exits non-zero with a clear error.
- Missing or invalid `--source` value exits non-zero with a clear error.
- Existing non-Nazare `~/.local/bin/nazare` exits non-zero and is not overwritten.
- Missing or invalid `package.json` version metadata exits non-zero with a clear error.
- Invalid or missing installed CLI metadata exits non-zero with a clear error.
- Failed update must not mutate unrelated user files.

---

## Verification

Result: tested and passed.

- [x] repo has valid npm-standard `package.json` version metadata
  - Verified with `node bin/nazare.js --version` and install metadata validation.
- [x] install generates installed CLI metadata under `~/.nazare`
  - Verified with temp `HOME` install.
- [x] `nazare --version` prints installed version and exits with code `0`
  - Verified with local CLI entrypoint and installed shim.
- [x] `nazare self update` leaves `nazare --help` working
  - Verified with temp `HOME` install and local update source override.
- [x] `nazare self update --source <ref>` updates from requested source and records it
  - Verified with temp `HOME` install and branch/ref source override.
- [x] `nazare self update latest` updates from latest stable release tag and records it
  - Verified with temp `HOME` install and GitHub latest release resolution.
- [x] repeated update remains working
  - Verified by running update twice in temp `HOME`.
- [x] update respects owned install path rules
  - Verified conflict test preserves unrelated `~/.local/bin/nazare`.
- [x] README documents update command and Node.js requirement
  - Verified by review.
- [x] Vitest smoke tests cover version output against `package.json`
  - Verified with `npm test`.

---

## Architecture notes

### Versioning contract

- `package.json.version` is the source of truth for CLI version.
- Version values must be valid SemVer strings.
- `nazare --version` prints exactly the installed CLI version.
- Installed CLI package metadata must preserve the copied `package.json.version`.
- Generated install metadata under `~/.nazare` must record installed version, originally installed ref/source, install time, and CLI source URL.
- After `nazare self update`, installed package metadata and generated install metadata must agree on version.
- Missing or invalid version metadata is a CLI error.

Installer should copy enough package metadata into the installed CLI so `nazare --version` does not need network access.

Vitest is the project test harness for CLI behavior that can run locally without network access. F-001 keeps installer/update integration checks as temp `HOME` shell scenarios, while version/help smoke coverage lives in `test/` and runs via `npm test`.

`nazare self update` should reuse installer ownership checks instead of introducing a second write policy.

`nazare self update` should update from the originally installed ref/source recorded in install metadata.

`nazare self update latest` should resolve the latest stable GitHub release tag, update from that tag, and store the resolved tag in generated install metadata.

`latest` is a channel selector, not a stored ref. Install metadata should store the resolved tag such as `v0.1.2`.

`nazare self update --source <ref>` should override the update source for that update and store the new source in generated install metadata.

`--source <ref>` should accept branch names, tags, full refs, and commit SHAs. Branch names are normalized to `refs/heads/<branch>` for raw GitHub URLs.

Update behavior should stay limited to the CLI install. Theme files and component files remain owned by later feature work.

---

## Open questions

- None
