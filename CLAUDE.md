# Alltag – Projektkontext

## Ziel
Web-App/PWA „Alltag“ für Schule (EduPage) + Privates (Erinnerungen, Termine, Notizen, selbst eingetragene Noten) im iOS-Liquid-Glass-Stil. Läuft auf Plesk (Node.js/Passenger), GitHub: CSchramme/private (Branch main).

## Aufbau
- `app.js` – Server + Plesk-Startdatei (Node ≥ 20, keine npm-Abhängigkeiten – auf diesem Plesk landet `npm install` nicht bei der laufenden Node-Version). Auth über `APP_PASSWORD` (Env), signiertes Cookie. Daten als JSON in `data/` (außerhalb von `public/`): config (EduPage-Zugang), db (eigene Einträge), state (Push-Abos, gesehene Schlüssel), snapshot, session (EduPage-Cookies), tokens (Widget-Lesezugriff, Cron-Schlüssel), vapid.
- `edupage.js` – EduPage-Zugriff, übertragen aus Python `edupage-api` 0.13.3: RPC-Login (+ Formular-Fallback), `/user`-Refresh mit gespeicherten Cookies statt Neu-Login (Captcha-Schutz), Stundenplan per `/gcall`, Timeline. Vertretungen NUR aus dem persönlichen Stundenplan (Wunsch des Nutzers: der Schul-Vertretungsplan nach Klasse passte nicht – Kurse/Gruppen).
- `push.js` – Web-Push (RFC 8291 aes128gcm + RFC 8292 VAPID) mit `crypto`; gegen http_ece/web-push gegengeprüft, Schlüsselformat kompatibel zu web-push.
- `public/` – Vanilla-JS-Frontend (`app.js`), `sw.js`, `widget.js` (Scriptable, Platzhalter `__SERVER__`/`__TOKEN__`), `recur.js` (Wiederholungsregeln, auch vom Server per require genutzt), `theme.js` (Hell/Dunkel + Glas klar/getönt vor dem ersten Zeichnen, localStorage pro Gerät).
- EduPage-Schreibzugriffe (aus `timeline/pics/js/timelineViewer.js` bzw. Python-Bibliothek): `createItem` (neue Nachricht, selectedUser `Ucitel<id>`), `createReply` {groupid, text}, `setUserProp` {propsToStore: {groupid: {done|starred: '1'|'0'}}} – alle an `/timeline/?=&akcia=…&eqav=1&maxEqav=7` mit kodiertem Body. Lehrer-Stundenplan: `currenttt.js curentttGetData` table=teachers.
- Kalender: Woche Mo–So (am Wochenende schon die nächste), ‹ › / Pfeiltasten wechseln; andere Wochen per `GET /api/week?start=<Montag>` (aus dem Abgleich, sonst live, 10 Min. Cache). Snapshot selbst bleibt „heute + 6 Tage“ (Heute-Ansicht, Mitteilungen).
- Lernplan wird nicht gespeichert, sondern aus Prüfungen berechnet (`study()` in app.js, IDs `learn:<examId>:<7|3|1>`, Haken in state.done).
- Abgleich: interner Timer; der Hoster hat keine geplanten Aufgaben → App pingt sich alle 2 Min. selbst (`/api/ping`, Adresse aus angemeldetem `/api/data` in `data/origin.json`). Optional `/api/cron?key=…` (z. B. cron-job.org).
- `main.py` = ursprüngliches Python-CLI-Skript (nicht mehr Teil der App).
- Demo: `npm run demo` (DEMO=1, Passwort `demo`, Daten in `data-demo/`). Tests: `npm test`.

## Erkenntnisse zu EduPage
- Node-zlib packt andere Bytes als Python-zlib – gleichwertig, EduPage entpackt nur (Test prüft Inhalt, nicht Bytes)
- `parseHome` schneidet wie Python am vorletzten `);` – echte Seite hat danach noch Skript
- Nicht oft einloggen (Captcha) – nach Captcha 1 h Pause, nach falschem Passwort Stopp bis Neueintrag in der App
- Die Schule nutzt EduPage-Noten nicht → Noten nur manuell

## Format des persönlichen Tagesplans (/gcall, aus echten Daten 11/2026)
- Einträge: `type` lesson/event/period/'' ; `header[].item.subjectid` bzw. `header[].text` (Termine: „SchA: 1.Deutsch-SchA“, Feiertage: „Feiertag: …“, `uniperiod: 'ad'`, `flags.dp0.allday`)
- Entfall = eigener Eintrag mit `type: ''`, ohne Uhrzeit, `infos` „Entfällt“, Fach nur im Header
- Vertretung = `flags.dp0.changes` [{column, old}] mit column teacherids/classroomids/subjectid; `classids`-Änderungen (zusammengelegte Klassen) ignorieren
- Fällige Hausaufgaben stehen in `infos` mit `type: 'homework'` (`item.text`); Timeline-Hausaufgaben: `text` leer, Titel `data.nazov`, Fach `data.predmetid`, Fälligkeit `cas_udalosti`/`data.date`, Details `data.popis`
- userid z. B. `Student-3330`, Lehrer-IDs `Ucitel-…`

## Offene Punkte
1. Eine echte Lehrer-/Raum-Vertretung war in den Rohdaten noch nicht dabei – Erkennung beruht auf dem beobachteten `changes`-Format
2. „Gefällt mir“/Lesebestätigung: `createConfirmation` {groupid, confirmType: like ('1'/'0') | receipt ('')} (aus der Node-Bibliothek edupage-api 0.8.3); Felder `receipt`, `importantReply`, `confirmations {like, receipt}`, `myConfirmations {like, receipt: Zeit}` – noch nicht mit echtem Konto ausgelöst
4. Senden/Antworten/Haken in EduPage sind nur gegen den EduPage-Code gebaut, noch nicht mit echtem Konto ausgelöst
3. Push und Scriptable-Widget noch nicht auf einem echten iPhone geprüft
