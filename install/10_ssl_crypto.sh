#!/bin/sh
# install/10_ssl_crypto.sh — SSL/TLS testing & crypto utilities.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "SSL/TLS & crypto tools"

pkg_install openssl sslscan gnupg fcrackzip || log_warn "Some SSL apk packages missing."

# john's zip2john helper for hash extraction (ships with john).
pkg_install john || true

pip_install sslyze hashid

# testssl.sh — single self-contained script.
SRC="$HOME/.ikali/src"; mkdir -p "$SRC"
if [ "$IKALI_DRY_RUN" != "1" ]; then
    if [ ! -d "$SRC/testssl.sh" ]; then
        git clone --depth 1 https://github.com/drwetter/testssl.sh.git "$SRC/testssl.sh" 2>>"$IKALI_LOG" \
            && ln -sf "$SRC/testssl.sh/testssl.sh" "$HOME/.local/bin/testssl.sh" 2>/dev/null \
            || log_warn "testssl.sh setup failed."
    fi
fi

verify_group openssl sslscan gpg
log_ok "SSL/crypto tools complete."
