#!/bin/sh
# install/11_mobile.sh — mobile application testing tools.
set -u
IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

section "Mobile testing tools"

# frida/objection are Python; usable on iSH for analyzing pulled APKs.
pip_install frida-tools objection

# adb / android-tools
pkg_install android-tools || log_warn "android-tools not packaged."

# apktool & jadx need a JVM. Heavy on iSH; install JDK only on UTM/native.
if is_ish; then
    log_warn "apktool/jadx need Java (JVM). Impractical on iSH; use UTM."
else
    pkg_install openjdk17-jre-headless || pkg_install openjdk11-jre-headless || log_warn "No JRE packaged."
    SRC="$HOME/.ikali/src"; mkdir -p "$SRC" "$HOME/.local/bin"
    if [ "$IKALI_DRY_RUN" != "1" ]; then
        # apktool wrapper + jar
        if [ ! -f "$HOME/.local/bin/apktool.jar" ]; then
            safe_download "https://raw.githubusercontent.com/iBotPeaches/Apktool/master/scripts/linux/apktool" "$HOME/.local/bin/apktool" \
                && chmod 755 "$HOME/.local/bin/apktool" || log_warn "apktool wrapper download failed."
            safe_download "https://github.com/iBotPeaches/Apktool/releases/download/v2.9.3/apktool_2.9.3.jar" "$HOME/.local/bin/apktool.jar" \
                || log_warn "apktool.jar download failed."
        fi
    fi
fi

verify_group frida
log_ok "Mobile tools complete."
