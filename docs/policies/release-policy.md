# Release Policy

## Versioning

`packages/nazare/package.json.version` is the consumer CLI version source of truth.

Use SemVer: `MAJOR.MINOR.PATCH`. Prerelease syntax is allowed for dev builds, using `MAJOR.MINOR.PATCH-dev.N`.

Only CLI/install behavior changes require a new package version and Git tag.

Registry content changes do not require a CLI release by default, including changes under:

- `theme/default/`
- `nazare.registry.yml`
- feature docs
- policies
- tests

Create a CLI release for registry content only if the installed CLI or installer must change to consume that content correctly.

## Release source

Development installs may use `refs/heads/main` while work is untagged.

Stable releases use stable Git tags. Dev releases use prerelease Git tags.

`nazare self update` updates from the originally installed ref/source recorded in install metadata.
`nazare self update latest` selects the highest stable `vMAJOR.MINOR.PATCH` tag.
`nazare self update latest --dev` selects the highest `vMAJOR.MINOR.PATCH-dev.N` prerelease tag.

## Tags

Stable release tags are required.

Stable tag format: `vMAJOR.MINOR.PATCH`.

Dev tag format: `vMAJOR.MINOR.PATCH-dev.N`.

The tag version must match `packages/nazare/package.json.version` without the leading `v`.

## Workflow

Follow `workflow/release.md` for release commands and verification. Always create GitHub Releases with `--notes-file`; never pass Markdown notes inline with `--notes "..."`.

## Compatibility

Patch: CLI or installer bug fixes only.

Minor: additive CLI commands or flags.

Major: breaking CLI behavior.
