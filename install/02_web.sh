#!/bin/sh
# install/02_web.sh — web application testing tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Web application testing tools"

# Packaged tools
pkg_install nikto dirb httpie || log_warn "Some web apk packages missing."

# Python-based
pip_install sqlmap wfuzz wafw00f xsser

# Ruby-based
gem_install whatweb

# Go-based (fast HTTP fuzzers / scanners)
go_install github.com/OJ/gobuster/v3@latest
go_install github.com/ffuf/ffuf/v2@latest
go_install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
go_install github.com/hahwul/dalfox/v2@latest

# feroxbuster via apk where available
pkg_install feroxbuster || log_warn "feroxbuster not packaged; use gobuster/ffuf."

# git-based exploiters
WEBSRC="$HOME/.ikali/src"
mkdir -p "$WEBSRC"
if [ "$IKALI_DRY_RUN" != "1" ]; then
    [ -d "$WEBSRC/commix" ] || git clone --depth 1 https://github.com/commixproject/commix.git "$WEBSRC/commix" 2>>"$IKALI_LOG" || log_warn "commix clone failed."
    [ -d "$WEBSRC/joomscan" ] || git clone --depth 1 https://github.com/OWASP/joomscan.git "$WEBSRC/joomscan" 2>>"$IKALI_LOG" || log_warn "joomscan clone failed."
fi

# wpscan needs ruby dev headers; attempt but tolerate failure.
gem_install wpscan || log_warn "wpscan gem failed (needs ruby-dev/libcurl)."

verify_group nikto dirb sqlmap
log_ok "Web tools complete."
