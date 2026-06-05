#!/bin/sh
# install/14_utils.sh — utilities, anonymity & quality-of-life tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Utilities & anonymity tools"

pkg_install proxychains-ng tor screen openssh-client rsync nano htop nmap-ncat \
    || pkg_install proxychains-ng tor screen openssh rsync nano htop

# Whiptail/dialog power the TUI menu — install at least one.
pkg_install newt || pkg_install dialog || log_warn "Neither whiptail nor dialog packaged; menu uses plain fallback."

# Drop a ready-to-use proxychains config pointing at local Tor, if user has none.
if [ "$IKALI_DRY_RUN" != "1" ] && [ -f "$IKALI_ROOT/configs/proxychains.conf" ]; then
    if [ ! -f "$HOME/.proxychains/proxychains.conf" ]; then
        mkdir -p "$HOME/.proxychains"
        cp "$IKALI_ROOT/configs/proxychains.conf" "$HOME/.proxychains/proxychains.conf" 2>/dev/null \
            && log_ok "Installed proxychains config to ~/.proxychains/"
    fi
fi

verify_group proxychains tor screen
log_ok "Utilities complete."
