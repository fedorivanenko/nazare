#!/usr/bin/env sh
set -eu

version="${1:?release version required}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

NAZARE_VERSION="$version" \
NAZARE_HOME="$tmp/home" \
NAZARE_DOWNLOAD_BASE_URL="file://$(pwd)/.release" \
	sh scripts/install.sh >/dev/null

# Reinstalling an immutable version reuses it and refreshes only the active link.
NAZARE_VERSION="$version" \
NAZARE_HOME="$tmp/home" \
NAZARE_DOWNLOAD_BASE_URL="file://$(pwd)/.release" \
	sh scripts/install.sh >/dev/null

"$tmp/home/bin/nazare" --version | grep -Fx "$version" >/dev/null
printf '{{ product.title }}' \
	| "$tmp/home/bin/nazare" source analyze --stdin --language liquid \
	| grep -F '"authoritative": true' >/dev/null
