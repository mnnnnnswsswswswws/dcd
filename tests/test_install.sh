#!/bin/sh
# tests/test_install.sh — verify which registered tools are present in PATH.
# Read-only; never installs. Fast (<10s).
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

TOOLS_DB="$IKALI_ROOT/lib/tools.db"
PASS=0; FAIL=0

printf '%b iKali install check (env: %s) %b\n\n' "$C_BOLD" "$IKALI_ENV" "$C_RESET"

# Iterate registry: column 4 is the binary, column 1 is the name, column 5 ish_ok.
while IFS='|' read -r name cat method pkg ish desc; do
    case "$name" in ''|\#*) continue ;; esac
    [ -n "${pkg:-}" ] || continue
    if command -v "$pkg" >/dev/null 2>&1; then
        printf '  %bPASS%b  %-18s (%s)\n' "$C_GREEN" "$C_RESET" "$name" "$pkg"
        PASS=$(( PASS + 1 ))
    else
        # On iSH, tools marked ish_ok=no are expected to be missing.
        if is_ish && [ "${ish:-}" = "no" ]; then
            printf '  %bSKIP%b  %-18s (iSH: not supported)\n' "$C_YELLOW" "$C_RESET" "$name"
        else
            printf '  %bMISS%b  %-18s (%s)\n' "$C_RED" "$C_RESET" "$name" "$pkg"
            FAIL=$(( FAIL + 1 ))
        fi
    fi
done < "$TOOLS_DB"

printf '\nInstalled: %d   Missing: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
