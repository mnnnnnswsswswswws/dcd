#!/bin/sh
# =============================================================================
# iKali — menu/menu.sh  (interactive launcher)
#
# Reads tool metadata from lib/tools.db and presents a category-driven menu.
# Uses whiptail or dialog when available; otherwise falls back to a plain
# numbered prompt so it always works on a fresh iSH.
# =============================================================================
set -u

IKALI_SELF="$0"; export IKALI_SELF
IKALI_ROOT="${IKALI_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"; export IKALI_ROOT
# shellcheck source=../lib/common.sh
. "$IKALI_ROOT/lib/common.sh"
detect_env

TOOLS_DB="$IKALI_ROOT/lib/tools.db"
[ -f "$TOOLS_DB" ] || { log_error "Tool database not found: $TOOLS_DB"; exit 1; }

# Pick a TUI backend once.
TUI=""
if command -v whiptail >/dev/null 2>&1; then TUI="whiptail"
elif command -v dialog >/dev/null 2>&1; then TUI="dialog"
fi

# Categories in display order: key|Label
CATEGORIES='network:Scanning & Enumeration
web:Web Application Testing
exploit:Exploitation
password:Password Attacks
osint:OSINT & Recon
traffic:Traffic Analysis
wireless:Wireless (offline)
reverse:Reverse Engineering
forensics:Forensics
ssl:SSL/TLS & Crypto
mobile:Mobile Testing
c2:Tunneling & Payloads
reporting:Reporting
utils:Utilities'

# --- helpers ---------------------------------------------------------------

# Emit "binary|name|description" for every tool in a category.
tools_in_category() {
    _cat="$1"
    awk -F'|' -v c="$_cat" '
        /^#/ {next} NF<6 {next}
        $2==c { print $4 "|" $1 "|" $6 }
    ' "$TOOLS_DB"
}

status_label() {
    if tool_installed "$1"; then printf '[on] '; else printf '[--] '; fi
}

pause() { printf '\nPress Enter to continue...'; read -r _; }

# Launch a tool: show its help/usage, then offer to run with arguments.
launch_tool() {
    _bin="$1"; _name="$2"; _desc="$3"
    record_recent "$_name"
    clear 2>/dev/null || true
    printf '%b== %s ==%b\n%s\n\n' "$C_BOLD" "$_name" "$C_RESET" "$_desc"

    if ! tool_installed "$_bin"; then
        log_warn "$_name is not installed (binary: $_bin)."
        printf 'Install hint: re-run setup.sh and choose the matching module.\n'
        pause; return 0
    fi

    printf 'Binary: %s\n' "$(command -v "$_bin")"
    printf 'Enter arguments for %s (blank = show help, q = back): ' "$_bin"
    read -r _args
    case "$_args" in
        q|Q) return 0 ;;
        '') "$_bin" --help 2>&1 | head -n 40 || "$_bin" -h 2>&1 | head -n 40 || true ;;
        *)
            # Arguments are passed via the shell's own word-splitting only after
            # the user explicitly typed them; we never eval external data.
            # shellcheck disable=SC2086
            "$_bin" $_args ;;
    esac
    pause
}

# --- plain (no whiptail/dialog) fallback -----------------------------------

plain_menu_category() {
    _cat="$1"; _label="$2"
    while :; do
        clear 2>/dev/null || true
        printf '%b== %s ==%b   (env: %s)\n\n' "$C_BOLD" "$_label" "$C_RESET" "$IKALI_ENV"
        _i=0
        # Build an index file of binary|name|desc to map numbers to tools.
        _tmp="$IKALI_HOME/.menu_idx"; _ikali_ensure_home; : > "$_tmp"
        tools_in_category "$_cat" | while IFS='|' read -r _b _n _d; do
            printf '%s|%s|%s\n' "$_b" "$_n" "$_d" >> "$_tmp"
        done
        while IFS='|' read -r _b _n _d; do
            _i=$(( _i + 1 ))
            printf '  %2d) %s%-16s %s\n' "$_i" "$(status_label "$_b")" "$_n" "$_d"
        done < "$_tmp"
        printf '\n   b) Back\n'
        printf '\nSelect tool number: '
        read -r _sel
        case "$_sel" in
            b|B) return 0 ;;
            *[!0-9]*|'') continue ;;
        esac
        _line="$(sed -n "${_sel}p" "$_tmp" 2>/dev/null)"
        [ -n "$_line" ] || continue
        _b="$(printf '%s' "$_line" | cut -d'|' -f1)"
        _n="$(printf '%s' "$_line" | cut -d'|' -f2)"
        _d="$(printf '%s' "$_line" | cut -d'|' -f3)"
        launch_tool "$_b" "$_n" "$_d"
    done
}

plain_main() {
    while :; do
        clear 2>/dev/null || true
        printf '%b iKali %b- pentest toolkit (%s)\n\n' "$C_BOLD" "$C_RESET" "$IKALI_ENV"
        _i=0
        printf '%s\n' "$CATEGORIES" | while IFS=':' read -r _k _l; do
            _i=$(( _i + 1 ))
            printf '  %2d) %s\n' "$_i" "$_l"
        done
        printf '\n   r) Recently used\n   q) Quit\n\nSelect: '
        read -r _sel
        case "$_sel" in
            q|Q) clear 2>/dev/null || true; exit 0 ;;
            r|R) show_recent; continue ;;
            *[!0-9]*|'') continue ;;
        esac
        _row="$(printf '%s' "$CATEGORIES" | sed -n "${_sel}p")"
        [ -n "$_row" ] || continue
        _k="$(printf '%s' "$_row" | cut -d: -f1)"
        _l="$(printf '%s' "$_row" | cut -d: -f2-)"
        plain_menu_category "$_k" "$_l"
    done
}

show_recent() {
    clear 2>/dev/null || true
    printf '%b== Recently used ==%b\n\n' "$C_BOLD" "$C_RESET"
    if [ -f "$IKALI_RECENT" ]; then
        tail -n 15 "$IKALI_RECENT"
    else
        printf '(none yet)\n'
    fi
    pause
}

# --- whiptail/dialog backend ----------------------------------------------

tui_box() {
    # tui_box menu "title" "text" tag item tag item ...
    _kind="$1"; _title="$2"; _text="$3"; shift 3
    "$TUI" --title "$_title" --menu "$_text" 20 74 12 "$@" 3>&1 1>&2 2>&3
}

tui_category() {
    _cat="$1"; _label="$2"
    while :; do
        # Build arg list: tag=number, item=status+name+desc
        set --
        _i=0
        _map="$IKALI_HOME/.menu_idx"; _ikali_ensure_home; : > "$_map"
        tools_in_category "$_cat" | while IFS='|' read -r _b _n _d; do
            printf '%s|%s|%s\n' "$_b" "$_n" "$_d" >> "$_map"
        done
        while IFS='|' read -r _b _n _d; do
            _i=$(( _i + 1 ))
            _st="$(tool_installed "$_b" && echo '*' || echo ' ')"
            set -- "$@" "$_i" "[$_st] $_n - $_d"
        done < "$_map"
        set -- "$@" "b" "<< Back"
        _choice="$(tui_box menu "$_label" "* = installed" "$@")" || return 0
        [ "$_choice" = "b" ] && return 0
        _line="$(sed -n "${_choice}p" "$_map" 2>/dev/null)"
        [ -n "$_line" ] || continue
        launch_tool "$(printf '%s' "$_line" | cut -d'|' -f1)" \
                    "$(printf '%s' "$_line" | cut -d'|' -f2)" \
                    "$(printf '%s' "$_line" | cut -d'|' -f3)"
    done
}

tui_main() {
    while :; do
        set --
        _i=0
        printf '%s\n' "$CATEGORIES" | { while IFS=':' read -r _k _l; do
            _i=$(( _i + 1 )); printf '%s\t%s\n' "$_i" "$_l"
        done; } > "$IKALI_HOME/.cat_idx"
        while IFS="$(printf '\t')" read -r _num _lbl; do
            set -- "$@" "$_num" "$_lbl"
        done < "$IKALI_HOME/.cat_idx"
        set -- "$@" "r" "Recently used" "q" "Quit"
        _choice="$(tui_box menu "iKali ($IKALI_ENV)" "Select a category:" "$@")" || { clear; exit 0; }
        case "$_choice" in
            q) clear 2>/dev/null || true; exit 0 ;;
            r) show_recent ;;
            *)
                _row="$(printf '%s' "$CATEGORIES" | sed -n "${_choice}p")"
                [ -n "$_row" ] || continue
                tui_category "$(printf '%s' "$_row" | cut -d: -f1)" \
                             "$(printf '%s' "$_row" | cut -d: -f2-)"
                ;;
        esac
    done
}

# --- entry -----------------------------------------------------------------
_ikali_ensure_home
if [ -n "$TUI" ]; then
    tui_main
else
    log_warn "whiptail/dialog not found — using plain menu. (apk add newt for a nicer UI)"
    plain_main
fi
