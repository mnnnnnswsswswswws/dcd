#!/bin/sh
# =============================================================================
# scripts/web_enum.sh — web application enumeration against a URL.
#
# Runs: whatweb fingerprint, wafw00f WAF detection, nikto scan, and a
# directory brute-force with whichever of gobuster/ffuf/dirb is present.
#
# Usage: sh web_enum.sh [-o OUTDIR] [-w WORDLIST] <url>
# =============================================================================
set -u

IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

OUTDIR=""
WORDLIST=""
URL=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) OUTDIR="${2:-}"; shift 2 ;;
        -w) WORDLIST="${2:-}"; shift 2 ;;
        -h|--help) printf 'Usage: sh web_enum.sh [-o OUTDIR] [-w WORDLIST] <url>\n'; exit 0 ;;
        -*) log_error "Unknown option: $1"; exit 1 ;;
        *) URL="$1"; shift ;;
    esac
done

[ -n "$URL" ] || { log_error "No URL specified."; exit 1; }
if ! valid_url "$URL"; then
    log_error "Invalid URL '$URL'. Must be http(s):// with safe characters."
    exit 1
fi

_ts="$(date '+%Y%m%d-%H%M%S')"
OUTDIR="${OUTDIR:-./reports/web_${_ts}}"
mkdir -p "$OUTDIR"
log_info "Results -> $OUTDIR"

# Default wordlist: prefer SecLists, then dirb common, then bundled custom list.
if [ -z "$WORDLIST" ]; then
    for w in \
        /usr/share/seclists/Discovery/Web-Content/common.txt \
        /usr/share/dirb/wordlists/common.txt \
        "$IKALI_ROOT/wordlists/custom/web_paths.txt"; do
        [ -f "$w" ] && { WORDLIST="$w"; break; }
    done
fi
log_info "Wordlist: ${WORDLIST:-<none>}"

run() { _lf="$1"; shift; log_info "+ $*"; "$@" > "$_lf" 2>&1 || log_warn "non-zero exit (see $_lf)"; }

section "Fingerprint (whatweb)"
command -v whatweb >/dev/null 2>&1 && run "$OUTDIR/whatweb.txt" whatweb -a 3 "$URL" || log_warn "whatweb not installed."

section "WAF detection (wafw00f)"
command -v wafw00f >/dev/null 2>&1 && run "$OUTDIR/wafw00f.txt" wafw00f "$URL" || log_warn "wafw00f not installed."

section "Nikto scan"
command -v nikto >/dev/null 2>&1 && run "$OUTDIR/nikto.txt" nikto -h "$URL" -maxtime 300 || log_warn "nikto not installed."

section "Directory brute-force"
if [ -n "$WORDLIST" ] && [ -f "$WORDLIST" ]; then
    if command -v gobuster >/dev/null 2>&1; then
        run "$OUTDIR/dirs.txt" gobuster dir -u "$URL" -w "$WORDLIST" -q -t 20
    elif command -v ffuf >/dev/null 2>&1; then
        run "$OUTDIR/dirs.txt" ffuf -u "${URL%/}/FUZZ" -w "$WORDLIST" -mc 200,204,301,302,307,401,403
    elif command -v dirb >/dev/null 2>&1; then
        run "$OUTDIR/dirs.txt" dirb "$URL" "$WORDLIST" -S
    else
        log_warn "No directory brute-forcer installed (gobuster/ffuf/dirb)."
    fi
else
    log_warn "No wordlist available; skipping directory brute-force."
fi

log_ok "web_enum finished for $URL. Results in $OUTDIR"
