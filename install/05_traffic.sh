#!/bin/sh
# install/05_traffic.sh — traffic capture & analysis tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Traffic analysis tools"

# Capture tools install fine; live capture needs raw sockets (limited on iSH,
# but reading saved .pcap files works everywhere).
pkg_install tcpdump ngrep tcpflow || log_warn "Some capture tools missing."

# Wireshark CLI (tshark). The GUI is not usable on iSH; CLI + pcap analysis is.
pkg_install tshark wireshark-common || pkg_install tshark || log_warn "tshark not packaged."

# mitmproxy is pure userland HTTPS proxy — great on iSH.
pip_install mitmproxy

# Raw-socket MITM/sniffing suites — skip on iSH.
if skip_on_ish "ettercap, bettercap, dsniff need raw sockets / interface access"; then
    log_info "Use mitmproxy / tshark on pcap files instead."
else
    pkg_install ettercap dsniff || log_warn "ettercap/dsniff not packaged."
    pkg_install bettercap || go_install github.com/bettercap/bettercap@latest || log_warn "bettercap unavailable."
fi

if is_ish; then
    log_warn "Live capture is limited under iSH; analyze pcap files with tshark/tcpdump -r."
fi

verify_group tcpdump tshark
log_ok "Traffic tools complete."
