#!/usr/bin/env sh
set -eu

repo="${NAZARE_REPO:-https://github.com/fedorivanenko/nazare.git}"
ref="${NAZARE_REF:-main}"
install_dir="${NAZARE_INSTALL_DIR:-$HOME/.nazare/src}"

need() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "missing required command: $1" >&2
		exit 1
	fi
}

need git
need node

if ! command -v pnpm >/dev/null 2>&1; then
	if command -v corepack >/dev/null 2>&1; then
		corepack enable pnpm >/dev/null 2>&1 || true
	fi
fi
need pnpm

if [ -d "$install_dir/.git" ]; then
	git -C "$install_dir" fetch --tags origin "$ref"
	git -C "$install_dir" checkout "$ref"
	git -C "$install_dir" pull --ff-only origin "$ref" || true
else
	mkdir -p "$(dirname "$install_dir")"
	git clone --depth 1 --branch "$ref" "$repo" "$install_dir"
fi

cd "$install_dir"
pnpm install --frozen-lockfile
pnpm -s tsc -b
pnpm --filter @nazare/cli-client link --global

echo "nazare installed"
echo "run: nazare help"
