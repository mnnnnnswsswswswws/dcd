#!/bin/sh
# install/09_forensics.sh — digital forensics & steganography tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Forensics tools"

pkg_install foremost scalpel exiftool steghide fcrackzip || log_warn "Some forensics apk packages missing."

# volatility3 — memory forensics, pure Python, works on iSH.
pip_install volatility3

# stegseek (fast steghide cracker) — release binary.
SRC="$HOME/.ikali/src"; mkdir -p "$SRC"
if ! tool_installed stegseek && [ "$IKALI_DRY_RUN" != "1" ]; then
    log_info "stegseek: download from releases if needed (see docs/TOOLS.md)."
fi

verify_group foremost exiftool steghide
log_ok "Forensics tools complete."
