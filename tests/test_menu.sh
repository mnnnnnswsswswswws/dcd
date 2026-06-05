#!/bin/sh
# tests/test_menu.sh — static checks for the menu and the tool database.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"

FAIL=0

section "Syntax check: menu.sh"
if sh -n "$IKALI_ROOT/menu/menu.sh"; then
    log_ok "menu.sh parses cleanly."
else
    log_error "menu.sh has syntax errors."; FAIL=$(( FAIL + 1 ))
fi

section "tools.db integrity"
_db="$IKALI_ROOT/lib/tools.db"
_bad=0; _count=0
while IFS='|' read -r name cat method pkg ish desc; do
    case "$name" in ''|\#*) continue ;; esac
    _count=$(( _count + 1 ))
    # Every active row must have all six fields populated.
    if [ -z "$cat" ] || [ -z "$method" ] || [ -z "$pkg" ] || [ -z "$ish" ] || [ -z "$desc" ]; then
        log_warn "Malformed row: $name"; _bad=$(( _bad + 1 ))
    fi
    case "$ish" in yes|no|partial) : ;; *) log_warn "Bad ish_ok '$ish' for $name"; _bad=$(( _bad + 1 )) ;; esac
done < "$_db"

log_info "Registered tools: $_count"
if [ "$_count" -ge 130 ]; then
    log_ok "Tool count >= 130."
else
    log_warn "Tool count is $_count (target: 130+)."
fi
if [ "$_bad" -eq 0 ]; then
    log_ok "All rows well-formed."
else
    log_error "$_bad malformed row(s)."; FAIL=$(( FAIL + 1 ))
fi

[ "$FAIL" -eq 0 ] && log_ok "Menu tests passed." || log_error "Menu tests failed."
[ "$FAIL" -eq 0 ]
