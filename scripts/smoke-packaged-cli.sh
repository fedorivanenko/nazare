#!/usr/bin/env sh
set -eu

tarball="${1:?packaged CLI tarball required}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

tar -xzf "$tarball" -C "$tmp"
root="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

for path in \
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

(
	cd "$root"
	pnpm install --frozen-lockfile --prod
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
	node packages/cli-client/dist/index.js --help >/dev/null 2>&1
)
