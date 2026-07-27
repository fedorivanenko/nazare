#!/usr/bin/env sh
set -eu

repo="${NAZARE_REPO:-fedorivanenko/nazare}"
installer_ref="${NAZARE_INSTALLER_REF:-main}"

if ! command -v curl >/dev/null 2>&1; then
	echo "missing required command: curl" >&2
	exit 1
fi

curl -fsSL "https://raw.githubusercontent.com/$repo/$installer_ref/scripts/install.sh" \
	| NAZARE_PRODUCT=source sh
