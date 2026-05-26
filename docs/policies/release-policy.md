# Release Policy

## Versioning

`package.json.version` is the CLI version source of truth.

Use SemVer: `MAJOR.MINOR.PATCH`. Prerelease syntax is allowed when needed.

Only CLI/install behavior changes require a new package version and Git tag.

Registry content changes do not require a CLI release by default, including changes under:

- `theme/default/`
- `nazare.registry.yml`
- feature docs
- policies
- tests

Create a CLI release for registry content only if the installed CLI or installer must change to consume that content correctly.

## Release source

Development installs use `refs/heads/main`.

Stable releases use Git tags.

`nazare self update` updates from the originally installed ref/source recorded in install metadata.

## Tags

Stable release tags are required.

Tag format: `vMAJOR.MINOR.PATCH`.

The tag version must match `package.json.version` without the leading `v`.

## Workflow

Follow `workflow/release.md` for release commands and verification. Always create GitHub Releases with `--notes-file`; never pass Markdown notes inline with `--notes "..."`.

## Compatibility

Patch: CLI or installer bug fixes only.

Minor: additive CLI commands or flags.

Major: breaking CLI behavior.
