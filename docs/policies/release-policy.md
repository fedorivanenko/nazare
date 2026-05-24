# Release Policy

## Versioning

Nazare CLI version source of truth is `package.json.version`.

Versions use SemVer:

```txt
MAJOR.MINOR.PATCH
```

Prerelease versions may use SemVer prerelease syntax when needed.

## Release source

The default development install and update source is `refs/heads/main`.

Stable releases use Git tags.

`nazare self update` updates from the originally installed ref/source recorded in install metadata.

## Tags

Release tags are required for stable releases.

Tag names must match `package.json.version` with a leading `v`:

```txt
vMAJOR.MINOR.PATCH
```

Example:

```txt
v0.1.0
```

Tags must point to commits where `package.json.version` matches the tag version without the leading `v`.

## Compatibility

Patch releases should preserve existing CLI behavior except for bug fixes.

Minor releases may add commands or flags.

Breaking CLI behavior requires a major version.
