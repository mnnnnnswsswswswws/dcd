#!/bin/sh
# =============================================================================
# scripts/vuln_check.sh — vulnerability assessment of a target.
#
# Runs nuclei (if installed) and nmap vuln NSE scripts, then builds a report.
#
# Usage: sh vuln_check.sh [-o OUTDIR] <target>
# =============================================================================
set -u

IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

OUTDIR=""
TARGET=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) OUTDIR="${2:-}"; shift 2 ;;
        -h|--help) printf 'Usage: sh vuln_check.sh [-o OUTDIR] <target>\n'; exit 0 ;;
        -*) log_error "Unknown option: $1"; exit 1 ;;
        *) TARGET="$1"; shift ;;
    esac
done

[ -n "$TARGET" ] || { log_error "No target specified."; exit 1; }
if ! valid_host "$TARGET" && ! valid_url "$TARGET" && ! valid_cidr "$TARGET"; then
    log_error "Invalid target '$TARGET'."
    exit 1
fi

_ts="$(date '+%Y%m%d-%H%M%S')"
_safe="$(printf '%s' "$TARGET" | tr -c 'A-Za-z0-9._-' '_')"
OUTDIR="${OUTDIR:-./reports/vuln_${_safe}_${_ts}}"
mkdir -p "$OUTDIR"
log_info "Results -> $OUTDIR"

run() { _lf="$1"; shift; log_info "+ $*"; "$@" > "$_lf" 2>&1 || log_warn "non-zero exit (see $_lf)"; }

section "nmap vulnerability scripts"
if command -v nmap >/dev/null 2>&1; then
    _base="-Pn"; is_ish && _base="-Pn -sT --unprivileged"
    # Strip scheme for nmap if a URL was given.
    _host="$(printf '%s' "$TARGET" | sed -E 's#^https?://##; s#/.*$##')"
    # shellcheck disable=SC2086
    run "$OUTDIR/nmap_vuln.txt" nmap $_base -sV --script "vuln" "$_host"
else
    log_warn "nmap not installed."
fi

section "nuclei templates"
if command -v nuclei >/dev/null 2>&1; then
    case "$TARGET" in
        http*://*) _u="$TARGET" ;;
        *) _u="http://$TARGET" ;;
    esac
    run "$OUTDIR/nuclei.txt" nuclei -u "$_u" -severity low,medium,high,critical -silent
else
    log_warn "nuclei not installed (install via 02_web.sh / go)."
fi

sh "$IKALI_ROOT/scripts/report_gen.sh" "$OUTDIR" || log_warn "Report generation failed."
log_ok "vuln_check finished for $TARGET."
