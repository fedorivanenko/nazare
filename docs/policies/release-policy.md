# Release Policy

## Versioning

Nazare CLI version source of truth is `package.json.version`.

Versions use SemVer:

```txt
MAJOR.MINOR.PATCH
```

Prerelease versions may use SemVer prerelease syntax when needed.

## Release source

The default install and update source is `refs/heads/main` until tagged releases are introduced.

`nazare self update` updates from the originally installed ref/source recorded in install metadata.

## Tags

Tagged releases are not required yet.

When tags are introduced, tags should point to commits where `package.json.version` matches the tag version.

## Compatibility

Patch releases should preserve existing CLI behavior except for bug fixes.

Minor releases may add commands or flags.

Breaking CLI behavior requires a major version.

## Rollback

Users can reinstall a known commit or ref by running `install.sh` with explicit install source environment variables.
