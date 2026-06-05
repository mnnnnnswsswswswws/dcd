#!/bin/sh
# install/01_network.sh — network scanning & discovery tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Network scanning tools"

# Reliable apk/apt packages that work everywhere (nmap uses -sT on iSH).
pkg_install nmap nmap-scripts netcat-openbsd socat mtr fping nbtscan net-snmp-tools tcptraceroute p0f \
    || pkg_install nmap ncat socat mtr fping nbtscan

# Raw-socket tools: skip on iSH, install elsewhere.
if skip_on_ish "masscan, hping3, arp-scan, zmap require raw sockets"; then
    log_info "On iSH use 'nmap -sT --unprivileged' for TCP connect scans."
else
    pkg_install masscan hping3 arp-scan || log_warn "Some raw-socket tools unavailable in this repo."
fi

# onesixtyone (SNMP) — small source build fallback if not packaged.
if ! tool_installed onesixtyone; then
    pkg_install onesixtyone || log_warn "onesixtyone not packaged; install manually if needed."
fi

verify_group nmap nc socat mtr fping nbtscan
log_ok "Network tools complete."
