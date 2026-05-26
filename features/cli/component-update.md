---
schemaVersion: 1

id: component-update
title: Update Component
status: done

dependencies:
  - cli-install
  - cli-self-update
  - cli-init
  - theme-scaffold
  - theme-build-plugin
  - theme-build-pipeline
  - theme-pull
  - component-registry
  - component-list
  - component-add

surfaces:
  cli:
    - nazare update <component>
    - nazare update <component> --dry-run
    - nazare update <component> --force

invariants:
  - Requires initialized repo
  - Reads registry origin from nazare.config.yml
  - Updates only installed components recorded in nazare.lock.yml
  - Uses lockfile file checksums as local modification authority
  - Verifies registry component file checksums before mutation
  - Never overwrites modified installed component files without user consent or --force
  - Writes conflict markers only when the user explicitly chooses manual resolution for a touched file
  - Never performs three-way merge
  - Writes lockfile component metadata only after successful file writes and deletes
  - Leaves theme lockfile metadata unchanged

nonGoals:
  - Bare nazare update without component operand
  - Updating all installed components in one command
  - Removing components as a standalone operation
  - Adding or updating theme scaffold files
  - Automatically merging user modifications
  - Writing conflict markers without explicit user choice
  - Update state, --continue, or --abort flows
  - Per-file component versions
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - bin/nazare.js update command handling
      - README.md update instructions
      - test/ CLI update tests
      - nazare.registry.yml components metadata
      - nazare.lock.yml components metadata in user theme repo

  mustNotModify:
    - theme/default/ scaffold source content unless adding registry component source under a later component source path
    - nazare.lock.yml theme metadata
    - untracked local files at component target paths
    - files owned by other components
    - install metadata
---

# Update Component

## Goal

Add `nazare update <component>` to update an installed registry component while protecting user edits.

The command treats local files as user-owned once their current checksum differs from the checksum recorded at install or last update. Modified files are never overwritten silently.

---

## Scope

Included:

- `nazare update <component>`
- `nazare update <component> --dry-run`
- `nazare update <component> --force`
- registry resolution from `nazare.config.yml`
- current manifest `components` block validation
- installed component lookup in `nazare.lock.yml`
- component ID validation via `docs/policies/naming-policy.md`
- checksum verification for every new registry component file
- touched-file detection by comparing current file SHA-256 with lockfile checksum
- interactive overwrite/delete/manual prompts for touched installed files
- interactive recreate prompts for missing installed files
- manual conflict-marker writes when the user chooses to resolve a touched file by hand
- lockfile metadata update only when the full component update completes
- README instructions and Vitest coverage

Follow `docs/policies/cli-command-policy.md`: flat registry verbs operate on components; bare `nazare update` remains out of scope.

### Command contract

```bash
nazare update c-button
```

Optional flags:

```bash
nazare update c-button --dry-run
nazare update c-button --force
```

- `--dry-run` prints planned writes, deletes, and prompts without mutating files or lockfile.
- `--force` overwrites touched files and deletes touched removed files without prompting.

### Lockfile contract

`nazare update <component>` uses existing component lockfile metadata from `component-add`:

```yaml
components:
  c-button:
    version: 1.0.0
    type: snippet
    installedAt: "2026-05-26T00:00:00.000Z"
    updatedAt: "2026-05-26T00:00:00.000Z"
    dependencies: []
    files:
      - path: snippets/c-button.liquid
        source: components/c-button/c-button.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

Local file state uses lockfile checksum as authority:

- current file checksum equals lockfile checksum -> untouched
- current file checksum differs from lockfile checksum -> touched
- current file is absent -> missing
- target path absent from component lockfile -> untracked for this component

### Operation rules

- Missing requested component, invalid metadata, unsafe path, duplicate path, missing registry file, or registry checksum mismatch -> fail before mutation.
- Requested component not installed -> fail and suggest `nazare add <component>`.
- Installed component already matches current registry and all files are untouched -> no-op.
- New registry file absent locally -> write and track.
- New registry file target exists untracked -> fail before mutation.
- Registry file replacing an existing installed file -> ask before overwrite or manual conflict write, unless `--force` is set.
- Registry no longer includes an untouched installed file -> delete and remove from lockfile.
- Registry no longer includes a touched installed file -> ask before delete or manual conflict write, unless `--force` is set.
- Missing installed file that still exists in registry -> ask before recreating, unless `--force` is set.
- If user skips any write, recreate, or delete prompt, do not mutate files and do not bump the component lockfile version.
- If user chooses manual conflict write for any file, write conflict markers only for the manual files, do not apply normal update writes/deletes, and do not bump the component lockfile version.

### Prompt contract

For existing installed files:

```txt
snippets/c-button.liquid exists locally.
Overwrite with registry version? [y/N/m]
```

For touched existing installed files:

```txt
snippets/c-button.liquid modified locally.
Overwrite with registry version? [y/N/m]
```

For touched files removed from registry:

```txt
snippets/c-button.liquid modified locally and no longer exists in registry component.
Delete local file? [y/N/m]
```

For missing installed files:

```txt
snippets/c-button.liquid is missing locally.
Recreate from registry version? [y/N]
```

Prompt actions:

- `y`: allow planned write, recreate, or delete
- `N`: skip that operation
- `m`: write manual conflict markers for that file

Manual conflict behavior:

- Manual mode is offered for existing files before overwrite/delete.
- For overwrite prompts, manual mode writes both local current content and incoming registry content into the file with conflict markers.
- For delete prompts, manual mode writes local current content against an empty incoming side so the user can decide whether to keep or delete the file manually.
- For recreate prompts, no `m` option is offered because there is no local file to preserve.
- Manual writes are explicit mutations and must print a notice before and after writing.
- Manual writes do not update `nazare.lock.yml`; the component remains at the old version until a later successful `nazare update <component>`.
- Manual writes do not create update state and do not require `--continue`.

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

Manual notice:

```txt
Wrote manual conflict markers to snippets/c-button.liquid.
Resolve markers manually. nazare.lock.yml was not updated.
Run nazare update c-button again after resolving if you want to accept the registry update.
```

Non-interactive terminals must fail before mutation when a prompt would be required. Users can rerun with `--force` to permit overwrite/delete/recreate without prompts.

---

## Success behavior

- Resolves registry, validates component metadata, verifies registry bytes, and plans all operations before mutation.
- Detects touched files by hashing local file bytes and comparing with lockfile checksum.
- Prompts before overwriting existing installed files with current registry files.
- Writes new registry files that have no local target.
- Deletes installed files removed from registry when they are untouched.
- Prompts before overwriting, deleting, manually marking, or recreating existing touched/missing installed files.
- Prints component version change and changed paths.
- Exits `0` on update or unchanged no-op.

Successful update output:

```txt
c-button 1.0.0 -> 1.1.0

Updated:
  snippets/c-button.liquid

Done.
```

Touched-file output:

```txt
c-button 1.0.0 -> 1.1.0

Modified locally:
  snippets/c-button.liquid

snippets/c-button.liquid modified locally.
Overwrite with registry version? [y/N/m]
```

If all required operations complete:

- `components.<id>.version`, `type`, `dependencies`, and file metadata come from current registry manifest.
- `installedAt` is preserved.
- `updatedAt` is refreshed to current RFC 3339 timestamp.
- file `path`, `source`, and `checksum` come from verified manifest entries.
- `registry` and `theme` lockfile metadata are unchanged.

If any operation is skipped by user choice:

- no files are mutated.
- component version must not be bumped.
- output must state that the component was not fully updated.

If any manual conflict write is chosen:

- conflict markers are written only to files where the user chose `m`.
- normal update writes and deletes are not applied.
- component version must not be bumped.
- output must state that manual resolution is required.

---

## Failure behavior

Exit non-zero before mutation when:

- repo lacks `nazare.config.yml` or `nazare.lock.yml`
- config, lockfile, registry origin, manifest, or `components` block is invalid
- requested component ID is missing, invalid, absent from registry, or not installed
- component metadata, paths, files, or checksums are invalid
- target path exists untracked
- target path has incompatible component ownership
- prompt would be required in a non-interactive terminal without `--force`
- args include unknown flags or extra operands
- registry cannot be fetched or read

Failure must not mutate component files, theme files, lockfile entries, or files outside planned component destinations.

---

## Verification

Result: done.

- [x] installed component prompts before overwriting existing files and updates lockfile metadata after confirmation
- [x] installed current component is no-op
- [x] existing file prompts before overwrite
- [x] prompt `N` leaves file unchanged and does not bump component version
- [x] prompt `m` writes conflict markers and leaves lockfile unchanged
- [x] `--force` overwrites touched files without prompt
- [x] `--dry-run` prints plan and mutates nothing
- [x] missing installed file prompts before recreate
- [x] removed registry file deletes untouched installed file
- [x] removed registry file prompts before deleting touched installed file
- [x] untracked target path fails before mutation
- [x] component not installed fails and suggests `nazare add <component>`
- [x] invalid registry metadata fails before mutation
- [x] checksum mismatch fails before mutation
- [x] non-interactive prompt requirement fails before mutation
- [x] conflict markers are written only after explicit `m` choice
- [x] no update state, --continue, or --abort files are created
- [x] standard validation failures mutate nothing

---

## Architecture notes

Reuse `component-add` and `theme-pull` primitives for config, lockfile, registry fetch, manifest parsing, safe paths, checksum calculation, conflict-marker writes, and lockfile writes.

Plan: validate args/init -> resolve registry -> validate installed component -> validate current registry component -> verify registry checksums -> compute local file states from lockfile checksums -> collect prompt decisions -> either write manual conflict files or build normal write/delete plan -> apply mutations -> write lockfile only for full normal updates.

Prefer collecting all prompts before any mutation. If any prompt answer is `N`, mutate nothing. If any prompt answer is `m`, write only manual conflict-marker files and leave lockfile unchanged. This avoids partial normal updates and keeps the lockfile simple.

Do not compare local files to current registry to detect edits. Lockfile checksum is modification authority.

This additive CLI command should be a minor release per `docs/policies/release-policy.md`.

---

## Open questions

None. v1 updates one named component only.
