#!/bin/sh
# =============================================================================
# iKali — setup.sh  (master installer)
#
# Installs a Linux penetration-testing toolkit on iPhone (iSH / UTM) or any
# Alpine/Debian host. Detects the environment, lets you pick an install
# profile, then runs the modular installers in install/.
#
# Usage:
#   sh setup.sh                 interactive
#   sh setup.sh --full          install everything, no prompt
#   sh setup.sh --minimal       base + network + web + utils
#   sh setup.sh --standard      minimal + password/dns/traffic/ssl/forensics
#   sh setup.sh --dry-run       show what would happen, change nothing
#   sh setup.sh --help
#
# POSIX sh compatible (runs under busybox ash on a fresh iSH).
# =============================================================================
set -eu

IKALI_SELF="$0"
IKALI_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export IKALI_SELF IKALI_ROOT

# shellcheck source=lib/common.sh
. "$IKALI_ROOT/lib/common.sh"

# Ordered list of installer modules.
INSTALL_DIR="$IKALI_ROOT/install"
ALL_MODULES="00_base 01_network 02_web 03_passwords 04_dns_osint 05_traffic 06_exploitation 07_wireless 08_reverse 09_forensics 10_ssl_crypto 11_mobile 12_c2_payload 13_reporting 14_utils"

# Profiles map to subsets of the modules above.
MINIMAL_MODULES="00_base 01_network 02_web 14_utils"
STANDARD_MODULES="00_base 01_network 02_web 03_passwords 04_dns_osint 05_traffic 09_forensics 10_ssl_crypto 14_utils"

usage() {
    cat <<EOF
iKali installer

Usage: sh setup.sh [PROFILE] [OPTIONS]

Profiles:
  --minimal     Base + network + web + utils
  --standard    Minimal + passwords, DNS/OSINT, traffic, forensics, SSL
  --full        All 15 modules (130+ tools)
  (no profile)  Interactive menu

Options:
  --dry-run     Print actions without installing anything
  --yes, -y     Skip the confirmation prompt
  --help, -h    Show this help

Environment is auto-detected (iSH / UTM / native). Tools that need raw sockets
or kernel features are skipped with a warning on iSH.
EOF
}

PROFILE=""
ASSUME_YES=0

for arg in "$@"; do
    case "$arg" in
        --minimal)  PROFILE="minimal" ;;
        --standard) PROFILE="standard" ;;
        --full)     PROFILE="full" ;;
        --dry-run)  IKALI_DRY_RUN=1; export IKALI_DRY_RUN ;;
        --yes|-y)   ASSUME_YES=1 ;;
        --help|-h)  usage; exit 0 ;;
        *) log_warn "Unknown argument: $arg"; usage; exit 1 ;;
    esac
done

banner() {
    printf '%b' "$C_BOLD"
    cat <<'EOF'
   _ _  __     _ _
  (_) |/ /__ _| (_)
  | | ' </ _` | | |
  |_|_|\_\__,_|_|_|   Linux pentest toolkit for iPhone
EOF
    printf '%b\n' "$C_RESET"
}

choose_profile_interactive() {
    cat <<EOF

Select an install profile:
  1) Minimal   — base + network + web + utils         (~200 MB)
  2) Standard  — + passwords, DNS/OSINT, traffic, SSL  (~1.5 GB)
  3) Full      — all 15 modules, 130+ tools            (~4 GB)
  4) Custom    — pick categories one by one
  q) Quit

EOF
    printf 'Choice [1-4/q]: '
    read -r _c
    case "$_c" in
        1) PROFILE="minimal" ;;
        2) PROFILE="standard" ;;
        3) PROFILE="full" ;;
        4) PROFILE="custom" ;;
        q|Q) log_info "Aborted by user."; exit 0 ;;
        *) log_warn "Invalid choice."; choose_profile_interactive ;;
    esac
}

# Build the module list for a custom selection.
choose_custom_modules() {
    SELECTED=""
    for m in $ALL_MODULES; do
        printf 'Install %s? [y/N]: ' "$m"
        read -r _a
        case "$_a" in
            y|Y) SELECTED="$SELECTED $m" ;;
            *) : ;;
        esac
    done
    # Always include base if anything else is selected.
    case "$SELECTED" in
        *00_base*) : ;;
        *) [ -n "$SELECTED" ] && SELECTED="00_base $SELECTED" ;;
    esac
    printf '%s' "$SELECTED"
}

modules_for_profile() {
    case "$1" in
        minimal)  printf '%s' "$MINIMAL_MODULES" ;;
        standard) printf '%s' "$STANDARD_MODULES" ;;
        full)     printf '%s' "$ALL_MODULES" ;;
    esac
}

run_modules() {
    _mods="$1"
    _total=0
    for _ in $_mods; do _total=$(( _total + 1 )); done
    _n=0
    _ok=0
    _fail=0

    for m in $_mods; do
        _n=$(( _n + 1 ))
        _script="$INSTALL_DIR/${m}.sh"
        if [ ! -f "$_script" ]; then
            log_warn "[$_n/$_total] missing module: $_script"
            _fail=$(( _fail + 1 ))
            continue
        fi
        section "[$_n/$_total] ${m}"
        # Run each module in the current shell environment so detect_env results
        # and exported helpers are reused, but tolerate non-zero exit.
        if sh "$_script"; then
            _ok=$(( _ok + 1 ))
        else
            log_warn "Module ${m} reported issues (see log)."
            _fail=$(( _fail + 1 ))
        fi
    done

    section "Installation summary"
    log_info "Modules run OK : $_ok"
    [ "$_fail" -gt 0 ] && log_warn "Modules with issues: $_fail" || log_ok "No module errors."
    log_info "Full log: $IKALI_LOG"
}

post_setup() {
    [ "$IKALI_DRY_RUN" = "1" ] && return 0
    # Install a convenience launcher alias if not already present.
    _profile_rc="$HOME/.profile"
    _alias_line="alias ikali='sh \"$IKALI_ROOT/menu/menu.sh\"'"
    if [ -w "$_profile_rc" ] || [ ! -e "$_profile_rc" ]; then
        if ! grep -qF "alias ikali=" "$_profile_rc" 2>/dev/null; then
            printf '\n# iKali launcher\n%s\n' "$_alias_line" >> "$_profile_rc"
            log_ok "Added 'ikali' alias to $_profile_rc (restart shell to use)."
        fi
    fi
}

# --------------------------------------------------------------------------
main() {
    banner
    env_summary

    require_authorization || exit 1

    [ -n "$PROFILE" ] || choose_profile_interactive

    if [ "$PROFILE" = "custom" ]; then
        MODULES="$(choose_custom_modules)"
        [ -n "$MODULES" ] || { log_warn "Nothing selected."; exit 0; }
    else
        MODULES="$(modules_for_profile "$PROFILE")"
    fi

    log_info "Profile : $PROFILE"
    log_info "Modules :$( for m in $MODULES; do printf ' %s' "$m"; done )"
    [ "$IKALI_DRY_RUN" = "1" ] && log_warn "DRY-RUN: no changes will be made."

    if [ "$ASSUME_YES" != "1" ] && [ "$IKALI_DRY_RUN" != "1" ]; then
        printf 'Proceed with installation? [y/N]: '
        read -r _go
        case "$_go" in y|Y) : ;; *) log_info "Aborted."; exit 0 ;; esac
    fi

    run_modules "$MODULES"
    post_setup

    section "Done"
    log_ok "iKali setup finished. Launch the menu with:  sh menu/menu.sh"
    log_info "Or, after restarting your shell, just run:  ikali"
}

main
