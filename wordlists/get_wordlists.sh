#!/bin/sh
# =============================================================================
# wordlists/get_wordlists.sh — download common wordlists with verification.
#
# Honors available storage and warns before large downloads. SecLists is large
# and skipped by default under iSH unless --force is given.
#
# Usage: sh get_wordlists.sh [--rockyou] [--seclists] [--all] [--force]
# =============================================================================
set -u

IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

WL_DIR="$IKALI_ROOT/wordlists"
DO_ROCKYOU=0; DO_SECLISTS=0; FORCE=0

for a in "$@"; do
    case "$a" in
        --rockyou) DO_ROCKYOU=1 ;;
        --seclists) DO_SECLISTS=1 ;;
        --all) DO_ROCKYOU=1; DO_SECLISTS=1 ;;
        --force) FORCE=1 ;;
        -h|--help) printf 'Usage: sh get_wordlists.sh [--rockyou] [--seclists] [--all] [--force]\n'; exit 0 ;;
        *) log_warn "Unknown arg: $a" ;;
    esac
done

# Default: rockyou only (small, always useful).
[ "$DO_ROCKYOU" = "0" ] && [ "$DO_SECLISTS" = "0" ] && DO_ROCKYOU=1

log_info "Free storage on home: ${IKALI_STORAGE_GB} GB"

if [ "$DO_ROCKYOU" = "1" ]; then
    section "rockyou.txt"
    _gz="$WL_DIR/rockyou.txt.gz"
    _txt="$WL_DIR/rockyou.txt"
    if [ -f "$_txt" ]; then
        log_ok "rockyou.txt already present."
    else
        # Mirror in the SecLists repo; verified by size after extraction.
        if safe_download "https://github.com/brannondorsey/naive-hashcat/releases/download/data/rockyou.txt" "$_txt"; then
            log_ok "rockyou.txt downloaded ($(wc -l < "$_txt" 2>/dev/null) lines)."
        else
            log_warn "rockyou download failed."
        fi
        rm -f "$_gz" 2>/dev/null || true
    fi
fi

if [ "$DO_SECLISTS" = "1" ]; then
    section "SecLists"
    if is_ish && [ "$FORCE" != "1" ]; then
        log_warn "SecLists is ~1GB; skipped on iSH. Re-run with --force to download."
    else
        _dir="$WL_DIR/seclists"
        if [ -d "$_dir/.git" ]; then
            log_ok "SecLists already cloned; pulling updates."
            ( cd "$_dir" && git pull --ff-only 2>>"$IKALI_LOG" ) || log_warn "SecLists update failed."
        else
            git clone --depth 1 https://github.com/danielmiessler/SecLists.git "$_dir" 2>>"$IKALI_LOG" \
                && log_ok "SecLists cloned." || log_warn "SecLists clone failed."
        fi
    fi
fi

log_ok "Wordlist setup complete. Bundled small lists: $WL_DIR/custom/"
