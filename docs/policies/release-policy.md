# Release Policy

## Versioning

`package.json.version` is the CLI version source of truth.

Use SemVer: `MAJOR.MINOR.PATCH`. Prerelease syntax is allowed when needed.

## Release source

Development installs use `refs/heads/main`.

Stable releases use Git tags.

`nazare self update` updates from the originally installed ref/source recorded in install metadata.

## Tags

Stable release tags are required.

Tag format: `vMAJOR.MINOR.PATCH`.

The tag version must match `package.json.version` without the leading `v`.

## Compatibility

Patch: bug fixes only.

Minor: additive commands or flags.

Major: breaking CLI behavior.
