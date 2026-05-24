# Nazare

Opinionated Shopify Liquid theme and component registry built for speed.

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

Update from a specific branch, tag, full ref, or commit SHA:

```sh
nazare self update --source feat/my-branch
```

Verify update:

```sh
nazare --help
nazare --version
```
