#!/bin/sh
# install/04_dns_osint.sh — DNS reconnaissance & OSINT tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "DNS & OSINT tools"

pkg_install bind-tools whois || pkg_install dnsutils whois

pip_install dnsrecon fierce sublist3r theHarvester recon-ng spiderfoot

# Go-based subdomain tooling
go_install github.com/owasp-amass/amass/v4/...@master
go_install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest

# git-based
SRC="$HOME/.ikali/src"; mkdir -p "$SRC"
if [ "$IKALI_DRY_RUN" != "1" ]; then
    [ -d "$SRC/sherlock" ] || git clone --depth 1 https://github.com/sherlock-project/sherlock.git "$SRC/sherlock" 2>>"$IKALI_LOG" || log_warn "sherlock clone failed."
    [ -d "$SRC/dnsenum" ] || git clone --depth 1 https://github.com/fwaeytens/dnsenum.git "$SRC/dnsenum" 2>>"$IKALI_LOG" || log_warn "dnsenum clone failed."
    [ -d "$SRC/metagoofil" ] || git clone --depth 1 https://github.com/laramies/metagoofil.git "$SRC/metagoofil" 2>>"$IKALI_LOG" || log_warn "metagoofil clone failed."
fi

verify_group dig whois
log_ok "DNS & OSINT tools complete."
