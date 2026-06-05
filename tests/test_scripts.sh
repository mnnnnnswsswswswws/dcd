#!/bin/sh
# tests/test_scripts.sh — syntax + input-validation tests for scripts/.
# Includes a negative test: command-injection attempts must be rejected.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"

FAIL=0

section "Syntax check: all shell scripts"
for f in "$IKALI_ROOT"/setup.sh "$IKALI_ROOT"/lib/*.sh \
         "$IKALI_ROOT"/install/*.sh "$IKALI_ROOT"/scripts/*.sh \
         "$IKALI_ROOT"/menu/*.sh "$IKALI_ROOT"/tests/*.sh \
         "$IKALI_ROOT"/wordlists/*.sh; do
    [ -f "$f" ] || continue
    if sh -n "$f"; then
        :
    else
        log_error "Syntax error: $f"; FAIL=$(( FAIL + 1 ))
    fi
done
[ "$FAIL" -eq 0 ] && log_ok "All scripts parse cleanly."

section "Input validation (positive)"
for good in example.com 192.168.1.1 10.0.0.0/24; do
    if valid_host "$good" || valid_cidr "$good"; then
        log_ok "accepted: $good"
    else
        log_error "should accept: $good"; FAIL=$(( FAIL + 1 ))
    fi
done
if valid_url "https://example.com/path?q=1"; then
    log_ok "accepted URL"
else
    log_error "should accept URL"; FAIL=$(( FAIL + 1 ))
fi

section "Input validation (negative — injection attempts)"
# These MUST all be rejected by every validator.
for bad in '; rm -rf /' '$(reboot)' '`id`' 'a && b' 'a|b' 'a;b' '../etc/passwd' '' ; do
    if valid_host "$bad" || valid_cidr "$bad" || valid_url "$bad"; then
        log_error "VULN: validator accepted malicious input: [$bad]"; FAIL=$(( FAIL + 1 ))
    else
        log_ok "rejected: [$bad]"
    fi
done

section "Live injection test against quick_scan.sh"
# quick_scan must refuse the payload and exit non-zero without running anything.
if sh "$IKALI_ROOT/scripts/quick_scan.sh" '; touch /tmp/ikali_pwned' >/dev/null 2>&1; then
    log_error "quick_scan.sh accepted an injection payload!"; FAIL=$(( FAIL + 1 ))
else
    if [ -f /tmp/ikali_pwned ]; then
        log_error "injection executed! file created."; rm -f /tmp/ikali_pwned; FAIL=$(( FAIL + 1 ))
    else
        log_ok "quick_scan.sh rejected injection payload."
    fi
fi

[ "$FAIL" -eq 0 ] && log_ok "Script tests passed." || log_error "$FAIL script test failure(s)."
[ "$FAIL" -eq 0 ]
