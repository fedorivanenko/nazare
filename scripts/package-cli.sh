#!/usr/bin/env sh
set -eu

version="${1:?version required (example: v0.1.0)}"
root="$(pwd)"
release_dir="$root/.release"
out="$release_dir/nazare-cli-$version"
tarball="$release_dir/nazare-cli-$version.tar.gz"

rm -rf "$release_dir"
mkdir -p "$out/packages"

pnpm -s typecheck

cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$out/"
for pkg in cli-client compiler core registry scan source theme; do
	mkdir -p "$out/packages/$pkg"
	cp "packages/$pkg/package.json" "$out/packages/$pkg/package.json"
	cp -R "packages/$pkg/dist" "$out/packages/$pkg/dist"
done

# @nazare/source loads both native grammars at runtime. Ship generated C sources
# for install-time fallback and the current release runner's native binary so a
# packaged CLI does not silently depend on monorepo node_modules.
for pkg in tree-sitter-liquid tree-sitter-nazare-liquid; do
	src="packages/$pkg"
	dest="$out/packages/$pkg"
	mkdir -p "$dest/bindings" "$dest/build"
	cp "$src/package.json" "$src/binding.gyp" "$src/grammar.js" "$src/LICENSE" "$dest/"
	cp -R "$src/bindings/node" "$dest/bindings/node"
	cp -R "$src/src" "$src/queries" "$dest/"
	if [ -d "$src/build/Release" ] && find "$src/build/Release" -maxdepth 1 -name '*.node' -type f | grep -q .; then
		mkdir -p "$dest/build/Release"
		cp "$src"/build/Release/*.node "$dest/build/Release/"
	fi
done

tar -C "$release_dir" -czf "$tarball" "nazare-cli-$version"
echo "$tarball"
