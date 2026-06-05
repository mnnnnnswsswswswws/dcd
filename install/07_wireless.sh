#!/bin/sh
# install/07_wireless.sh — wireless auditing tools.
# NOTE: iOS does not expose the WiFi adapter in monitor mode to userland Linux
# (iSH or UTM). These tools install for offline analysis / education, but live
# attacks require external hardware on a real Linux host.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Wireless auditing tools"

log_warn "Wireless attacks need monitor-mode hardware not available on iPhone."
log_info "Installing for offline capture analysis (aircrack-ng can crack .cap files)."

# aircrack-ng can crack captured handshakes offline even without an adapter.
pkg_install aircrack-ng || log_warn "aircrack-ng not packaged."

# hostapd/dnsmasq for lab rogue-AP study (real host only).
if ! is_ish; then
    pkg_install hostapd dnsmasq kismet || log_warn "Some wireless apk packages missing."
fi

# wifite (git) — orchestrator; needs the above + hardware.
SRC="$HOME/.ikali/src"; mkdir -p "$SRC"
if [ "$IKALI_DRY_RUN" != "1" ] && ! is_ish; then
    [ -d "$SRC/wifite2" ] || git clone --depth 1 https://github.com/kimocoder/wifite2.git "$SRC/wifite2" 2>>"$IKALI_LOG" || log_warn "wifite clone failed."
fi

verify_group aircrack-ng
log_ok "Wireless tools complete (offline analysis focus)."
