#!/bin/sh
# Ідемпотентно ставить/прибирає DSM nginx-аліас /ua-l10n-api/ для root-демона.
# Викликається з systemd-юніта (ExecStartPre ensure / ExecStopPost remove) — тобто
# від root. Self-contained: НЕ залежить від DSM web-config resource-воркера (той на
# unsigned-пакеті крихкий — "Acquire web-config (fail)" валив старт усього пакета).
DST=/etc/nginx/conf.d/dsm.ua-l10n.conf   # DSM-сервер (5000/5001) інклудить conf.d/dsm.*.conf усередині server-блоку

reload_nginx() {
    synosystemctl reload nginx >/dev/null 2>&1 || nginx -s reload >/dev/null 2>&1 || true
}

case "$1" in
ensure)
    TMP="$(mktemp 2>/dev/null || echo /dev/shm/ua-l10n-ngx.$$)"
    cat > "$TMP" <<'EOF'
location /ua-l10n-api/ {
    proxy_pass http://127.0.0.1:7686/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Cookie $http_cookie;
    proxy_set_header X-SYNO-TOKEN $http_x_syno_token;
    proxy_set_header Connection "";
    proxy_read_timeout 90s;
}
EOF
    if ! cmp -s "$TMP" "$DST" 2>/dev/null; then
        cp -f "$TMP" "$DST" && chmod 644 "$DST"
        nginx -t >/dev/null 2>&1 && reload_nginx
    fi
    rm -f "$TMP"
    ;;
remove)
    if [ -e "$DST" ]; then
        rm -f "$DST"
        reload_nginx
    fi
    ;;
esac
exit 0
