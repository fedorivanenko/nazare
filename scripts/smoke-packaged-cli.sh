#!/usr/bin/env sh
set -eu

tarball="${1:?packaged CLI tarball required}"
checksum="$tarball.sha256"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

if [ ! -f "$checksum" ]; then
	echo "packaged CLI missing checksum $checksum" >&2
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
	bin/nazare \
	packages/source/dist/index.js \
	packages/tree-sitter-liquid/src/parser.c \
	packages/tree-sitter-liquid/src/scanner.c \
	packages/tree-sitter-liquid/bindings/node/index.js \
	packages/tree-sitter-nazare-liquid/src/parser.c \
	packages/tree-sitter-nazare-liquid/src/scanner.c \
	packages/tree-sitter-nazare-liquid/bindings/node/index.js
do
	test -f "$root/$path" || {
		echo "packaged CLI missing $path" >&2
		exit 1
	}
done

for pkg in tree-sitter-liquid tree-sitter-nazare-liquid; do
	find "$root/packages/$pkg/build/Release" -name '*.node' -type f | grep -q . || {
		echo "packaged CLI missing native binary for $pkg" >&2
		exit 1
	}
done

test -d "$root/node_modules" || {
	echo "packaged CLI missing production dependencies" >&2
	exit 1
}

"$root/bin/nazare" --version | grep -Fx "$(cat "$root/VERSION")" >/dev/null
"$root/bin/nazare" --help >/dev/null 2>&1
printf '{{ product.title }}' \
	| "$root/bin/nazare" source analyze --stdin --language liquid \
	| grep -F '"authoritative": true' >/dev/null

# Loading through the source API catches native dependency leaks that the CLI
# wrapper could otherwise conceal.
(
	cd "$root"
	node --input-type=module - <<'NODE'
import {
	createDefaultSourceParserRegistry,
	parseSourceDocument,
} from "./packages/source/dist/index.js";

const registry = createDefaultSourceParserRegistry();
for (const [language, source] of [
	["liquid", "{{ product.title }}"],
	["nazare-liquid", "{% component snippet %}"],
]) {
	const document = parseSourceDocument(registry, `smoke.${language}`, language, source);
	if (document.issues.length > 0) {
		throw new Error(`${language} packaged parser failed: ${JSON.stringify(document.issues)}`);
	}
}
NODE
)
