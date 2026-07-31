#!/usr/bin/env sh
set -eu

version="${1:?version required (example: v0.1.0)}"

# Keep target names stable across GitHub runners and local release builds.
detect_target() {
	case "$(uname -s)" in
		Darwin) os="darwin" ;;
		Linux) os="linux" ;;
		*) echo "unsupported release operating system: $(uname -s)" >&2; exit 1 ;;
	esac
	case "$(uname -m)" in
		x86_64|amd64) arch="x64" ;;
		arm64|aarch64) arch="arm64" ;;
		*) echo "unsupported release architecture: $(uname -m)" >&2; exit 1 ;;
	esac
	printf '%s-%s\n' "$os" "$arch"
}

detected_target="$(detect_target)"
target="${2:-$detected_target}"
if [ "$target" != "$detected_target" ]; then
	echo "release target $target does not match build host $detected_target" >&2
	exit 1
fi
root="$(pwd)"
release_dir="$root/.release"
artifact="nazare-cli-$version-$target"
out="$release_dir/$artifact"
tarball="$release_dir/$artifact.tar.gz"

mkdir -p "$release_dir"
rm -rf "$out" "$tarball" "$tarball.sha256"
mkdir -p "$out/packages" "$out/bin"

pnpm -s typecheck

cp package.json pnpm-lock.yaml pnpm-workspace.yaml LICENSE "$out/"
cp -R patches "$out/patches"
printf '%s\n' "$version" > "$out/VERSION"
for pkg in cli-client compiler core registry source source-cli theme; do
	mkdir -p "$out/packages/$pkg"
	cp "packages/$pkg/package.json" "$out/packages/$pkg/package.json"
	cp -R "packages/$pkg/dist" "$out/packages/$pkg/dist"
done

# @nazare/source loads both native grammars at runtime. Generated C sources
# remain available for provenance; release artifacts carry host-built binaries.
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

cat > "$out/bin/nazare" <<'SH'
#!/usr/bin/env sh
set -eu
script="$0"
while [ -L "$script" ]; do
	directory="$(CDPATH= cd -- "$(dirname -- "$script")" && pwd)"
	link="$(readlink "$script")"
	case "$link" in
		/*) script="$link" ;;
		*) script="$directory/$link" ;;
	esac
done
root="$(CDPATH= cd -- "$(dirname -- "$script")/.." && pwd)"
exec node "$root/packages/cli-client/dist/index.js" "$@"
SH
chmod +x "$out/bin/nazare"

# Resolve production dependencies while building the artifact. Installation is
# then offline and does not require pnpm, Python, node-gyp, or compiler tools.
(
	cd "$out"
	pnpm install --prod --frozen-lockfile >/dev/null
)

tar -C "$release_dir" -czf "$tarball" "$artifact"
if command -v sha256sum >/dev/null 2>&1; then
	(cd "$release_dir" && sha256sum "$(basename "$tarball")" > "$(basename "$tarball").sha256")
else
	(cd "$release_dir" && shasum -a 256 "$(basename "$tarball")" > "$(basename "$tarball").sha256")
fi
printf '%s\n' "$tarball"
