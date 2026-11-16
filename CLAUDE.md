# Alltag – Projektkontext

## Ziel
Web-App/PWA „Alltag“ für Schule (EduPage) + Privates (Erinnerungen, Termine, Notizen, selbst eingetragene Noten) im iOS-Liquid-Glass-Stil. Läuft auf Plesk (Node.js/Passenger), GitHub: CSchramme/alltag-app_de (Branch main; früher CSchramme/private, als Remote `alt` noch eingetragen).

## Aufbau
- `app.js` – Server + Plesk-Startdatei (Node ≥ 20, keine npm-Abhängigkeiten – auf diesem Plesk landet `npm install` nicht bei der laufenden Node-Version). Auth über `APP_PASSWORD` (Env), signiertes Cookie. Daten als JSON in `data/` (außerhalb von `public/`): config (EduPage-Zugang), db (eigene Einträge), state (Push-Abos, gesehene Schlüssel), snapshot, session (EduPage-Cookies), tokens (Widget-Lesezugriff, Cron-Schlüssel), vapid.
- `edupage.js` – EduPage-Zugriff, übertragen aus Python `edupage-api` 0.13.3: RPC-Login (+ Formular-Fallback), `/user`-Refresh mit gespeicherten Cookies statt Neu-Login (Captcha-Schutz), Stundenplan per `/gcall`, Timeline. Vertretungen NUR aus dem persönlichen Stundenplan (Wunsch des Nutzers: der Schul-Vertretungsplan nach Klasse passte nicht – Kurse/Gruppen).
- `push.js` – Web-Push (RFC 8291 aes128gcm + RFC 8292 VAPID) mit `crypto`; gegen http_ece/web-push gegengeprüft, Schlüsselformat kompatibel zu web-push.
- `public/` – Vanilla-JS-Frontend (`app.js`), `sw.js`, `widget.js` (Scriptable, Platzhalter `__SERVER__`/`__TOKEN__`), `recur.js` (Wiederholungsregeln, auch vom Server per require genutzt), `theme.js` (Hell/Dunkel + Glas klar/getönt vor dem ersten Zeichnen, localStorage pro Gerät).
- EduPage-Schreibzugriffe (aus `timeline/pics/js/timelineViewer.js` bzw. Python-Bibliothek): `createItem` (neue Nachricht, selectedUser `Ucitel<id>`), `createReply` {groupid, text}, `setUserProp` {propsToStore: {groupid: {done|starred: '1'|'0'}}} – alle an `/timeline/?=&akcia=…&eqav=1&maxEqav=7` mit kodiertem Body. Lehrer-Stundenplan: `currenttt.js curentttGetData` table=teachers.
- Kalender: Woche Mo–So (am Wochenende schon die nächste), ‹ › / Pfeiltasten wechseln; andere Wochen per `GET /api/week?start=<Montag>` (aus dem Abgleich, sonst live, 10 Min. Cache). Snapshot selbst bleibt „heute + 6 Tage“ (Heute-Ansicht, Mitteilungen).
- Lernplan wird nicht gespeichert, sondern aus Prüfungen berechnet (`study()` in app.js, IDs `learn:<examId>:<7|3|1>`, Haken in state.done).
- Abgleich: interner Timer; der Hoster hat keine geplanten Aufgaben → App pingt sich alle 2 Min. selbst (`/api/ping`, Adresse aus angemeldetem `/api/data` in `data/origin.json`). Optional `/api/cron?key=…` (z. B. cron-job.org).
- Schulweg: Wetter von Open-Meteo (Server holt stündlich in `data/weather.json`, CSP verbietet Abrufe vom Browser), Fahrplan mit Echtzeit von `bahnland-bayern.de/efa` (rapidJSON: STOPFINDER → `locations[].id`, TRIP_REQUEST2 mit `itdTripDateTimeDepArr=arr|dep`, Zeiten in UTC). db.transport.rest ist tot, bahn.de blockt.
- Kurzbefehle: `/api/wake` (Abfahrt zur 1. Stunde minus Vorlauf, sonst Beginn minus Vorlauf; leer ohne Schule) und `/api/focus` (Schulschluss) liefern nur „HH:MM“, lesbar mit Widget-Schlüssel.
- Geburtstage: db-Art `birthdays`, Regel `birthdayOn`/`ageOn` in recur.js (29.2. → 28.2., Jahr 1900 = unbekannt).
- Tafelbilder: Browser verkleinert auf JPEG (max. 2200 px), `POST /api/photos?subject&date&caption` als Formular-Datei mit Base64-Inhalt (`readImage`), Dateien in `data/photos/<uuid>.jpg`, nur angemeldet abrufbar; CSP erlaubt dafür `img-src blob:`.
- Lernzeit: `state.timer` {subject, minutes, start, end}; Ende meldet `notify()` (minütlich) per Push und schreibt `db.sessions`; offene App stoppt selbst bei 0.
- Home Assistant: `config.ha` {url, token, todo, pc[]} – Token geht nie an den Browser; Einkauf über `todo.get_items?return_response`/`add_item`/`update_item`/`remove_completed_items`; PC-Knöpfe nur aus der Freigabeliste (button/input_button → press, script → turn_on, switch → toggle). Stand 11/2026: im HA des Nutzers nur `todo.einkaufsliste`, noch kein Cookidoo, keine PC-Entitäten.
- Ticket: `config.ticket` {name, url, until} – nur ein Knopf zur offiziellen App/Website (Ticket-Optik wird bewusst nicht nachgebaut), Erinnerung 7/1/0 Tage vorher.
- PC-Bildschirm: `public/screen-agent.ps1` (PowerShell, ohne Installation; Platzhalter `__SERVER__`/`__KEY__`, Download im Profil mit BOM) lädt JPEGs (Formular-Datei, Base64) an `POST /api/screen/agent` mit Header `X-Key: <tokens.screen>` und holt dabei Eingaben ab; ohne Zuschauer wartet die Anfrage bis 25 s (Long-Poll). App: `GET /api/screen/frame?after=<seq>` (wartet bis 8 s), `POST /api/screen/input` (nur bekannte Ereignisse, Werte begrenzt). Alles nur im Speicher. Gemessen am PC des Nutzers: ~6 Bilder/s, 1600×900, ~160 KB je Bild bei bewegtem Bild; gesperrtes Windows = kein Bild.
- Branding (Jugend forscht): Slogan „Kalender, Stundenplan, Hausaufgaben. Alles in einer App.“, Logo „Tagesbogen“ (Bogen = Tag, Punkt = jetzt). Dateien, Farben, Schriften in `branding/README.md`. App-Icons aus `public/icon.svg` mit Edge headless gerendert (`--screenshot`, Fenster mind. 512 px, kleinere Größen herunterskaliert); maskable mit Zeichen auf 80 %.
- Betriebsarten (Umgebungsvariablen): ohne Angabe = private App (ein `APP_PASSWORD`, mit Home Assistant und PC-Fernsteuerung). `ACCOUNTS=1` = öffentliche Version (alltag-app.de): Konten mit Einladungscode, `APP_PASSWORD` ist dort nur der Code fürs allererste Konto (wird Admin), `DATA_KEY` verschlüsselt die Schulpasswörter (AES-GCM, `seal`/`unseal`; ohne ihn der Server-Schlüssel). `DEMO=1` = öffentliche Demo (keine Fotos/Mitteilungen, setzt sich nach 15 Min. ohne Besuch zurück); `PRIVATE=1` schaltet HA/PC zusätzlich ein (nur Tests).
- Konten: `accounts.json`/`invites.json` in DATA, Daten je Konto in `DATA/users/<id>/`. Welcher Ordner gilt, steht in `ctx` (AsyncLocalStorage, `home()`, `atRoot()` für Instanz-Dateien) – load/save bleiben überall gleich; Hintergrund-Abgleich per `eachUser()`. Sitzung `Konto.Ablauf.Signatur`, Signatur enthält `ver` (Passwort-Reset/Sperren beendet alte Sitzungen). Passwörter mit scrypt.
- Aussehen: private App = iOS Liquid Glass. Öffentliche Version und Demo bekommen vom Server `data-skin="modern"` ins HTML (klare Karten mit Rand, hell Punktraster, dunkel Sternenfeld, Überschriften mit Farbverlauf, Startseite mit Botschaft neben der Anmeldung) – alles als Token-Überschreibung am Ende von `app.css`.
- Impressum/Datenschutz: `public/impressum.html`, `public/datenschutz.html` (+ `legal.css`), Links nur im modern-Look. Persönliche Angaben NICHT im Code: Server ersetzt `{{LEGAL_NAME}}`, `{{LEGAL_ADDRESS}}`, `{{LEGAL_EMAIL}}`, `{{LEGAL_LOG_DAYS}}`, `{{LEGAL_HOSTER}}` (Standard PEIN GbR) aus Umgebungsvariablen, fehlende erscheinen gelb markiert.
- Demo-Konto (statt Demo-Instanz): Admin setzt `demo` an einem Konto (Support-ID = erste 8 Zeichen der Konto-ID). `isDemo()`/`limited()`: Beispieldaten, keine Fotos/Mitteilungen, kein Passwort-/Konto-Ändern, Zurücksetzen nach 15 Min. ohne Nutzung; `POST /api/demo` bzw. `/#demo` meldet ohne Passwort im Demo-Konto an.
- Sicherheit: `DATA_KEY` mit Konten Pflicht (≥ 32 Zeichen, sonst Start-Abbruch); EduPage-Sitzung `session.json` verschlüsselt; Fehlversuche je IP (`x-real-ip`) und je Konto (`tries`); Origin-Prüfung bei ändernden Anfragen; HSTS/COOP/Permissions-Policy; `logoutOthers` und `POST /api/tokens/widget` (Schlüssel erneuern).
- Einladungscodes: 6 Ziffern (`newInvite`), Standard 7 Tage, Flyer wählbar 30/60/90 Tage (`days`), einmal nutzbar; nach 30 falschen Codes/Stunde pausiert Registrieren. Flyer: `public/flyer.mjs` zeichnet 10×15-cm-JPGs (1200×1800) per Canvas und packt sie als ZIP (eigener Store-ZIP, Test prüft Aufbau); Kontakt aus `LEGAL_EMAIL`, Adresse aus `PUBLIC_URL`.
- Schulsoftware je Konto: `edupage` oder `none` (eigener Stundenplan `db.lessons` → `ownSnapshot()`, jede Woche gleich, in Ferien leer). WebUntis und Schulmanager folgen.
- `main.py` = ursprüngliches Python-CLI-Skript (nicht mehr Teil der App).
- Demo: `npm run demo` (DEMO=1, Passwort `demo`, Daten in `data-demo/`). Tests: `npm test`.

## Erkenntnisse zum Hoster (PEIN, Plesk-Kundenzugang)
- ModSecurity mit Comodo-Regeln (Modus „Warning“) + Fail2Ban: Anfrage-Typ `image/jpeg` löst Regel 210710/214930 aus → nach wenigen Treffern ist die IP ~10 Min. auf allen Ports gesperrt (Ping geht noch). Uploads daher nur als `multipart/form-data`, Inhalt Base64. Protokolle: Plesk → Node.js → Protokolle → „Alle Protokolle“, Filter „Nachricht“.
- Passenger: 1 Prozess; startet die App nach Leerlauf neu (Speicher-Zustand geht verloren).

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
