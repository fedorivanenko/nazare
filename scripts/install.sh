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

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 20 ]; then
	echo "Nazare requires Node.js 20 or newer; found $(node --version)" >&2
	exit 1
fi

case "$(uname -s)" in
	Darwin) os="darwin" ;;
	Linux) os="linux" ;;
	*) echo "unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
	x86_64|amd64) arch="x64" ;;
	arm64|aarch64) arch="arm64" ;;
	*) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
target="$os-$arch"

if [ "$version" = "latest" ]; then
	version="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" \
		| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
		| head -1)"
fi
if [ -z "$version" ]; then
	echo "could not resolve latest Nazare release" >&2
	exit 1
fi

artifact="nazare-cli-$version-$target"
asset="$artifact.tar.gz"
download_base_url="${NAZARE_DOWNLOAD_BASE_URL:-https://github.com/$repo/releases/download/$version}"
url="$download_base_url/$asset"
versions_dir="$home_dir/versions"
bin_dir="$home_dir/bin"
install_dir="$versions_dir/$artifact"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

mkdir -p "$versions_dir" "$bin_dir"
echo "downloading Nazare $version for $target"
curl -fsSL "$url" -o "$tmp/$asset"
curl -fsSL "$url.sha256" -o "$tmp/$asset.sha256"

if command -v sha256sum >/dev/null 2>&1; then
	(cd "$tmp" && sha256sum -c "$asset.sha256")
elif command -v shasum >/dev/null 2>&1; then
	(cd "$tmp" && shasum -a 256 -c "$asset.sha256")
else
	echo "missing required checksum command: sha256sum or shasum" >&2
	exit 1
fi

tar -xzf "$tmp/$asset" -C "$tmp"
staged="$tmp/$artifact"
if [ ! -x "$staged/bin/nazare" ]; then
	echo "release artifact does not contain bin/nazare" >&2
	exit 1
fi
if [ "$(cat "$staged/VERSION")" != "$version" ]; then
	echo "release artifact version does not match $version" >&2
	exit 1
fi

if [ -e "$install_dir" ]; then
	if [ ! -x "$install_dir/bin/nazare" ] || [ "$(cat "$install_dir/VERSION")" != "$version" ]; then
		echo "existing installation is invalid; remove $install_dir and retry" >&2
		exit 1
	fi
else
	mv "$staged" "$install_dir"
fi
ln -sfn "$install_dir/bin/nazare" "$bin_dir/nazare"

"$bin_dir/nazare" --version >/dev/null
echo "nazare installed: $bin_dir/nazare"
case ":$PATH:" in
	*":$bin_dir:"*) ;;
	*) echo "add to PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac
