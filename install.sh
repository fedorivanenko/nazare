#!/bin/sh
set -eu

error() {
  printf 'nazare install error: %s\n' "$1" >&2
  exit 1
}

warn() {
  printf 'nazare install warning: %s\n' "$1" >&2
}

info() {
  printf 'nazare install: %s\n' "$1"
}

shell_quote() {
  printf "%s" "$1" | sed "s/'/'\\''/g; 1s/^/'/; \$s/\$/'/"
}

json_escape() {
  printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

read_package_version() {
  node -e '
const fs = require("node:fs");
const file = process.argv[1];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
try {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof pkg.version !== "string" || !semver.test(pkg.version)) process.exit(2);
  process.stdout.write(pkg.version);
} catch {
  process.exit(1);
}
' "$1"
}

command -v node >/dev/null 2>&1 || error 'required runtime Node.js is missing'
command -v curl >/dev/null 2>&1 || error 'curl is required to download Nazare CLI files'

HOME_DIR=${HOME:-}
[ -n "$HOME_DIR" ] || error 'HOME is not set'

INSTALL_DIR=${NAZARE_INSTALL_DIR:-"$HOME_DIR/.nazare"}
BIN_DIR=${NAZARE_BIN_DIR:-"$HOME_DIR/.local/bin"}
SHIM="$BIN_DIR/nazare"
SHIM_TMP="$BIN_DIR/nazare.tmp.$$"
INSTALL_REF=${NAZARE_INSTALL_REF:-main}
INSTALL_SCRIPT_URL=${NAZARE_INSTALL_SCRIPT_URL:-"https://raw.githubusercontent.com/fedorivanenko/nazare/$INSTALL_REF/install.sh"}
CLI_URL=${NAZARE_CLI_URL:-"https://raw.githubusercontent.com/fedorivanenko/nazare/$INSTALL_REF/bin/nazare.js"}
PACKAGE_URL=${NAZARE_PACKAGE_URL:-"https://raw.githubusercontent.com/fedorivanenko/nazare/$INSTALL_REF/package.json"}
CLI_DIR="$INSTALL_DIR/bin"
CLI_FILE="$CLI_DIR/nazare.js"
PACKAGE_FILE="$INSTALL_DIR/package.json"
METADATA_FILE="$INSTALL_DIR/nazare.install.json"
TMP_CLI_FILE="$CLI_FILE.tmp.$$"
TMP_PACKAGE_FILE="$PACKAGE_FILE.tmp.$$"
TMP_METADATA_FILE="$METADATA_FILE.tmp.$$"

case "$INSTALL_DIR" in
  '') error 'install directory is empty' ;;
esac
case "$BIN_DIR" in
  '') error 'bin directory is empty' ;;
esac

can_write_dir() {
  dir=$1
  if [ -e "$dir" ]; then
    [ -d "$dir" ] || return 1
    [ -w "$dir" ] || return 1
  else
    parent=$(dirname "$dir")
    while [ ! -e "$parent" ]; do
      next=$(dirname "$parent")
      [ "$next" = "$parent" ] && break
      parent=$next
    done
    [ -d "$parent" ] || return 1
    [ -w "$parent" ] || return 1
  fi
}

can_write_dir "$INSTALL_DIR" || error "install destination is not writable: $INSTALL_DIR"
can_write_dir "$BIN_DIR" || error "CLI bin directory is not writable: $BIN_DIR"

if [ -e "$SHIM" ] || [ -L "$SHIM" ]; then
  owned=false
  if [ -L "$SHIM" ]; then
    target=$(readlink "$SHIM" || printf '')
    [ "$target" = "$CLI_FILE" ] && owned=true
  elif grep -q 'Nazare CLI shim' "$SHIM" 2>/dev/null; then
    owned=true
  fi

  [ "$owned" = true ] || error "$SHIM exists but is not owned by Nazare; refusing to overwrite"
fi

mkdir -p "$CLI_DIR" || error "cannot create install directory: $CLI_DIR"
mkdir -p "$BIN_DIR" || error "cannot create CLI bin directory: $BIN_DIR"

cleanup() {
  rm -f "$TMP_CLI_FILE" "$TMP_PACKAGE_FILE" "$TMP_METADATA_FILE" "$SHIM_TMP"
}
trap cleanup EXIT INT TERM

curl -fsSL "$CLI_URL" -o "$TMP_CLI_FILE" || error "cannot download Nazare CLI from $CLI_URL"
curl -fsSL "$PACKAGE_URL" -o "$TMP_PACKAGE_FILE" || error "cannot download Nazare package metadata from $PACKAGE_URL"

VERSION=$(read_package_version "$TMP_PACKAGE_FILE") || error 'missing or invalid package.json version metadata'
INSTALLED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

{
  printf '{\n'
  printf '  "version": "%s",\n' "$(json_escape "$VERSION")"
  printf '  "installedRef": "%s",\n' "$(json_escape "$INSTALL_REF")"
  printf '  "cliUrl": "%s",\n' "$(json_escape "$CLI_URL")"
  printf '  "packageUrl": "%s",\n' "$(json_escape "$PACKAGE_URL")"
  printf '  "installScriptUrl": "%s",\n' "$(json_escape "$INSTALL_SCRIPT_URL")"
  printf '  "installedAt": "%s"\n' "$(json_escape "$INSTALLED_AT")"
  printf '}\n'
} > "$TMP_METADATA_FILE" || error "cannot create install metadata: $METADATA_FILE"

mv "$TMP_CLI_FILE" "$CLI_FILE" || error "cannot install CLI file: $CLI_FILE"
chmod +x "$CLI_FILE" || error "cannot mark CLI executable: $CLI_FILE"
mv "$TMP_PACKAGE_FILE" "$PACKAGE_FILE" || error "cannot install package metadata: $PACKAGE_FILE"
mv "$TMP_METADATA_FILE" "$METADATA_FILE" || error "cannot install metadata: $METADATA_FILE"

rm -f "$SHIM" || error "cannot replace Nazare-owned CLI bin: $SHIM"

quoted_install_dir=$(shell_quote "$INSTALL_DIR")
{
  printf '#!/bin/sh\n'
  printf '# Nazare CLI shim\n'
  printf '# Managed by Nazare installer\n'
  printf 'NAZARE_INSTALL_DIR=%s\n' "$quoted_install_dir"
  printf 'exec node "$NAZARE_INSTALL_DIR/bin/nazare.js" "$@"\n'
} > "$SHIM_TMP" || error "cannot create CLI bin: $SHIM"
chmod +x "$SHIM_TMP" || error "cannot mark CLI bin executable: $SHIM"
mv "$SHIM_TMP" "$SHIM" || error "cannot install CLI bin: $SHIM"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on PATH; add it to run nazare directly" ;;
esac

info "installed nazare $VERSION to $INSTALL_DIR"
info "created CLI command at $SHIM"
