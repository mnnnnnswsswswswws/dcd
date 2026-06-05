#!/bin/sh
# install/12_c2_payload.sh — tunneling, payloads & C2 helpers.
# Dual-use tooling for authorized red-team engagements and CTFs only.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Tunneling & payload tools"

# socat is the universal relay/pivot — works everywhere.
pkg_install socat || log_warn "socat not packaged."

# chisel & ligolo-ng — TCP-over-HTTP tunnels for pivoting (Go).
go_install github.com/jpillora/chisel@latest
go_install github.com/nicocha30/ligolo-ng/cmd/proxy@latest
go_install github.com/nicocha30/ligolo-ng/cmd/agent@latest

# msfvenom comes with metasploit; note dependency.
if ! tool_installed msfvenom; then
    log_warn "msfvenom is part of Metasploit (see 06_exploitation.sh / UTM)."
fi

# beef-xss — browser exploitation; Ruby + node, heavy. UTM only.
if is_ish; then
    log_warn "BeEF is impractical on iSH (Ruby/node stack). Use UTM."
fi

verify_group socat
log_ok "Tunneling & payload tools complete."
