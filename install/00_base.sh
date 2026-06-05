#!/bin/sh
# install/00_base.sh — base packages every other module depends on.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Base system packages"

# Core toolchain and interpreters. apt uses slightly different names; pkg_install
# maps the manager, but a couple of names differ — handle the common ones.
if [ "$IKALI_PKG" = "apt" ]; then
    pkg_install curl wget git python3 python3-pip ruby perl tmux vim jq tar unzip build-essential ca-certificates
else
    pkg_install curl wget git python3 py3-pip ruby perl tmux vim jq tar unzip build-base ca-certificates
fi

# Go and gem are large; install but tolerate failure (slow on iSH).
pkg_install go || log_warn "Go toolchain not installed (optional)."

# Ensure pip is usable and up to date for the --user installs later.
if command -v pip3 >/dev/null 2>&1; then
    if [ "$IKALI_DRY_RUN" != "1" ]; then
        pip3 install --user --upgrade pip 2>>"$IKALI_LOG" || \
        pip3 install --user --upgrade --break-system-packages pip 2>>"$IKALI_LOG" || \
        log_warn "Could not upgrade pip (continuing)."
    fi
fi

# Make sure user bin dirs are on PATH for go/pip/gem installed tools.
for d in "$HOME/.local/bin" "$HOME/go/bin" "$HOME/.gem/ruby"; do
    case ":$PATH:" in
        *":$d:"*) : ;;
        *) [ -d "$d" ] || true ;;
    esac
done

verify_group curl wget git python3 vim tmux jq
log_ok "Base packages complete."
