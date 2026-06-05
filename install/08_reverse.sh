#!/bin/sh
# install/08_reverse.sh — reverse engineering & binary analysis tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Reverse engineering tools"

pkg_install radare2 gdb binwalk binutils upx || log_warn "Some RE apk packages missing."

# Tracers depend on ptrace; partial under iSH but install anyway.
pkg_install ltrace strace || log_warn "ltrace/strace not packaged."

if is_ish; then
    log_warn "ptrace-based tracing (ltrace/strace/gdb attach) is limited under iSH."
fi

verify_group r2 gdb binwalk strings
log_ok "Reverse engineering tools complete."
