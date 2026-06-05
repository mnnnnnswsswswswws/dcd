#!/bin/sh
# =============================================================================
# scripts/quick_scan.sh — automated reconnaissance against a single target.
#
# Pipeline: DNS resolve -> nmap port/service scan -> nmap vuln scripts ->
# web enumeration (if web ports found) -> HTML report.
#
# Usage: sh quick_scan.sh [-o OUTDIR] [-p quick|standard|full] [-t] <target>
#   -t   route through Tor via proxychains (if installed)
#
# Input is strictly validated to prevent command injection.
# =============================================================================
set -u

IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

PROFILE="quick"
OUTDIR=""
USE_TOR=0
TARGET=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) OUTDIR="${2:-}"; shift 2 ;;
        -p) PROFILE="${2:-quick}"; shift 2 ;;
        -t) USE_TOR=1; shift ;;
        -h|--help)
            printf 'Usage: sh quick_scan.sh [-o OUTDIR] [-p quick|standard|full] [-t] <target>\n'; exit 0 ;;
        -*) log_error "Unknown option: $1"; exit 1 ;;
        *) TARGET="$1"; shift ;;
    esac
done

[ -n "$TARGET" ] || { log_error "No target specified."; exit 1; }

# Validate: hostname or IPv4 only. Reject anything with shell metacharacters.
if ! valid_host "$TARGET" && ! valid_cidr "$TARGET"; then
    log_error "Invalid target '$TARGET'. Expected hostname or IPv4."
    exit 1
fi

# Resolve output directory.
_ts="$(date '+%Y%m%d-%H%M%S')"
OUTDIR="${OUTDIR:-./reports/${TARGET}_${_ts}}"
mkdir -p "$OUTDIR"
log_info "Results -> $OUTDIR"

# Tor prefix.
PCHAIN=""
if [ "$USE_TOR" = "1" ]; then
    if command -v proxychains >/dev/null 2>&1 || command -v proxychains4 >/dev/null 2>&1; then
        PCHAIN="$(command -v proxychains4 || command -v proxychains)"
        log_info "Routing through Tor via $PCHAIN"
    else
        log_warn "proxychains not installed; continuing without Tor."
    fi
fi

run() {
    # run <logfile> <command...> — always quoted, never eval.
    _lf="$1"; shift
    log_info "+ $*"
    if [ -n "$PCHAIN" ]; then
        "$PCHAIN" "$@" > "$_lf" 2>&1 || log_warn "command exited non-zero (see $_lf)"
    else
        "$@" > "$_lf" 2>&1 || log_warn "command exited non-zero (see $_lf)"
    fi
}

# nmap flags differ on iSH (no raw sockets -> TCP connect, unprivileged).
NMAP_BASE="-Pn"
if is_ish; then
    NMAP_BASE="-Pn -sT --unprivileged"
fi

case "$PROFILE" in
    quick)    NMAP_PORTS="--top-ports 1000" ;;
    standard) NMAP_PORTS="--top-ports 3000 -sV" ;;
    full)     NMAP_PORTS="-p- -sV -sC" ;;
    *) log_warn "Unknown profile '$PROFILE', using quick."; NMAP_PORTS="--top-ports 1000" ;;
esac

section "1/4 DNS resolution"
if command -v dig >/dev/null 2>&1; then
    run "$OUTDIR/dns.txt" dig +short "$TARGET"
fi

section "2/4 Port & service scan"
if command -v nmap >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    run "$OUTDIR/nmap.txt" nmap $NMAP_BASE $NMAP_PORTS -oN "$OUTDIR/nmap_scan.txt" "$TARGET"
else
    log_warn "nmap not installed; skipping port scan."
fi

section "3/4 Vulnerability scripts"
if command -v nmap >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    run "$OUTDIR/nmap_vuln.txt" nmap $NMAP_BASE --script vuln "$TARGET"
fi

section "4/4 Web enumeration (if web ports open)"
if grep -Eq '(^|[^0-9])(80|443|8080|8443)/(tcp).*open' "$OUTDIR/nmap_scan.txt" 2>/dev/null; then
    _scheme="http"; grep -q '443/tcp.*open' "$OUTDIR/nmap_scan.txt" 2>/dev/null && _scheme="https"
    log_info "Web port detected -> running web_enum.sh"
    sh "$IKALI_ROOT/scripts/web_enum.sh" -o "$OUTDIR/web" "${_scheme}://${TARGET}" || log_warn "web_enum step failed."
else
    log_info "No common web ports open; skipping web enumeration."
fi

section "Report"
sh "$IKALI_ROOT/scripts/report_gen.sh" "$OUTDIR" || log_warn "Report generation failed."

log_ok "quick_scan finished for $TARGET. See $OUTDIR/report.html"
