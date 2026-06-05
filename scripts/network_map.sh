#!/bin/sh
# =============================================================================
# scripts/network_map.sh — discover live hosts on a network range.
#
# Usage: sh network_map.sh [-o OUTDIR] <cidr|range>
#   e.g. sh network_map.sh 192.168.1.0/24
# =============================================================================
set -u

IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

OUTDIR=""
RANGE=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) OUTDIR="${2:-}"; shift 2 ;;
        -h|--help) printf 'Usage: sh network_map.sh [-o OUTDIR] <cidr>\n'; exit 0 ;;
        -*) log_error "Unknown option: $1"; exit 1 ;;
        *) RANGE="$1"; shift ;;
    esac
done

[ -n "$RANGE" ] || { log_error "No range specified."; exit 1; }
if ! valid_cidr "$RANGE"; then
    log_error "Invalid range '$RANGE'. Expected IPv4 or IPv4/CIDR."
    exit 1
fi

_ts="$(date '+%Y%m%d-%H%M%S')"
OUTDIR="${OUTDIR:-./reports/netmap_${_ts}}"
mkdir -p "$OUTDIR"
log_info "Results -> $OUTDIR"

command -v nmap >/dev/null 2>&1 || { log_error "nmap is required."; exit 1; }

# Host discovery. On iSH, ICMP/ARP ping sweeps need raw sockets; fall back to a
# TCP connect ping which works unprivileged.
section "Host discovery"
if is_ish; then
    log_info "iSH: using TCP-connect discovery (-sn -PS)."
    nmap -sn -PS22,80,443 "$RANGE" -oN "$OUTDIR/hosts.txt" 2>&1 | tee "$OUTDIR/discovery.txt" || true
else
    nmap -sn "$RANGE" -oN "$OUTDIR/hosts.txt" 2>&1 | tee "$OUTDIR/discovery.txt" || true
fi

# Extract live IPs.
grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' "$OUTDIR/hosts.txt" 2>/dev/null | sort -u > "$OUTDIR/live_hosts.txt" || true
_count="$(wc -l < "$OUTDIR/live_hosts.txt" 2>/dev/null | tr -d ' ')"
log_ok "Discovered ${_count:-0} live host(s). List: $OUTDIR/live_hosts.txt"

section "Top-ports scan of live hosts"
if [ "${_count:-0}" -gt 0 ]; then
    _base="-Pn --top-ports 100"
    is_ish && _base="-Pn -sT --unprivileged --top-ports 100"
    # shellcheck disable=SC2086
    nmap $_base -iL "$OUTDIR/live_hosts.txt" -oN "$OUTDIR/ports.txt" >/dev/null 2>&1 || log_warn "port scan had issues."
    log_ok "Port scan saved to $OUTDIR/ports.txt"
fi

sh "$IKALI_ROOT/scripts/report_gen.sh" "$OUTDIR" || log_warn "Report generation failed."
log_ok "network_map finished."
