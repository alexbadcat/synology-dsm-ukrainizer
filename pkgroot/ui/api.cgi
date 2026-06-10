#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Українізатор DSM — root backend (CGI). synoscgi виконує цей .cgi під webman'ом
# як uid=0(root), тож окремий демон/nginx/SSH-bootstrap не потрібні: уся приві-
# лейована робота йде прямо тут. КРИТИЧНО: cgi доступний по URL будь-кому, тому
# КОЖНА дія жорстко гейтиться чинною DSM-сесією адміна (id-cookie + X-SYNO-TOKEN,
# звірені через SYNO.Core.CurrentConnection). Без валідної сесії — 401, край.
import json, os, sys, ssl, subprocess, urllib.request, crypt

# __file__ під synoscgi = symlink-шлях у webman/3rdparty; realpath веде в реальний
# target (@appstore/UkrainianL10n/ui). bin/ із uacore.py лежить поруч на рівень вище.
_here = os.path.dirname(os.path.realpath(__file__))
for _b in (os.path.join(os.path.dirname(_here), "bin"),
           "/var/packages/UkrainianL10n/target/bin"):
    if os.path.isdir(_b):
        sys.path.insert(0, _b)
        break
import uacore

CHECK = "https://127.0.0.1:5001/webapi/entry.cgi?api=SYNO.Core.CurrentConnection&version=1&method=list"
_ctx = ssl.create_default_context(); _ctx.check_hostname = False; _ctx.verify_mode = ssl.CERT_NONE

def _env(k): return os.environ.get(k, "") or ""

def read_body():
    try:
        n = int(_env("CONTENT_LENGTH") or 0)
    except ValueError:
        n = 0
    if n <= 0 or n > 8 * 1024 * 1024:
        return {}
    try:
        return json.loads(sys.stdin.buffer.read(n).decode("utf-8")) or {}
    except Exception:
        return {}

def query():
    out = {}
    for kv in _env("QUERY_STRING").split("&"):
        if "=" in kv:
            k, v = kv.split("=", 1); out[k] = v
    return out

def token(body):
    return (_env("HTTP_X_SYNO_TOKEN") or body.get("_token")
            or body.get("SynoToken") or query().get("SynoToken") or "")

def authed(body):
    cookie = _env("HTTP_COOKIE")
    tok = token(body)
    if not tok or "id=" not in cookie:
        return False
    try:
        r = urllib.request.Request(CHECK, headers={"Cookie": cookie, "X-SYNO-TOKEN": tok})
        with urllib.request.urlopen(r, timeout=6, context=_ctx) as resp:
            return json.load(resp).get("success") is True
    except Exception:
        return False

def _admin_hashes():
    # хеші паролів привілейованих акаунтів (root + члени sudo-груп). На цьому DSM
    # сам root залочений (shadow «*»), реальний адмін — upadmin із administrators.
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

PW_ACTIONS = ("apply", "revert", "exec")

def send(code, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(
        ("Status: %d\r\nContent-Type: application/json; charset=utf-8\r\n"
         "Cache-Control: no-store\r\nContent-Length: %d\r\n\r\n" % (code, len(body))).encode("ascii"))
    sys.stdout.buffer.write(body); sys.stdout.buffer.flush()

def norm_ids(body):
    ids = body.get("ids") or ([body["id"]] if body.get("id") else [])
    return [x for x in ids if isinstance(x, str)]

def norm_parts(body):
    parts = body.get("parts") or list(uacore.PARTS)
    return [x for x in parts if x in uacore.PARTS]

def main():
    method = _env("REQUEST_METHOD") or "GET"
    body = read_body() if method == "POST" else {}
    action = (query().get("action") or body.get("action") or "").lower()

    # health ping is the only ungated endpoint (no privileged data)
    if action == "ping":
        return send(200, {"ok": True, "root": os.geteuid() == 0})

    if not authed(body):
        return send(401, {"success": False, "error": "unauthorized"})

    # привілейовані/деструктивні дії додатково підтверджуються паролем адміна
    if action in PW_ACTIONS and not check_admin_pw(body.get("password")):
        return send(403, {"success": False, "error": "bad-password"})

    if action == "list":
        return send(200, {"success": True, "components": uacore.list_components(),
                          "timer": os.path.exists(uacore.SYSD + "/" + uacore.TIMER_TMR)})

    if method != "POST":
        return send(405, {"success": False, "error": "POST required"})

    if action == "apply":
        out = uacore.do_apply(norm_ids(body), norm_parts(body))
        return send(200, {"success": True, "result": out["result"], "log": out["log"],
                          "components": uacore.list_components()})

    if action == "revert":
        out = uacore.do_revert(norm_ids(body), norm_parts(body))
        return send(200, {"success": True, "result": out["result"], "log": out["log"],
                          "components": uacore.list_components()})

    if action == "export":
        ex = uacore.export_part(body.get("id"), body.get("part", "strings"))
        if not ex:
            return send(404, {"success": False, "error": "not available"})
        return send(200, {"success": True, "export": ex})

    if action == "enable-timer":
        return send(200, {"success": True, "timer": uacore.ensure_timer()})

    if action == "disable-timer":
        return send(200, {"success": True, "timer": not uacore.remove_timer()})

    if action == "exec":  # вбудований root-термінал (gated до адмін-сесії)
        cmd = body.get("cmd", "")
        if not isinstance(cmd, str) or not cmd.strip():
            return send(400, {"success": False, "error": "empty cmd"})
        try:
            p = subprocess.run(["/bin/sh", "-c", cmd], capture_output=True,
                               timeout=60, text=True, errors="replace")
            return send(200, {"success": True, "code": p.returncode,
                              "stdout": p.stdout, "stderr": p.stderr})
        except subprocess.TimeoutExpired:
            return send(200, {"success": False, "error": "timeout (60s)"})

    return send(404, {"success": False, "error": "unknown action: " + action})

try:
    main()
except Exception as e:
    send(500, {"success": False, "error": "internal: %s" % e})
