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
for pkg in cli-client compiler core registry theme; do
	mkdir -p "$out/packages/$pkg"
	cp "packages/$pkg/package.json" "$out/packages/$pkg/package.json"
	cp -R "packages/$pkg/dist" "$out/packages/$pkg/dist"
done

tar -C "$release_dir" -czf "$tarball" "nazare-cli-$version"
echo "$tarball"
