#!/bin/sh
# Українізатор DSM — ОДНОРАЗОВИЙ root-bootstrap root-демона.
# Чому окремо й під root: unsigned community-пакет ставиться/керується як package-
# user (uid ~144435), root не дають (інакше error 319). nginx-аліас /ua-l10n-api/
# DSM реєструє САМ (web-config resource-worker), тож тут лишилось підняти демон.
#   ua-l10n-bootstrap.sh install   — поставити systemd-демон, enable+start
#   ua-l10n-bootstrap.sh remove    — прибрати його
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$(dirname "$HERE")"                      # .../UkrainianL10n/target
SYSD="/etc/systemd/system"
SVC="ua-l10n-api.service"

if [ "$(id -u)" != "0" ]; then
    echo "ПОТРІБЕН root. Запусти: sudo $0 $*" >&2
    exit 1
fi

case "$1" in
install)
    cp -f "$TARGET/systemd/$SVC" "$SYSD/$SVC"
    chmod 644 "$SYSD/$SVC"
    systemctl daemon-reload
    systemctl enable "$SVC" >/dev/null 2>&1 || true
    systemctl restart "$SVC"
    sleep 1
    echo -n "ping: "
    curl -s "http://127.0.0.1:7686/?action=ping" || echo "(демон не відповів)"
    echo
    echo "OK: демон $SVC активний; nginx-аліас /ua-l10n-api/ DSM реєструє сам."
    ;;
remove)
    systemctl stop "$SVC" >/dev/null 2>&1 || true
    systemctl disable "$SVC" >/dev/null 2>&1 || true
    rm -f "$SYSD/$SVC"
    systemctl daemon-reload >/dev/null 2>&1 || true
    echo "OK: демон прибрано."
    ;;
*)
    echo "usage: $0 {install|remove}" >&2
    exit 1
    ;;
esac
