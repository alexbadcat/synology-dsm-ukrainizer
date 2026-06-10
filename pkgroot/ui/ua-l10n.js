/* Українізатор DSM — DSM hub app. Lists core DSM + every installed package that
   has a Russian (rus) locale; lets you tick which to translate to Ukrainian and
   Apply/Revert per component. Backend = root daemon (127.0.0.1:7686) reached via
   the nginx alias /ua-l10n-api/ — unsigned community cgi runs as package-user (not
   root) and DSM 403s POST to it, so all privileged work goes through the daemon. */
Ext.namespace("SYNO.SDS.UkrainianL10n");

SYNO.SDS.UkrainianL10n.API = "/ua-l10n-api/";
SYNO.SDS.UkrainianL10n.JAR  = "https://send.monobank.ua/jar/8FCf878bY4";
SYNO.SDS.UkrainianL10n.CARD = "4874 1000 3935 0858";
SYNO.SDS.UkrainianL10n.QR   = "/webman/3rdparty/UkrainianL10n/images/donate-qr.jpg";

SYNO.SDS.UkrainianL10n.Instance = Ext.extend(SYNO.SDS.AppInstance, {
    appWindowName: "SYNO.SDS.UkrainianL10n.Main"
});

SYNO.SDS.UkrainianL10n.Main = Ext.extend(SYNO.SDS.AppWindow, {

    constructor: function (config) {
        config = config || {};
        this._comps = [];
        this._timerOn = false;
        this._rootPw = null;

        this._center = new Ext.Panel({
            region: "center", autoScroll: true, border: false,
            bodyStyle: "background:#ffffff;",
            html: '<div class="ua-empty">Завантаження списку компонентів…</div>'
        });

        this._term = new Ext.Panel({
            region: "south", height: 240, border: true, hidden: true, autoScroll: false,
            bodyStyle: "background:#11131a;",
            html: '<div class="ua-term">' +
                    '<div class="ua-term-out" id="ua-term-out">root-консоль (виконується з правами root). Приклади: <i>systemctl status ua-l10n-reapply.timer</i> · <i>id</i></div>' +
                    '<div class="ua-term-in"><span class="ua-term-ps">#&nbsp;</span>' +
                      '<input type="text" class="ua-term-cmd" id="ua-term-cmd" placeholder="команда…" autocomplete="off">' +
                    '</div>' +
                  '</div>'
        });

        Ext.apply(config, {
            width: 820, height: 660, minWidth: 600, minHeight: 460,
            maximizable: true, minimizable: true, resizable: true,
            layout: "border", items: [this._center, this._term],
            buttons: [
                { text: "Root-консоль", scope: this, handler: this._toggleTerm },
                { text: "❤️ Підтримати", scope: this, handler: this._donate },
                "->",
                { text: "Оновити", scope: this, handler: this._reload },
                { text: "Повернути оригінал", scope: this, handler: this._revert },
                { text: "Українізувати вибране", cls: "syno-ux-button-blue", scope: this, handler: this._apply }
            ],
            listeners: { afterrender: { fn: this._bind, scope: this, single: true } }
        });
        SYNO.SDS.UkrainianL10n.Main.superclass.constructor.call(this, config);
    },

    _token: function () {
        try {
            if (typeof _S === "function" && _S("SynoToken")) return _S("SynoToken");
            if (window.SYNO && SYNO.SDS && SYNO.SDS.Session) return SYNO.SDS.Session.SynoToken || "";
        } catch (e) {}
        return "";
    },

    _bind: function () {
        this.mon(this._center.body, "click", this._onClick, this);
        this.mon(this._term.body, "keydown", this._onTermKey, this);
        for (var i = 0, bs = this.buttons || []; i < bs.length; i++) {
            if (bs[i] && /Українізувати/.test(bs[i].text || "")) this._applyBtn = bs[i];
        }
        this._reload();
    },

    /* ---------- backend ---------- */
    _get: function (action) {
        return fetch(SYNO.SDS.UkrainianL10n.API + "?action=" + action + "&_=" + (+new Date()), {
            cache: "no-store", credentials: "include",
            headers: { "X-SYNO-TOKEN": this._token() }
        });
    },
    _send: function (body) {
        return fetch(SYNO.SDS.UkrainianL10n.API, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json", "X-SYNO-TOKEN": this._token() },
            body: Ext.encode(body)
        });
    },

    /* ---------- root-password gate ---------- */
    _askPassword: function (cb) {
        var self = this;
        if (this._pwWin) { try { this._pwWin.close(); } catch (e) {} this._pwWin = null; }
        var fld = new Ext.form.TextField({
            inputType: "password", width: 250, allowBlank: false, selectOnFocus: true
        });
        var doOk = function () {
            var v = fld.getValue();
            if (!v) { fld.focus(); return; }
            win.close();
            cb(v);
        };
        var win = this._pwWin = new Ext.Window({
            title: "Підтвердження прав адміністратора",
            width: 380, modal: true, resizable: false, layout: "form",
            cls: "ua-dlg", bodyStyle: "padding:18px;", hideLabels: true, buttonAlign: "right",
            items: [
                { xtype: "box", autoEl: { tag: "div", cls: "ua-pw-msg", html:
                    "Введи пароль <b>адміністратора DSM</b> (root/sudo), щоб застосувати зміни до системних файлів." } },
                fld
            ],
            buttons: [
                new SYNO.ux.Button({ text: "Скасувати", handler: function () { win.close(); } }),
                new SYNO.ux.Button({ text: "Підтвердити", btnStyle: "blue", handler: doOk })
            ],
            listeners: {
                show: function () { fld.focus(true, 250); },
                close: function () { self._pwWin = null; }
            }
        });
        fld.on("specialkey", function (f, e) { if (e.getKey() === e.ENTER) doOk(); });
        win.show();
    },

    // дає колбеку дійсний пароль: з кешу, або питає й кешує на час відкритого вікна
    _withRoot: function (fn) {
        var self = this;
        if (this._rootPw) { fn(this._rootPw); return; }
        this._askPassword(function (pw) { self._rootPw = pw; fn(pw); });
    },

    /* ---------- donate ---------- */
    _donate: function () {
        var self = this, NS = SYNO.SDS.UkrainianL10n;
        if (this._donateWin) { try { this._donateWin.close(); } catch (e) {} this._donateWin = null; }
        var win = this._donateWin = new Ext.Window({
            title: "❤️ Підтримати проєкт",
            width: 400, modal: true, resizable: false,
            cls: "ua-dlg ua-donate", buttonAlign: "right",
            bodyStyle: "padding:20px; background:#ffffff;",
            html:
              '<div class="ua-don-msg">Дякую, що користуєшся <b>Українізатором DSM</b>! 🇺🇦<br><br>' +
                'Проєкт некомерційний — роблю його у вільний час, аби софт говорив українською. ' +
                'Якщо він тобі корисний — можеш закинути копійчину на банку. ' +
                'Кожна гривня = мотивація додавати нові переклади. Дякую! 🍺</div>' +
              '<div class="ua-don-qr"><img src="' + NS.QR + '" alt="monobank QR"></div>' +
              '<div class="ua-don-card">…або переказ на картку:<br><b>' + NS.CARD + '</b></div>',
            buttons: [
                new SYNO.ux.Button({ text: "Закрити", handler: function () { win.close(); } }),
                new SYNO.ux.Button({ text: "Відкрити банку", btnStyle: "blue",
                    handler: function () { window.open(NS.JAR, "_blank", "noopener"); } })
            ],
            listeners: { close: function () { self._donateWin = null; } }
        });
        win.show();
    },

    _engineBanner: function () {
        this._center.body.dom.innerHTML =
            '<div class="ua-gate">' +
              '<div class="ua-gate-h">⚠️ Двигун ще не запущено</div>' +
              '<div class="ua-gate-p">Апку встановлено. Привілейовану частину — <b>root-демон</b>, ' +
                'що пише системні файли локалей — треба активувати <b>один раз</b>. Synology не дає ' +
                'непідписаному пакету root автоматично, тому апка зробить це сама через ' +
                '<b>Планувальник завдань DSM</b> (від твоєї адмін-сесії) — без терміналу й SSH.</div>' +
              '<div class="ua-gate-p">Натисни кнопку й підтверди пароль <b>адміністратора DSM</b>:</div>' +
              '<div class="ua-gate-act"><button type="button" class="ua-activate-btn">Активувати двигун</button></div>' +
              '<div class="ua-act-status"></div>' +
            '</div>';
    },

    _actStatus: function (html) {
        var el = this._center.body.dom.querySelector(".ua-act-status");
        if (el) el.innerHTML = html;
    },

    // виклик DSM WebAPI з поточної (адмін) сесії DSM
    _webapi: function (api, params) {
        var body = "api=" + encodeURIComponent(api);
        for (var k in params) if (params.hasOwnProperty(k))
            body += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
        body += "&SynoToken=" + encodeURIComponent(this._token());
        return fetch("/webapi/entry.cgi", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "X-SYNO-TOKEN": this._token() },
            body: body
        }).then(function (r) { return r.json(); });
    },

    // пінгуємо демон, поки не підніметься (або поки не вийде спроби)
    _pollDaemon: function (tries) {
        var self = this;
        return new Promise(function (resolve) {
            var attempt = function (n) {
                if (n <= 0) { resolve(false); return; }
                self._get("ping").then(function (r) { return r.json(); })
                    .then(function (p) {
                        if (p && p.root === true) resolve(true);
                        else setTimeout(function () { attempt(n - 1); }, 700);
                    })
                    .catch(function () { setTimeout(function () { attempt(n - 1); }, 700); });
            };
            attempt(tries);
        });
    },

    _activate: function () {
        var self = this;
        this._askPassword(function (pw) { self._rootPw = pw; self._doActivate(pw); });
    },

    // повний zero-SSH bootstrap: PasswordConfirm → root-таск (enable+start) → run → delete → пінг
    _doActivate: function (pw) {
        var self = this, H = Ext.util.Format.htmlEncode;
        var SVC = "pkg-UkrainianL10n_api.service";
        var schedule = Ext.encode({ date_type: 0, monthly_week: "[]", hour: 0, minute: 0,
            repeat_hour: 0, repeat_min: 0, last_work_hour: 0, week_day: "0,1,2,3,4,5,6", repeat_date: 1001 });
        var extra = Ext.encode({ notify_enable: false, notify_mail: "", notify_if_error: false,
            script: "/bin/systemctl enable " + SVC + "; /bin/systemctl start " + SVC });
        this._actStatus("Перевірка пароля адміністратора…");
        this._webapi("SYNO.Core.User.PasswordConfirm", { version: 2, method: "auth", password: pw })
            .then(function (j) {
                if (!j || !j.success || !j.data || !j.data.SynoConfirmPWToken)
                    throw new Error("Невірний пароль адміністратора DSM (або сесія без прав адміна).");
                self._actStatus("Створюю одноразове root-завдання…");
                return self._webapi("SYNO.Core.TaskScheduler.Root", {
                    version: 4, method: "create", name: "UkrainianL10n-activate",
                    real_owner: "root", owner: "root", enable: "true",
                    schedule: schedule, extra: extra, type: "script",
                    SynoConfirmPWToken: j.data.SynoConfirmPWToken
                });
            })
            .then(function (j) {
                if (!j || !j.success || !j.data || !j.data.id)
                    throw new Error("Не вдалося створити завдання у Планувальнику.");
                self._taskId = j.data.id;
                self._actStatus("Запускаю root-демон…");
                return self._webapi("SYNO.Core.TaskScheduler", {
                    version: 2, method: "run", tasks: Ext.encode([{ id: self._taskId, real_owner: "root" }])
                });
            })
            .then(function () {
                self._actStatus("Чекаю, поки демон підніметься…");
                return self._pollDaemon(25);
            })
            .then(function (ok) {
                self._webapi("SYNO.Core.TaskScheduler", {  // прибираємо за собою таск
                    version: 2, method: "delete", tasks: Ext.encode([{ id: self._taskId, real_owner: "root" }])
                });
                if (ok) { self._actStatus("✓ Двигун активовано!"); self._loadList(); }
                else self._actStatus('<span class="ua-act-err">Демон не відповів. Спробуй ще раз або онови сторінку (Ctrl+F5).</span>');
            })
            .catch(function (e) {
                self._actStatus('<span class="ua-act-err">' + H(e.message) + '</span>');
            });
    },

    _reload: function () {
        var self = this;
        // спершу перевіряємо, чи піднятий root-демон (ping); без нього — банер-інструкція
        this._get("ping").then(function (r) { return r.json(); })
            .then(function (p) {
                if (!p || p.root !== true) { self._engineBanner(); return; }
                self._loadList();
            })
            .catch(function () { self._engineBanner(); });
    },

    _loadList: function () {
        var self = this;
        this._get("list").then(function (r) { return r.json(); })
            .then(function (j) {
                self._comps = (j && j.components) || [];
                self._timerOn = !!(j && j.timer);
                self._dsmLang = (j && j.dsm_lang) || "";
                self._render();
            })
            .catch(function (e) {
                self._center.body.dom.innerHTML =
                    '<div class="ua-empty">Помилка завантаження: ' + Ext.util.Format.htmlEncode(e.message) +
                    '<br><br>Якщо бачиш «unauthorized» — онови сторінку DSM (Ctrl+F5) і зайди в застосунок знову.</div>';
            });
    },

    _badge: function (st) {
        var map = {
            applied: ["українізовано", "ua-b-ok"],
            original: ["оригінал", "ua-b-orig"],
            "no-translation": ["нема перекладу", "ua-b-none"],
            missing: ["—", "ua-b-miss"]
        };
        var m = map[st] || map.missing;
        return '<span class="ua-badge ' + m[1] + '">' + m[0] + '</span>';
    },

    _partsCell: function (c) {
        var out = "";
        ["strings", "mails"].forEach(function (part) {
            var p = c.parts[part];
            if (!p) return;
            var label = part === "strings" ? "інтерфейс" : "сповіщення";
            out += '<span class="ua-part">' + label + ': </span>' +
                   '<span class="ua-pst">' +
                       (SYNO.SDS.UkrainianL10n.Main.prototype._badge(p.status)) + '</span> ';
        });
        return out;
    },

    // комірка версії: версія, проти якої АКТУАЛЬНИЙ переклад; якщо встановлена
    // версія інша — підсвічуємо (переклад може бути неточним для нової версії).
    _verCell: function (c) {
        var H = Ext.util.Format.htmlEncode;
        if (!c.ver) return '<span class="ua-ver-dim">—</span>';
        var out = '<span class="ua-ver" title="Переклад актуальний для цієї версії">' + H(c.ver) + '</span>';
        if (c.installed && c.cur_ver && c.cur_ver !== c.ver) {
            out += '<span class="ua-ver-warn" title="Встановлена версія відрізняється від тієї, для якої зроблено переклад — частина рядків може бути неперекладена">встановлено: ' + H(c.cur_ver) + '</span>';
        }
        return out;
    },

    _row: function (c, enabled) {
        var H = Ext.util.Format.htmlEncode;
        var canCheck = enabled && c.bundled;
        var dis = canCheck ? "" : " disabled";
        var checkedAttr = canCheck ? " checked" : "";
        var rowCls = "ua-row" + (enabled ? "" : " ua-row-off") + (canCheck ? "" : " ua-row-nb");
        return '<tr class="' + rowCls + '">' +
                 '<td class="ua-c-ck"><input type="checkbox" class="ua-ck" data-id="' + H(c.id) + '"' + checkedAttr + dis + '></td>' +
                 '<td class="ua-c-name"><b>' + H(c.name) + '</b><span class="ua-id">' + H(c.id) + '</span></td>' +
                 '<td class="ua-c-ver">' + this._verCell(c) + '</td>' +
                 '<td class="ua-c-parts">' +
                   (enabled ? this._partsCell(c) : '<span class="ua-off-tag">не встановлено</span>') +
                 '</td>' +
               '</tr>';
    },

    _render: function () {
        var self = this;
        var comps = (this._comps || []).slice();
        var inst = [], notinst = [];
        comps.forEach(function (c) { (c.installed ? inst : notinst).push(c); });
        var byName = function (a, b) { return (a.name || "").localeCompare((b.name || ""), "uk"); };
        inst.sort(byName); notinst.sort(byName);

        var nApplied = 0, nBundled = 0;
        inst.forEach(function (c) {
            if (c.bundled) nBundled++;
            if (["strings", "mails"].some(function (p) { return c.parts[p] && c.parts[p].status === "applied"; })) nApplied++;
        });

        var rows = '';
        inst.forEach(function (c) { rows += self._row(c, true); });
        if (notinst.length) {
            rows += '<tr class="ua-sep"><td></td><td colspan="3">' +
                      'Не встановлені пакети (' + notinst.length + ') — переклад уже в комплекті, ' +
                      'застосується автоматично, щойно встановиш пакет</td></tr>';
            notinst.forEach(function (c) { rows += self._row(c, false); });
        }

        var timerLbl = this._timerOn
            ? '<span class="ua-timer ua-timer-on">● авто-переповерх увімкнено</span>'
            : '<span class="ua-timer ua-timer-off">○ авто-переповерх вимкнено</span>';

        var head =
            '<div class="ua-head">' +
              '<div class="ua-title">Українізатор DSM 🇺🇦</div>' +
              '<div class="ua-sub">' + inst.length + ' встановлен(их) компонент(ів)' +
                (notinst.length ? ' + ' + notinst.length + ' у запасі (сірі, неактивні — пакет не встановлено)' : '') +
                '. Галочки доступні лише для встановлених. Версія поряд — та, для якої актуальний переклад.</div>' +
              '<div class="ua-tools">' +
                '<label class="ua-selall"><input type="checkbox" class="ua-all" checked> Виділити все встановлене</label>' +
                '<span class="ua-stat">' + nApplied + ' з ' + nBundled + ' українізовано</span>' +
                '<label class="ua-selall ua-tmwrap"><input type="checkbox" class="ua-tm"' + (this._timerOn ? ' checked' : '') +
                  '> тримати переклад після оновлень</label>' +
                timerLbl +
              '</div>' +
            '</div>';

        var table =
            '<table class="ua-tbl"><thead><tr>' +
              '<th></th><th>Компонент</th><th>Версія</th><th>Стан</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table>';

        this._center.body.dom.innerHTML = '<div class="ua-wrap">' + this._langWarn() + head + table + '</div>';
    },

    // ховається в локалі rus → видно ЛИШЕ коли мова інтерфейсу DSM = «Російська».
    // Якщо ні — попереджаємо й даємо кнопку перемкнути одним кліком.
    _langWarn: function () {
        if (!this._dsmLang || this._dsmLang === "rus") return "";
        // показуємо лише якщо вже є українізовані компоненти (інакше — спершу застосуй):
        var hasApplied = (this._comps || []).some(function (c) {
            return ["strings", "mails"].some(function (p) {
                return c.parts[p] && c.parts[p].status === "applied";
            });
        });
        if (!hasApplied) return "";
        var names = { def: "автоматична (з браузера)", enu: "English", cht: "繁體中文", chs: "简体中文",
            ger: "Deutsch", fre: "Français", ita: "Italiano", spn: "Español", jpn: "日本語",
            krn: "한국어", ptb: "Português (BR)", ptg: "Português (EU)", trk: "Türkçe", csy: "Čeština",
            plk: "Polski", hun: "Magyar", nld: "Nederlands", dan: "Dansk", nor: "Norsk", sve: "Svenska",
            tha: "ไทย" };
        var cur = names[this._dsmLang] || this._dsmLang;
        return '<div class="ua-langwarn">' +
                 '<div class="ua-lw-h">⚠️ Український переклад поки не видно</div>' +
                 '<div class="ua-lw-p">Українізація ховається в системній локалі <b>«Російська»</b>, а зараз ' +
                   'мова інтерфейсу DSM — <b>' + Ext.util.Format.htmlEncode(cur) + '</b>. Щоб переклад відобразився, ' +
                   'мову треба перемкнути на «Російську» (=наша українська).</div>' +
                 '<div class="ua-lw-act"><button type="button" class="ua-langfix-btn">Перемкнути мову DSM на українську</button></div>' +
               '</div>';
    },

    _fixLang: function () {
        var self = this;
        this._withRoot(function (pw) {
            self._send({ action: "set-language", lang: "rus", password: pw })
              .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; }); })
              .then(function (res) {
                  var j = null; try { j = JSON.parse(res.text); } catch (e) {}
                  if (res.status === 403 && j && j.error === "bad-password") {
                      self._rootPw = null;
                      self.getMsgBox().alert("Українізатор DSM", "Невірний пароль адміністратора. Спробуй ще раз.");
                      return;
                  }
                  if (res.ok && j && j.success) {
                      self._dsmLang = j.dsm_lang || "rus";
                      self.getMsgBox().alert("Українізатор DSM",
                          "Мову DSM перемкнено на українську. <b>Вийди й зайди в DSM знову</b> (або онови сторінку Ctrl+F5), щоб інтерфейс став українським.");
                      self._render();
                  } else {
                      self.getMsgBox().alert("Українізатор DSM", "Не вдалося перемкнути мову: " + ((j && j.error) || ("HTTP " + res.status)));
                  }
              })
              .catch(function (e) { self.getMsgBox().alert("Українізатор DSM", "Помилка: " + e.message); });
        });
    },

    _checkedIds: function () {
        var ids = [], els = this._center.body.dom.querySelectorAll(".ua-ck");
        for (var i = 0; i < els.length; i++) if (els[i].checked && !els[i].disabled) ids.push(els[i].getAttribute("data-id"));
        return ids;
    },

    _onClick: function (e) {
        var ab = e.getTarget(".ua-activate-btn", 3);
        if (ab) { this._activate(); return; }
        var lf = e.getTarget(".ua-langfix-btn", 3);
        if (lf) { this._fixLang(); return; }
        var all = e.getTarget(".ua-all", 3);
        if (all) {
            var on = all.checked, els = this._center.body.dom.querySelectorAll(".ua-ck");
            for (var i = 0; i < els.length; i++) if (!els[i].disabled) els[i].checked = on;
            return;
        }
        var tm = e.getTarget(".ua-tm", 3);
        if (tm) { this._toggleTimer(tm.checked); return; }
        var xb = e.getTarget(".ua-xbtn", 3);
        if (xb) { this._export(xb.getAttribute("data-export")); return; }
    },

    _busy: function (txt) { var b = this._applyBtn; if (b && b.setText) { b.setText(txt); b.disable(); } },
    _unbusy: function () { var b = this._applyBtn; if (b && b.setText && b.rendered) { b.setText("Українізувати вибране"); b.enable(); } },

    /* ---------- live patch log ---------- */
    _openLog: function (title) {
        var box = new Ext.Panel({
            border: false, autoScroll: true,
            bodyStyle: "background:#11131a;padding:10px;",
            html: '<div class="ua-lg-cur">Готую…</div>'
        });
        var win = new Ext.Window({
            title: title, width: 600, height: 420, modal: true, layout: "fit",
            cls: "ua-dlg", maximizable: true, items: [box],
            buttons: [ new SYNO.ux.Button({ text: "Закрити", btnStyle: "blue", handler: function () { win.close(); } }) ]
        });
        win.show();
        box.body.dom.innerHTML = "";
        return box;
    },

    _appendLog: function (box, html) {
        if (!box || !box.body) return;
        var el = box.body.dom;
        el.innerHTML += html;
        el.scrollTop = el.scrollHeight;
    },

    _logLines: function (box, log) {
        var H = Ext.util.Format.htmlEncode;
        var icon = { applied: "✓", reverted: "↩", skip: "⊘", "no-orig": "⊘" };
        var cls  = { applied: "ua-lg-ok", reverted: "ua-lg-ok", skip: "ua-lg-dim", "no-orig": "ua-lg-dim" };
        var pl   = { strings: "інтерфейс", mails: "сповіщення" };
        var rows = "";
        (log || []).forEach(function (e) {
            rows += '<div class="ua-lg-row ' + (cls[e.status] || "") + '">' +
                      '<span class="ua-lg-ic">' + (icon[e.status] || "•") + '</span> ' +
                      '<b>' + H(e.name) + '</b> · ' + (pl[e.part] || H(e.part)) +
                      '<div class="ua-lg-path">' + H(e.path) + '</div>' +
                    '</div>';
        });
        this._appendLog(box, rows);
    },

    // покомпонентно: на кожен id — окремий запит, лог наповнюється «наживо»
    _runSeq: function (action, ids, pw, title, doneMsg) {
        var self = this, H = Ext.util.Format.htmlEncode, box = this._openLog(title), i = 0;
        this._langSwitched = false;
        this._busy("Зачекай…");
        var next = function () {
            if (i >= ids.length) {
                self._unbusy();
                var msg = doneMsg + (self._langSwitched
                    ? '<br><br>🇺🇦 Мову DSM перемкнено на українську автоматично. <b>Вийди й зайди в DSM знову</b>, щоб інтерфейс став українським.'
                    : '');
                self._appendLog(box, '<div class="ua-lg-done">' + msg + '</div>');
                self._reload();
                return;
            }
            var id = ids[i++];
            self._appendLog(box, '<div class="ua-lg-cur">→ ' + H(id) + ' …</div>');
            self._send({ action: action, ids: [id], password: pw })
              .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; }); })
              .then(function (res) {
                  var j = null; try { j = JSON.parse(res.text); } catch (e) {}
                  if (res.status === 403 && j && j.error === "bad-password") {
                      self._rootPw = null; self._unbusy();
                      self._appendLog(box, '<div class="ua-lg-err">Невірний пароль адміністратора. Закрий вікно і спробуй ще раз.</div>');
                      return;
                  }
                  if (res.ok && j && j.success) {
                      self._logLines(box, j.log);
                      if (j.components) self._comps = j.components;
                      if (j.lang_switched) { self._langSwitched = true; self._dsmLang = "rus"; }
                  } else {
                      self._appendLog(box, '<div class="ua-lg-err">' + H(id) + ': ' + ((j && j.error) || ("HTTP " + res.status)) + '</div>');
                  }
                  next();
              })
              .catch(function (e) { self._appendLog(box, '<div class="ua-lg-err">' + H(e.message) + '</div>'); next(); });
        };
        next();
    },

    _apply: function () {
        var ids = this._checkedIds(), self = this;
        if (!ids.length) { this.getMsgBox().alert("Українізатор DSM", "Нічого не вибрано."); return; }
        this._withRoot(function (pw) {
            self._runSeq("apply", ids, pw, "Українізація — що і де патчиться",
                "Готово! Онови сторінку DSM (Ctrl+F5), щоб побачити зміни в меню.");
        });
    },

    _revert: function () {
        var ids = this._checkedIds(), self = this;
        if (!ids.length) { this.getMsgBox().alert("Українізатор DSM", "Нічого не вибрано."); return; }
        this.getMsgBox().confirm("Українізатор DSM", "Повернути оригінальні (російські) тексти для вибраних компонентів?",
            function (b) {
                if (b !== "yes") return;
                self._withRoot(function (pw) {
                    self._runSeq("revert", ids, pw, "Повернення оригіналу — що і де",
                        "Повернено оригінальні тексти для вибраного.");
                });
            });
    },

    _toggleTimer: function (on) {
        var self = this;
        this._send({ action: on ? "enable-timer" : "disable-timer" })
            .then(function (r) { return r.json(); })
            .then(function (j) { self._timerOn = !!(j && j.timer); self._render(); })
            .catch(function () { self._reload(); });
    },

    _export: function (id) {
        var self = this;
        this._send({ action: "export", id: id, part: "strings" })
          .then(function (r) { return r.json(); })
          .then(function (j) {
              if (j && j.success && j.export) {
                  var blob = new Blob([j.export.content], { type: "text/plain;charset=utf-8" });
                  var a = document.createElement("a");
                  a.href = URL.createObjectURL(blob); a.download = j.export.name + ".txt";
                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
              } else {
                  self.getMsgBox().alert("Українізатор DSM", "Не вдалося експортувати: " + ((j && j.error) || "?"));
              }
          })
          .catch(function (e) { self.getMsgBox().alert("Українізатор DSM", "Помилка: " + e.message); });
    },

    /* ---------- root terminal ---------- */
    _toggleTerm: function () {
        if (this._term.hidden) { this._term.show(); this.doLayout();
            var i = document.getElementById("ua-term-cmd"); if (i) i.focus();
        } else { this._term.hide(); this.doLayout(); }
    },

    _onTermKey: function (e) {
        if (e.getKey() !== e.ENTER) return;
        var inp = document.getElementById("ua-term-cmd"), out = document.getElementById("ua-term-out");
        if (!inp || !out) return;
        var cmd = inp.value; if (!cmd.trim()) return;
        var H = Ext.util.Format.htmlEncode, self = this;
        this._withRoot(function (pw) {
            inp.value = ""; inp.disabled = true;
            out.innerHTML += '<div class="ua-term-cmd-echo"># ' + H(cmd) + '</div>';
            self._send({ action: "exec", cmd: cmd, password: pw })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (j && j.error === "bad-password") self._rootPw = null;
                    var t = "";
                    if (j && j.success) {
                        if (j.stdout) t += H(j.stdout);
                        if (j.stderr) t += '<span class="ua-term-err">' + H(j.stderr) + '</span>';
                        if (!j.stdout && !j.stderr) t += '<span class="ua-term-dim">(код ' + j.code + ', без виводу)</span>';
                    } else { t = '<span class="ua-term-err">' + H((j && j.error) || "помилка") + '</span>'; }
                    out.innerHTML += '<div class="ua-term-res">' + t + '</div>';
                    out.scrollTop = out.scrollHeight;
                })
                .catch(function (e) { out.innerHTML += '<div class="ua-term-res ua-term-err">' + H(e.message) + '</div>'; })
                .then(function () { inp.disabled = false; inp.focus(); });
        });
    }
});
