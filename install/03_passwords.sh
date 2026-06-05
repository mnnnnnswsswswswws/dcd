#!/bin/sh
# install/03_passwords.sh — password attack tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Password attack tools"

pkg_install hydra medusa john hashcat crunch ncrack || log_warn "Some password apk packages missing."

pip_install patator hashid

gem_install cewl

# cupp via git (interactive profiler)
SRC="$HOME/.ikali/src"; mkdir -p "$SRC"
if [ "$IKALI_DRY_RUN" != "1" ]; then
    [ -d "$SRC/cupp" ] || git clone --depth 1 https://github.com/Mebus/cupp.git "$SRC/cupp" 2>>"$IKALI_LOG" || log_warn "cupp clone failed."
fi

if is_ish; then
    log_warn "hashcat runs CPU-only and is very slow under iSH emulation."
fi

verify_group hydra john crunch
log_ok "Password tools complete."
