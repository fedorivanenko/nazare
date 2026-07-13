#!/usr/bin/env sh
set -eu

repo="${NAZARE_REPO:-fedorivanenko/nazare}"
version="${NAZARE_VERSION:-latest}"
home_dir="${NAZARE_HOME:-$HOME/.nazare}"

need() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "missing required command: $1" >&2
		exit 1
	fi
}

need curl
need tar
need node

if ! command -v pnpm >/dev/null 2>&1; then
	if command -v corepack >/dev/null 2>&1; then
		corepack enable >/dev/null 2>&1 || true
		corepack prepare pnpm@10.0.0 --activate >/dev/null 2>&1 || true
	fi
fi
need pnpm

if [ "$version" = "latest" ]; then
	version="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" \
		| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
		| head -1)"
fi

if [ -z "$version" ]; then
	echo "could not resolve latest Nazare release" >&2
	exit 1
fi

url="https://github.com/$repo/releases/download/$version/nazare-cli-$version.tar.gz"
versions_dir="$home_dir/versions"
bin_dir="$home_dir/bin"
install_dir="$versions_dir/nazare-cli-$version"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$versions_dir" "$bin_dir"

echo "downloading Nazare $version"
curl -fsSL "$url" -o "$tmp/nazare.tar.gz"
rm -rf "$install_dir"
tar -xzf "$tmp/nazare.tar.gz" -C "$versions_dir"

(cd "$install_dir" && pnpm install --prod --frozen-lockfile)
chmod +x "$install_dir/packages/cli-client/dist/index.js"
ln -sfn "$install_dir/packages/cli-client/dist/index.js" "$bin_dir/nazare"

echo "nazare installed: $bin_dir/nazare"
case ":$PATH:" in
	*":$bin_dir:"*) ;;
	*) echo "add to PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac
