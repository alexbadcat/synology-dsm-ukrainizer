#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Українізатор DSM — ROOT-демон. Слухає 127.0.0.1:7686, крутиться як root (systemd
# юніт без User=), тож робить УСІ привілейовані записи локалей + читає /etc/shadow
# для перевірки пароля адміна. Зовні недоступний: тільки nginx-аліас /ua-l10n-api/
# пробрасує сюди Cookie + X-SYNO-TOKEN чинної DSM-сесії. КОЖНА дія гейтиться:
#   1) валідна сесія адміна (id-cookie + X-SYNO-TOKEN, звірені CurrentConnection);
#   2) привілейовані/деструктивні (apply/revert/exec) — ще й пароль адміна (crypt).
# Чому демон, а не self-root cgi: unsigned community-cgi виконується як package-user
# (uid 144435), НЕ root, і POST на нього DSM ріже 403. Демон — єдиний робочий root-канал.
import json, os, sys, ssl, subprocess, urllib.request, crypt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_here = os.path.dirname(os.path.realpath(__file__))
for _b in (_here, "/var/packages/UkrainianL10n/target/bin"):
    if os.path.isdir(_b):
        sys.path.insert(0, _b)
        break
import uacore

HOST, PORT = "127.0.0.1", 7686
CHECK = "https://127.0.0.1:5001/webapi/entry.cgi?api=SYNO.Core.CurrentConnection&version=1&method=list"
_ctx = ssl.create_default_context(); _ctx.check_hostname = False; _ctx.verify_mode = ssl.CERT_NONE
PW_ACTIONS = ("apply", "revert", "exec", "set-language")


def _admin_hashes():
    # хеші паролів привілейованих акаунтів (root + члени sudo-груп). На цьому DSM
    # сам root залочений (shadow «*»), реальні адміни — upadmin/admin із administrators.
    admins = {"root"}
    try:
        with open("/etc/group", encoding="utf-8", errors="replace") as f:
            for ln in f:
                p = ln.split(":")
                if len(p) >= 4 and p[0] in ("administrators", "sudo", "wheel"):
                    admins.update(x for x in p[3].strip().split(",") if x)
    except Exception:
        pass
    out = {}
    try:
        with open("/etc/shadow", encoding="utf-8", errors="replace") as f:
            for ln in f:
                p = ln.split(":")
                if len(p) >= 2 and p[0] in admins:
                    h = p[1]
                    if h and h[0] not in "!*":   # пропускаємо залочені (root:*)
                        out[p[0]] = h
    except Exception:
        pass
    return out


def check_admin_pw(pw):
    if not isinstance(pw, str) or not pw:
        return False
    for h in _admin_hashes().values():
        try:
            if crypt.crypt(pw, h) == h:
                return True
        except Exception:
            continue
    return False


def authed(cookie, tok):
    if not tok or "id=" not in (cookie or ""):
        return False
    try:
        r = urllib.request.Request(CHECK, headers={"Cookie": cookie, "X-SYNO-TOKEN": tok})
        with urllib.request.urlopen(r, timeout=6, context=_ctx) as resp:
            return json.load(resp).get("success") is True
    except Exception:
        return False


def norm_ids(body):
    ids = body.get("ids") or ([body["id"]] if body.get("id") else [])
    return [x for x in ids if isinstance(x, str)]


def norm_parts(body):
    parts = body.get("parts") or list(uacore.PARTS)
    return [x for x in parts if x in uacore.PARTS]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _query(self):
        out = {}
        q = self.path.split("?", 1)[1] if "?" in self.path else ""
        for kv in q.split("&"):
            if "=" in kv:
                k, v = kv.split("=", 1); out[k] = v
        return out

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > 8 * 1024 * 1024:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8")) or {}
        except Exception:
            return {}

    def _handle(self, method):
        body = self._body() if method == "POST" else {}
        action = (self._query().get("action") or body.get("action") or "").lower()
        cookie = self.headers.get("Cookie", "")
        tok = (self.headers.get("X-SYNO-TOKEN") or body.get("_token")
               or body.get("SynoToken") or self._query().get("SynoToken") or "")

        if action == "ping":
            return self._send(200, {"ok": True, "root": os.geteuid() == 0})

        if not authed(cookie, tok):
            return self._send(401, {"success": False, "error": "unauthorized"})

        if action in PW_ACTIONS and not check_admin_pw(body.get("password")):
            return self._send(403, {"success": False, "error": "bad-password"})

        if action == "list":
            return self._send(200, {"success": True, "components": uacore.list_components(),
                                    "timer": os.path.exists(uacore.SYSD + "/" + uacore.TIMER_TMR),
                                    "dsm_lang": uacore.get_dsm_lang()})

        if action == "set-language":
            lang = uacore.set_dsm_lang(body.get("lang", "rus"))
            return self._send(200, {"success": lang == "rus", "dsm_lang": lang})

        if action == "apply":
            out = uacore.do_apply(norm_ids(body), norm_parts(body))
            return self._send(200, {"success": True, "result": out["result"], "log": out["log"],
                                    "lang_switched": out.get("lang_switched", False),
                                    "components": uacore.list_components()})

        if action == "revert":
            out = uacore.do_revert(norm_ids(body), norm_parts(body))
            return self._send(200, {"success": True, "result": out["result"], "log": out["log"],
                                    "components": uacore.list_components()})

        if action == "export":
            ex = uacore.export_part(body.get("id"), body.get("part", "strings"))
            if not ex:
                return self._send(404, {"success": False, "error": "not available"})
            return self._send(200, {"success": True, "export": ex})

        if action == "enable-timer":
            return self._send(200, {"success": True, "timer": uacore.ensure_timer()})

        if action == "disable-timer":
            return self._send(200, {"success": True, "timer": not uacore.remove_timer()})

        if action == "exec":  # вбудований root-термінал (gated до адмін-сесії+пароля)
            cmd = body.get("cmd", "")
            if not isinstance(cmd, str) or not cmd.strip():
                return self._send(400, {"success": False, "error": "empty cmd"})
            try:
                p = subprocess.run(["/bin/sh", "-c", cmd], capture_output=True,
                                   timeout=60, text=True, errors="replace")
                return self._send(200, {"success": True, "code": p.returncode,
                                        "stdout": p.stdout, "stderr": p.stderr})
            except subprocess.TimeoutExpired:
                return self._send(200, {"success": False, "error": "timeout (60s)"})

        return self._send(404, {"success": False, "error": "unknown action: " + action})

    def do_GET(self):
        try:
            self._handle("GET")
        except Exception as e:
            self._send(500, {"success": False, "error": "internal: %s" % e})

    def do_POST(self):
        try:
            self._handle("POST")
        except Exception as e:
            self._send(500, {"success": False, "error": "internal: %s" % e})


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "reapply":
        print("ua-l10n reapply: %d file(s) re-overlaid" % uacore.reapply())
        return
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
