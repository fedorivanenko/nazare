#!/usr/bin/env sh
set -eu

tarball="${1:?packaged source CLI tarball required}"
checksum="$tarball.sha256"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

if [ ! -f "$checksum" ]; then
	echo "packaged source CLI missing checksum $checksum" >&2
	exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
	(cd "$(dirname "$tarball")" && sha256sum -c "$(basename "$checksum")")
else
	(cd "$(dirname "$tarball")" && shasum -a 256 -c "$(basename "$checksum")")
fi

tar -xzf "$tarball" -C "$tmp"
root="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

for path in \
	VERSION \
	bin/nazare-source \
	packages/source/dist/index.js \
	packages/source-cli/dist/index.js \
	packages/tree-sitter-liquid/build/Release \
	packages/tree-sitter-nazare-liquid/build/Release
do
	test -e "$root/$path" || {
		echo "packaged source CLI missing $path" >&2
		exit 1
	}
done

# Parser-only artifacts must not accidentally pull compiler/theme/registry code.
for package in compiler cli-client core registry theme; do
	test ! -e "$root/packages/$package" || {
		echo "packaged source CLI unexpectedly includes packages/$package" >&2
		exit 1
	}
done

test -d "$root/node_modules" || {
	echo "packaged source CLI missing production dependencies" >&2
	exit 1
}

"$root/bin/nazare-source" --version | grep -Fx "$(cat "$root/VERSION")" >/dev/null
printf '{{ product.title }}' \
	| "$root/bin/nazare-source" analyze --stdin --language liquid \
	| grep -F '"authoritative": true' >/dev/null
