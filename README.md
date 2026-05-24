# Nazare

Opinionated Shopify Liquid theme and component registry built for speed.

## Versioning

Nazare CLI version source of truth is `package.json.version`.

Versions use SemVer. Stable release tags must use `vMAJOR.MINOR.PATCH` and match `package.json.version` without the leading `v`.

See [`docs/policies/release-policy.md`](docs/policies/release-policy.md).

## Install

Nazare CLI requires Node.js and `curl`.

Install latest CLI:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/refs/heads/main/install.sh | sh
```

Verify install:

```sh
nazare --help
nazare --version
```

## Update

Update a Nazare-owned CLI install from its originally installed source:

```sh
nazare self update
```

Update to the latest stable release:

```sh
nazare self update latest
```

Update from a specific branch, tag, full ref, or commit SHA:

```sh
nazare self update --source feat/my-branch
```

Verify update:

```sh
nazare --help
nazare --version
```
