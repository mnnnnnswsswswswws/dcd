#!/bin/sh
# =============================================================================
# scripts/update_tools.sh — update system packages and iKali-installed tools.
#
# Usage: sh update_tools.sh [--dry-run]
# =============================================================================
set -u

IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

[ "${1:-}" = "--dry-run" ] && { IKALI_DRY_RUN=1; export IKALI_DRY_RUN; }

section "Updating system packages"
if [ "$IKALI_DRY_RUN" = "1" ]; then
    log_info "[dry-run] would update $IKALI_PKG packages."
else
    case "$IKALI_PKG" in
        apk) retry 3 2 _ikali_sudo apk update && retry 3 2 _ikali_sudo apk upgrade --no-cache ;;
        apt) retry 3 2 _ikali_sudo apt-get update && retry 3 2 _ikali_sudo apt-get upgrade -y ;;
        *)   log_warn "Unknown package manager; skipping system update." ;;
    esac
fi

section "Updating git-based tools"
SRC="$HOME/.ikali/src"
if [ -d "$SRC" ]; then
    for d in "$SRC"/*/; do
        [ -d "$d/.git" ] || continue
        log_info "git pull: $(basename "$d")"
        if [ "$IKALI_DRY_RUN" != "1" ]; then
            ( cd "$d" && git pull --ff-only 2>>"$IKALI_LOG" ) || log_warn "pull failed: $(basename "$d")"
        fi
    done
else
    log_info "No git-based tools directory yet."
fi

section "Updating nuclei templates"
if command -v nuclei >/dev/null 2>&1 && [ "$IKALI_DRY_RUN" != "1" ]; then
    nuclei -update-templates 2>>"$IKALI_LOG" || log_warn "nuclei template update failed."
fi

log_ok "Update complete."
