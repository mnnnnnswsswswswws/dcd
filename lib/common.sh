# shellcheck shell=sh
# =============================================================================
# iKali — lib/common.sh
# Shared library: logging, environment detection, safe downloads, package
# installation. Sourced by every other script. POSIX sh compatible (busybox
# ash on iSH ships before bash is installed).
#
# This file is meant to be SOURCED, not executed. It defines functions and
# exports environment variables; it does not run actions on its own.
# =============================================================================

# ---------------------------------------------------------------------------
# Paths and globals
# ---------------------------------------------------------------------------
IKALI_HOME="${IKALI_HOME:-$HOME/.ikali}"
IKALI_LOG="${IKALI_LOG:-$IKALI_HOME/install.log}"
IKALI_RECENT="${IKALI_RECENT:-$IKALI_HOME/recent.log}"
IKALI_AUTH_FLAG="${IKALI_AUTH_FLAG:-$IKALI_HOME/.authorized}"

# Resolve the repository root (directory that contains this lib/).
# Works whether sourced via relative or absolute path.
_ikali_self="${IKALI_SELF:-$0}"
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$_ikali_self")/.." 2>/dev/null && pwd)}"
[ -d "$IKALI_ROOT/lib" ] || IKALI_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd)"

# Honor a global dry-run switch. When set to 1 no package action is performed.
IKALI_DRY_RUN="${IKALI_DRY_RUN:-0}"

# ---------------------------------------------------------------------------
# Colors — disabled automatically when stdout is not a terminal or NO_COLOR set.
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RESET='\033[0m'; C_BLUE='\033[0;34m'; C_GREEN='\033[0;32m'
    C_YELLOW='\033[0;33m'; C_RED='\033[0;31m'; C_BOLD='\033[1m'
else
    C_RESET=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BOLD=''
fi

# ---------------------------------------------------------------------------
# Logging — writes to both the terminal and the log file with a timestamp.
# Never log secrets; callers must keep credentials out of arguments.
# ---------------------------------------------------------------------------
_ikali_ensure_home() {
    [ -d "$IKALI_HOME" ] || mkdir -p "$IKALI_HOME" 2>/dev/null || return 0
    chmod 700 "$IKALI_HOME" 2>/dev/null || true
}

_log_raw() {
    # $1 = plain line for the log file (no color codes)
    _ikali_ensure_home
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$IKALI_LOG" 2>/dev/null || true
}

log_info()  { printf '%b[INFO]%b %s\n' "$C_BLUE"   "$C_RESET" "$*"; _log_raw "[INFO] $*"; }
log_ok()    { printf '%b[ OK ]%b %s\n' "$C_GREEN"  "$C_RESET" "$*"; _log_raw "[ OK ] $*"; }
log_warn()  { printf '%b[WARN]%b %s\n' "$C_YELLOW" "$C_RESET" "$*"; _log_raw "[WARN] $*"; }
log_error() { printf '%b[FAIL]%b %s\n' "$C_RED"    "$C_RESET" "$*" >&2; _log_raw "[FAIL] $*"; }

section() {
    printf '\n%b== %s ==%b\n' "$C_BOLD" "$*" "$C_RESET"
    _log_raw "== $* =="
}

# ---------------------------------------------------------------------------
# Environment detection
# Sets and exports:
#   IKALI_ENV          ish | utm | native
#   IKALI_ARCH         output of uname -m
#   IKALI_DISTRO       alpine | debian | unknown
#   IKALI_PKG          apk | apt | none
#   IKALI_RAW_SOCKETS  1 if raw sockets are likely available, else 0
#   IKALI_MEM_MB       detected RAM in MB (0 if unknown)
#   IKALI_STORAGE_GB   available storage in GB on $HOME (0 if unknown)
# ---------------------------------------------------------------------------
detect_env() {
    IKALI_ARCH="$(uname -m 2>/dev/null || echo unknown)"

    # Distro / package manager
    if [ -f /etc/alpine-release ] || command -v apk >/dev/null 2>&1; then
        IKALI_DISTRO="alpine"; IKALI_PKG="apk"
    elif [ -f /etc/debian_version ] || command -v apt-get >/dev/null 2>&1; then
        IKALI_DISTRO="debian"; IKALI_PKG="apt"
    else
        IKALI_DISTRO="unknown"; IKALI_PKG="none"
    fi

    # iSH leaves characteristic markers. It emulates x86 (i686) on ARM hardware.
    if [ -e /proc/ish ] || [ -f /etc/ish-release ] \
        || (uname -a 2>/dev/null | grep -qi 'ish'); then
        IKALI_ENV="ish"
    elif [ "$IKALI_ARCH" = "i686" ] && [ "$IKALI_DISTRO" = "alpine" ] \
        && ! [ -d /sys/class/dmi ]; then
        # iSH commonly reports i686 with no DMI tables.
        IKALI_ENV="ish"
    elif grep -qi 'qemu\|utm' /sys/class/dmi/id/product_name 2>/dev/null \
        || [ "$IKALI_ARCH" = "aarch64" ]; then
        IKALI_ENV="utm"
    else
        IKALI_ENV="native"
    fi

    # Raw sockets: unavailable on iSH, assumed available elsewhere.
    if [ "$IKALI_ENV" = "ish" ]; then
        IKALI_RAW_SOCKETS=0
    else
        IKALI_RAW_SOCKETS=1
    fi

    # Memory (MB)
    IKALI_MEM_MB=0
    if [ -r /proc/meminfo ]; then
        _kb="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null)"
        [ -n "$_kb" ] && IKALI_MEM_MB="$(( _kb / 1024 ))"
    fi

    # Free storage on HOME (GB)
    IKALI_STORAGE_GB=0
    _avail_kb="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {print $4; exit}')"
    [ -n "$_avail_kb" ] && IKALI_STORAGE_GB="$(( _avail_kb / 1024 / 1024 ))"

    export IKALI_ENV IKALI_ARCH IKALI_DISTRO IKALI_PKG \
           IKALI_RAW_SOCKETS IKALI_MEM_MB IKALI_STORAGE_GB
}

env_summary() {
    detect_env
    log_info "Environment : $IKALI_ENV ($IKALI_ARCH, $IKALI_DISTRO/$IKALI_PKG)"
    log_info "Raw sockets : $( [ "$IKALI_RAW_SOCKETS" = 1 ] && echo yes || echo no )"
    log_info "Memory      : ${IKALI_MEM_MB} MB"
    log_info "Free storage: ${IKALI_STORAGE_GB} GB (on $HOME)"
}

# Returns 0 (true) when running under iSH. Use to gate raw-socket tools.
is_ish() { [ "${IKALI_ENV:-}" = "ish" ]; }

# skip_on_ish "<reason>" — logs a warning and returns 0 when on iSH so callers
# can `if skip_on_ish "..."; then continue/return; fi` to bypass a tool.
skip_on_ish() {
    if is_ish; then
        log_warn "Skipping on iSH: $1"
        return 0
    fi
    return 1
}

# ---------------------------------------------------------------------------
# Privilege helper — picks sudo/doas when not already root.
# ---------------------------------------------------------------------------
_ikali_sudo() {
    if [ "$(id -u 2>/dev/null || echo 0)" = "0" ]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    elif command -v doas >/dev/null 2>&1; then
        doas "$@"
    else
        # No privilege escalation available; try directly and let it fail loudly.
        "$@"
    fi
}

# ---------------------------------------------------------------------------
# retry <attempts> <base_delay_sec> <command...>
# Exponential backoff: base, 2*base, 4*base, ...
# ---------------------------------------------------------------------------
retry() {
    _attempts="$1"; _delay="$2"; shift 2
    _i=1
    while :; do
        if "$@"; then
            return 0
        fi
        if [ "$_i" -ge "$_attempts" ]; then
            log_error "Command failed after $_attempts attempts: $*"
            return 1
        fi
        log_warn "Attempt $_i failed, retrying in ${_delay}s..."
        sleep "$_delay"
        _i="$(( _i + 1 ))"
        _delay="$(( _delay * 2 ))"
    done
}

# ---------------------------------------------------------------------------
# Package installation wrappers.
# ---------------------------------------------------------------------------
# pkg_install <pkg...> — installs via the detected package manager. Idempotent
# enough for apk/apt (they no-op already-installed packages). Tolerant: returns
# non-zero on failure but never aborts the caller's shell.
pkg_install() {
    [ "$#" -gt 0 ] || return 0
    [ -n "${IKALI_PKG:-}" ] || detect_env

    if [ "$IKALI_DRY_RUN" = "1" ]; then
        log_info "[dry-run] would install ($IKALI_PKG): $*"
        return 0
    fi

    case "$IKALI_PKG" in
        apk)
            retry 3 2 _ikali_sudo apk add --no-cache "$@"
            ;;
        apt)
            retry 3 2 _ikali_sudo apt-get install -y --no-install-recommends "$@"
            ;;
        *)
            log_error "No supported package manager found; cannot install: $*"
            return 1
            ;;
    esac
}

# pip_install <pkg...> — user-level pip, never root. Tolerant of failures.
pip_install() {
    [ "$#" -gt 0 ] || return 0
    if [ "$IKALI_DRY_RUN" = "1" ]; then
        log_info "[dry-run] would pip install: $*"
        return 0
    fi
    if ! command -v pip3 >/dev/null 2>&1; then
        log_warn "pip3 not present; skipping Python packages: $*"
        return 1
    fi
    # --break-system-packages keeps newer pip happy on PEP-668 distros; --user
    # keeps everything in the home directory (least privilege).
    retry 3 2 pip3 install --user --no-input "$@" 2>>"$IKALI_LOG" \
        || retry 2 2 pip3 install --user --no-input --break-system-packages "$@" 2>>"$IKALI_LOG"
}

# go_install <module@version> — installs a Go tool into GOBIN (user home).
go_install() {
    [ -n "${1:-}" ] || return 0
    if [ "$IKALI_DRY_RUN" = "1" ]; then
        log_info "[dry-run] would go install: $1"
        return 0
    fi
    if ! command -v go >/dev/null 2>&1; then
        log_warn "go toolchain not present; skipping: $1"
        return 1
    fi
    GOBIN="${GOBIN:-$HOME/go/bin}" go install "$1" 2>>"$IKALI_LOG"
}

# gem_install <gem...> — Ruby gems, user install.
gem_install() {
    [ "$#" -gt 0 ] || return 0
    if [ "$IKALI_DRY_RUN" = "1" ]; then
        log_info "[dry-run] would gem install: $*"
        return 0
    fi
    if ! command -v gem >/dev/null 2>&1; then
        log_warn "gem not present; skipping: $*"
        return 1
    fi
    retry 3 2 gem install --user-install "$@" 2>>"$IKALI_LOG"
}

# ---------------------------------------------------------------------------
# tool_installed <binary> — true if the command exists in PATH.
# ---------------------------------------------------------------------------
tool_installed() { command -v "$1" >/dev/null 2>&1; }

# ensure_tool <binary> <install-function...> — install only if missing.
ensure_tool() {
    _bin="$1"; shift
    if tool_installed "$_bin"; then
        log_ok "$_bin already present"
        return 0
    fi
    "$@"
}

# verify_group <binary...> — reports which expected binaries are present.
# Returns the count of missing binaries (0 == all good).
verify_group() {
    _missing=0
    for _b in "$@"; do
        if tool_installed "$_b"; then
            log_ok "verified: $_b"
        else
            log_warn "missing: $_b"
            _missing="$(( _missing + 1 ))"
        fi
    done
    return "$_missing"
}

# ---------------------------------------------------------------------------
# safe_download <url> <dest> [sha256]
# HTTPS only. Verifies the certificate, and the SHA-256 checksum when supplied.
# A supplied-but-mismatched checksum removes the file and fails.
# ---------------------------------------------------------------------------
safe_download() {
    _url="$1"; _dest="$2"; _sum="${3:-}"

    case "$_url" in
        https://*) : ;;
        *) log_error "Refusing non-HTTPS download: $_url"; return 1 ;;
    esac

    if [ "$IKALI_DRY_RUN" = "1" ]; then
        log_info "[dry-run] would download $_url -> $_dest"
        return 0
    fi

    log_info "Downloading $_url"
    if command -v curl >/dev/null 2>&1; then
        retry 3 2 curl -fsSL --proto '=https' --tlsv1.2 -o "$_dest" "$_url" || return 1
    elif command -v wget >/dev/null 2>&1; then
        retry 3 2 wget -q --https-only -O "$_dest" "$_url" || return 1
    else
        log_error "Neither curl nor wget available for download"
        return 1
    fi

    if [ -n "$_sum" ]; then
        _actual="$(_ikali_sha256 "$_dest")"
        if [ "$_actual" != "$_sum" ]; then
            log_error "Checksum mismatch for $_dest (expected $_sum, got $_actual)"
            rm -f "$_dest"
            return 1
        fi
        log_ok "Checksum verified: $_dest"
    fi
    return 0
}

_ikali_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        echo "NO_SHA256_TOOL"
    fi
}

# ---------------------------------------------------------------------------
# Input validation — used by scripts/ to prevent command injection.
# Each returns 0 when the input matches a strict whitelist pattern.
# ---------------------------------------------------------------------------
valid_host() {
    # Hostname or IPv4. Letters, digits, dots, hyphens only.
    printf '%s' "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$'
}

valid_cidr() {
    # IPv4 or IPv4/CIDR (loose octet check; refined by tools downstream).
    printf '%s' "$1" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$'
}

valid_url() {
    # http(s) URL with a safe character set (no shell metacharacters).
    printf '%s' "$1" | grep -Eq '^https?://[A-Za-z0-9._~:/?#@!$&'"'"'()*+,;=%-]+$'
}

# require_valid <validator> <value> <label> — abort the caller on bad input.
require_valid() {
    _validator="$1"; _value="$2"; _label="$3"
    if ! "$_validator" "$_value"; then
        log_error "Invalid $_label: refusing to proceed with untrusted input."
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Authorization gate — shown once; records consent under $IKALI_HOME.
# ---------------------------------------------------------------------------
require_authorization() {
    [ -f "$IKALI_AUTH_FLAG" ] && return 0
    _ikali_ensure_home
    cat <<'EOF'

  ┌────────────────────────────────────────────────────────────────┐
  │  iKali — Authorized Use Only                                    │
  │                                                                 │
  │  These tools are for security testing you are AUTHORIZED to     │
  │  perform: your own systems, lab/CTF targets, or engagements     │
  │  with written permission. Unauthorized access or scanning is    │
  │  illegal in most jurisdictions. You are solely responsible.     │
  │  See docs/LEGAL.md.                                             │
  └────────────────────────────────────────────────────────────────┘

EOF
    printf 'Type "I AGREE" to confirm authorized use: '
    read -r _ans
    if [ "$_ans" = "I AGREE" ]; then
        : > "$IKALI_AUTH_FLAG"
        chmod 600 "$IKALI_AUTH_FLAG" 2>/dev/null || true
        log_ok "Authorization recorded."
        return 0
    fi
    log_error "Authorization not granted. Exiting."
    return 1
}

# record_recent <tool> — append to the recent-tools log (used by the menu).
record_recent() {
    _ikali_ensure_home
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$IKALI_RECENT" 2>/dev/null || true
}
