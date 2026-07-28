#!/usr/bin/env sh
set -eu

version="${1:?release version required}"
product="${2:-cli}"
case "$product" in
	cli) executable="nazare"; command_args="source analyze" ;;
	source) executable="nazare-source"; command_args="analyze" ;;
	*) echo "unsupported smoke product: $product" >&2; exit 1 ;;
esac
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

install() {
	NAZARE_VERSION="$version" \
	NAZARE_PRODUCT="$product" \
	NAZARE_HOME="$tmp/home" \
	NAZARE_DOWNLOAD_BASE_URL="file://$(pwd)/.release" \
		sh scripts/install.sh >/dev/null
}

install
# Reinstalling an immutable version reuses it and refreshes only the active link.
install

"$tmp/home/bin/$executable" --version | grep -Fx "$version" >/dev/null
# Intentional word splitting selects the product's two-word or one-word command.
# shellcheck disable=SC2086
printf '{{ product.title }}' \
	| "$tmp/home/bin/$executable" $command_args --stdin --language liquid \
	| grep -F '"authoritative": true' >/dev/null
