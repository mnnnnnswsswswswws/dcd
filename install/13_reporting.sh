#!/bin/sh
# install/13_reporting.sh — reporting & output formatting tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Reporting tools"

# aha converts ANSI terminal output to HTML — great for portable reports on iSH.
pkg_install aha || log_warn "aha not packaged."

# wkhtmltopdf for HTML->PDF (needs Qt; partial on iSH).
if is_ish; then
    log_warn "wkhtmltopdf/cutycapt need a graphics stack; reports stay as HTML on iSH."
else
    pkg_install wkhtmltopdf cutycapt || log_warn "wkhtmltopdf/cutycapt not packaged."
fi

# pipal — password list analysis & reporting (Ruby/git).
SRC="$HOME/.ikali/src"; mkdir -p "$SRC"
if [ "$IKALI_DRY_RUN" != "1" ]; then
    [ -d "$SRC/pipal" ] || git clone --depth 1 https://github.com/digininja/pipal.git "$SRC/pipal" 2>>"$IKALI_LOG" || log_warn "pipal clone failed."
fi

log_ok "Reporting tools complete. Use scripts/report_gen.sh to build HTML reports."
