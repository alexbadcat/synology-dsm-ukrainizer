#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Українізатор DSM — спільна логіка (без HTTP). Викликається з root-cgi (api.cgi)
# та з systemd-таймера авто-переповерху (`python3 uacore.py reapply`). Усі привіле-
# йовані записи локалей робить той, хто нас імпортує/запускає — а це root (synoscgi
# виконує cgi як root; таймер — system-юніт без User=).
import json, os, re, shutil, filecmp, sys, subprocess

def _find_payload():
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (os.path.join(os.path.dirname(here), "payload"),
              "/var/packages/UkrainianL10n/target/payload",
              "/usr/local/share/ua-l10n/payload"):
        if os.path.isdir(p):
            return p
    return "/var/packages/UkrainianL10n/target/payload"
PAYLOAD = _find_payload()
ETC = "/usr/local/etc/ua-l10n"
STATE = ETC + "/state.json"
PARTS = ("strings", "mails")
BAK = ".bak-ua"
ORIG = ".orig"

# Єдине джерело правди — manifest.json у payload (cid → {"live": жива тека rus,
# "name": людська назва}). Локалі DSM лежать у дуже різних теках: стандартний
# target/ui/texts/rus, target/app/texts/rus, target/texts/rus, file_browser, а
# також системні абсолютні шляхи (ядро DSM, Центр журналів, Порадник з безпеки,
# системні скрипти). Замість здогадок зашитих у код, апка читає точні шляхи з
# манесту, який збирається разом із перекладеним payload/comp/<cid>/{strings,mails}.
def _load_manifest():
    try:
        return json.load(open(PAYLOAD + "/manifest.json", encoding="utf-8"))
    except Exception:
        return {}
MANIFEST = _load_manifest()

# ---------- paths ----------
def live_base(cid):
    ent = MANIFEST.get(cid)
    return ent.get("live") if ent else None

def live_path(cid, part):
    base = live_base(cid)
    return (base + "/" + part) if base else None

def payload_path(cid, part):
    return PAYLOAD + "/comp/" + cid + "/" + part

def valid_id(cid):
    return cid in MANIFEST and re.match(r"^[\w.\-]{1,64}$", cid or "") is not None

# ---------- state ----------
def load_state():
    try:
        return json.load(open(STATE, encoding="utf-8"))
    except Exception:
        return {"managed": {}}

def save_state(st):
    os.makedirs(ETC, exist_ok=True)
    tmp = STATE + ".tmp"
    json.dump(st, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)
    try:
        os.chmod(STATE, 0o644)
    except Exception:
        pass

def set_managed(st, cid, part, val):
    m = st.setdefault("managed", {}).setdefault(cid, {})
    if val:
        m[part] = True
    else:
        m.pop(part, None)
        if not m:
            st["managed"].pop(cid, None)

# ---------- status ----------
def part_status(cid, part):
    live = live_path(cid, part)
    pl = payload_path(cid, part)
    if not live or not os.path.exists(live):
        return "missing"
    if not os.path.exists(pl):
        return "no-translation"
    try:
        return "applied" if filecmp.cmp(live, pl, shallow=False) else "original"
    except Exception:
        return "original"

# ---------- pretty package names ----------
def pkg_displayname(cid):
    ent = MANIFEST.get(cid) or {}
    if ent.get("name"):
        return ent["name"]
    info = "/var/packages/%s/INFO" % cid
    try:
        for ln in open(info, encoding="utf-8", errors="surrogateescape"):
            m = re.match(r'^\s*displayname\s*=\s*"?(.*?)"?\s*$', ln)
            if m and m.group(1):
                return m.group(1)
    except Exception:
        pass
    return cid

# ---------- versions / install-state ----------
DSM_VERSION_FILES = ("/etc.defaults/VERSION", "/etc/VERSION")

def _pkg_from_live(base):
    if not base:
        return None
    m = re.match(r"^/var/packages/([^/]+)/", base)
    return m.group(1) if m else None

def dsm_version():
    for vf in DSM_VERSION_FILES:
        try:
            kv = {}
            for ln in open(vf, encoding="utf-8", errors="replace"):
                mm = re.match(r'^(\w+)="?([^"]*)"?\s*$', ln.strip())
                if mm:
                    kv[mm.group(1)] = mm.group(2)
            pv = kv.get("productversion", "")
            if not pv:
                continue
            v = "DSM " + pv
            if kv.get("buildnumber"):
                v += "-" + kv["buildnumber"]
            sf = kv.get("smallfixnumber", "0")
            if sf and sf != "0":
                v += " Update " + sf
            return v.strip()
        except Exception:
            continue
    return ""

def _pkg_info_version(pkg):
    try:
        for ln in open("/var/packages/%s/INFO" % pkg, encoding="utf-8", errors="replace"):
            mm = re.match(r'^\s*version\s*=\s*"?(.*?)"?\s*$', ln)
            if mm and mm.group(1):
                return mm.group(1)
    except Exception:
        pass
    return ""

def target_version(cid):
    # версія пакета/DSM, проти якої АКТУАЛЬНИЙ переклад (запечено в manifest на білді)
    return (MANIFEST.get(cid) or {}).get("ver", "")

def is_installed(cid):
    # компонент «встановлено», якщо його жива тека локалі існує на ЦЬОМУ боксі.
    # системні (ядро/сповіщення) — завжди; пакетні — лише коли пакет стоїть.
    base = live_base(cid)
    return bool(base) and os.path.isdir(base)

def installed_version(cid):
    # поточно встановлена версія на цьому боксі (live); "" якщо не встановлено
    if not is_installed(cid):
        return ""
    pkg = _pkg_from_live(live_base(cid))
    return _pkg_info_version(pkg) if pkg else dsm_version()

# ---------- enumerate ----------
def discover():
    # ВСІ компоненти з манесту (і встановлені, і ні) — невстановлені UI показує
    # сірими/неактивними знизу. Фільтр лише на наявність live-шляху в манесті.
    return [cid for cid in sorted(MANIFEST) if live_base(cid)]

def component_obj(cid):
    parts = {}
    bundled_any = False
    for part in PARTS:
        live = live_path(cid, part)
        pl = payload_path(cid, part)
        present = os.path.exists(live)
        bundled = os.path.exists(pl)
        bundled_any = bundled_any or bundled
        if not present and not bundled:
            continue
        parts[part] = {"present": present, "bundled": bundled, "status": part_status(cid, part)}
    inst = is_installed(cid)
    return {"id": cid, "name": pkg_displayname(cid), "bundled": bundled_any,
            "installed": inst, "ver": target_version(cid),
            "cur_ver": installed_version(cid) if inst else "", "parts": parts}

def list_components():
    out = []
    for cid in discover():
        obj = component_obj(cid)
        if obj["parts"]:
            out.append(obj)
    return out

# ---------- apply / revert ----------
def apply_part(cid, part, st):
    live = live_path(cid, part)
    pl = payload_path(cid, part)
    if not os.path.exists(pl) or not os.path.exists(os.path.dirname(live)):
        return "skip"
    if not os.path.exists(live + ORIG) and os.path.exists(live):
        shutil.copy2(live, live + ORIG)       # pristine original, kept forever
    if os.path.exists(live):
        shutil.copy2(live, live + BAK)         # rolling backup
    shutil.copyfile(pl, live)
    try:
        os.chown(live, 0, 0)
    except Exception:
        pass
    try:
        os.chmod(live, 0o644)
    except Exception:
        pass
    set_managed(st, cid, part, True)
    return "applied"

def revert_part(cid, part, st):
    live = live_path(cid, part)
    set_managed(st, cid, part, False)
    if os.path.exists(live + ORIG):
        shutil.copyfile(live + ORIG, live)
        try:
            os.chown(live, 0, 0)
        except Exception:
            pass
        try:
            os.chmod(live, 0o644)
        except Exception:
            pass
        return "reverted"
    return "no-orig"

def flush_ui_cache():
    # DSM кешує скомпільоване меню/тексти у /var/cache/js_config_parser; поки кеш
    # не скинути, головне меню робочого стола й інша кешована UI показують старі
    # (нелокалізовані) написи. Це той самий крок, що робить власний пост-інстал
    # хук Synology (/usr/syno/bin/remove_jsconfig_cache.sh). DSM регенерує кеш сам.
    try:
        shutil.rmtree("/var/cache/js_config_parser", ignore_errors=True)
        return True
    except Exception:
        return False

# ---------- мова інтерфейсу DSM ----------
# Українізація ховається в локалі `rus`, тож DSM покаже переклад ЛИШЕ якщо мова
# інтерфейсу = «Російська». На свіжому DSM language="def" (авто з браузера) →
# переклад rus не видно. Апка це перевіряє й одним кліком виставляє language=rus.
SYNOINFO = "/etc/synoinfo.conf"

def get_dsm_lang():
    try:
        with open(SYNOINFO, encoding="utf-8", errors="replace") as f:
            for ln in f:
                if ln.startswith("language="):
                    return ln.split("=", 1)[1].strip().strip('"').strip()
    except Exception:
        pass
    return ""

def set_dsm_lang(lang="rus"):
    if lang not in ("rus", "def", "enu"):
        lang = "rus"
    try:
        subprocess.run(["/usr/syno/bin/synosetkeyvalue", SYNOINFO, "language", lang],
                       timeout=15, check=False)
    except Exception:
        return ""
    flush_ui_cache()
    return get_dsm_lang()

def do_apply(ids, parts):
    st = load_state(); res = {}; log = []; any_applied = False
    for cid in ids:
        if not valid_id(cid):
            continue
        name = pkg_displayname(cid); res[cid] = {}
        for p in parts:
            status = apply_part(cid, p, st)
            if status == "applied":
                any_applied = True
            res[cid][p] = status
            log.append({"id": cid, "name": name, "part": p,
                        "path": live_path(cid, p), "status": status})
    save_state(st)
    ensure_timer()
    flush_ui_cache()
    # переклад сидить у локалі `rus` → апка САМА перемикає мову DSM на «Російську»
    # (=наша українська), щойно щось українізовано, інакше переклад не видно.
    lang_switched = False
    if any_applied and get_dsm_lang() != "rus":
        lang_switched = (set_dsm_lang("rus") == "rus")
    return {"result": res, "log": log, "lang_switched": lang_switched}

def do_revert(ids, parts):
    st = load_state(); res = {}; log = []
    for cid in ids:
        if not valid_id(cid):
            continue
        name = pkg_displayname(cid); res[cid] = {}
        for p in parts:
            status = revert_part(cid, p, st)
            res[cid][p] = status
            log.append({"id": cid, "name": name, "part": p,
                        "path": live_path(cid, p), "status": status})
    save_state(st)
    flush_ui_cache()
    return {"result": res, "log": log}

# ---------- auto-reapply ----------
def reapply():
    st = load_state(); changed = 0
    for cid, pm in list(st.get("managed", {}).items()):
        for part, on in list(pm.items()):
            if not on:
                continue
            if part_status(cid, part) != "applied" and os.path.exists(payload_path(cid, part)) \
               and os.path.exists(live_path(cid, part)):
                apply_part(cid, part, st); changed += 1
    if changed:
        save_state(st)
        flush_ui_cache()
    return changed

# ---------- export ----------
def export_part(cid, part):
    live = live_path(cid, part)
    if not (valid_id(cid) and part in PARTS and os.path.exists(live)):
        return None
    data = open(live, encoding="utf-8", errors="surrogateescape").read()
    return {"id": cid, "part": part, "name": "%s_%s" % (cid, part), "content": data}

# ---------- self-installed systemd timer (keeps translation after DSM/pkg updates) ----------
SYSD = "/etc/systemd/system"
SELF = os.path.abspath(__file__)
TIMER_SVC = "ua-l10n-reapply.service"
TIMER_TMR = "ua-l10n-reapply.timer"

def _write(path, text):
    tmp = path + ".tmp"
    open(tmp, "w").write(text)
    os.replace(tmp, path)
    os.chmod(path, 0o644)

def ensure_timer():
    # Best-effort: only root (cgi/system) succeeds; safe no-op otherwise.
    if not os.path.isdir(SYSD) or os.geteuid() != 0:
        return False
    try:
        _write(SYSD + "/" + TIMER_SVC,
               "[Unit]\nDescription=Ukrainizer DSM — re-overlay managed locale files after updates\n"
               "ConditionPathExists=%s\n\n"
               "[Service]\nType=oneshot\nExecStart=/usr/bin/python3 %s reapply\n" % (SELF, SELF))
        _write(SYSD + "/" + TIMER_TMR,
               "[Unit]\nDescription=Ukrainizer DSM — periodic locale re-overlay\n\n"
               "[Timer]\nOnBootSec=2min\nOnUnitActiveSec=15min\nPersistent=true\n\n"
               "[Install]\nWantedBy=timers.target\n")
        os.system("systemctl daemon-reload >/dev/null 2>&1")
        os.system("systemctl enable --now %s >/dev/null 2>&1" % TIMER_TMR)
        return True
    except Exception:
        return False

def remove_timer():
    try:
        os.system("systemctl disable --now %s >/dev/null 2>&1" % TIMER_TMR)
        for f in (TIMER_TMR, TIMER_SVC):
            p = SYSD + "/" + f
            if os.path.exists(p):
                os.remove(p)
        os.system("systemctl daemon-reload >/dev/null 2>&1")
        return True
    except Exception:
        return False

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "reapply":
        print("ua-l10n reapply: %d file(s) re-overlaid" % reapply())
    elif cmd == "ensure-timer":
        print("timer:", ensure_timer())
    elif cmd == "remove-timer":
        print("removed:", remove_timer())
    else:
        print("usage: uacore.py {reapply|ensure-timer|remove-timer}")
