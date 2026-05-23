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

command -v node >/dev/null 2>&1 || error 'required runtime Node.js is missing'
command -v curl >/dev/null 2>&1 || error 'curl is required to download Nazare CLI files'

HOME_DIR=${HOME:-}
[ -n "$HOME_DIR" ] || error 'HOME is not set'

INSTALL_DIR=${NAZARE_INSTALL_DIR:-"$HOME_DIR/.nazare"}
BIN_DIR=${NAZARE_BIN_DIR:-"$HOME_DIR/.local/bin"}
SHIM="$BIN_DIR/nazare"
SHIM_TMP="$BIN_DIR/nazare.tmp.$$"
CLI_URL=${NAZARE_CLI_URL:-'https://raw.githubusercontent.com/fedorivanenko/nazare/main/bin/nazare.js'}
CLI_DIR="$INSTALL_DIR/bin"
CLI_FILE="$CLI_DIR/nazare.js"
TMP_FILE="$CLI_FILE.tmp.$$"

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

curl -fsSL "$CLI_URL" -o "$TMP_FILE" || {
  rm -f "$TMP_FILE"
  error "cannot download Nazare CLI from $CLI_URL"
}

mv "$TMP_FILE" "$CLI_FILE" || error "cannot install CLI file: $CLI_FILE"
chmod +x "$CLI_FILE" || error "cannot mark CLI executable: $CLI_FILE"

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

info "installed nazare to $INSTALL_DIR"
info "created CLI command at $SHIM"
