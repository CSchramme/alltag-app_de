# Alltag – Projektkontext

## Ziel
Web-App/PWA „Alltag“ für Schule (EduPage) + Privates (Erinnerungen, Termine, Notizen, selbst eingetragene Noten) im iOS-Liquid-Glass-Stil. Läuft auf Plesk (Node.js/Passenger), GitHub: CSchramme/private (Branch main).

## Aufbau
- `app.js` – Server + Plesk-Startdatei (Node ≥ 20, keine npm-Abhängigkeiten – auf diesem Plesk landet `npm install` nicht bei der laufenden Node-Version). Auth über `APP_PASSWORD` (Env), signiertes Cookie. Daten als JSON in `data/` (außerhalb von `public/`): config (EduPage-Zugang), db (eigene Einträge), state (Push-Abos, gesehene Schlüssel), snapshot, session (EduPage-Cookies), tokens (Widget-Lesezugriff, Cron-Schlüssel), vapid.
- `edupage.js` – EduPage-Zugriff, übertragen aus Python `edupage-api` 0.13.3: RPC-Login (+ Formular-Fallback), `/user`-Refresh mit gespeicherten Cookies statt Neu-Login (Captcha-Schutz), Stundenplan per `/gcall`, Timeline. Vertretungen NUR aus dem persönlichen Stundenplan (Wunsch des Nutzers: der Schul-Vertretungsplan nach Klasse passte nicht – Kurse/Gruppen).
- `push.js` – Web-Push (RFC 8291 aes128gcm + RFC 8292 VAPID) mit `crypto`; gegen http_ece/web-push gegengeprüft, Schlüsselformat kompatibel zu web-push.
- `public/` – Vanilla-JS-Frontend (`app.js`), `sw.js`, `widget.js` (Scriptable, Platzhalter `__SERVER__`/`__TOKEN__`).
- Abgleich: Plesk-„URL abrufen“ alle 15 Min. auf `/api/cron?key=…`, zusätzlich interner Timer, solange der Prozess läuft.
- `main.py` = ursprüngliches Python-CLI-Skript (nicht mehr Teil der App).
- Demo: `npm run demo` (DEMO=1, Passwort `demo`, Daten in `data-demo/`). Tests: `npm test`.

## Erkenntnisse zu EduPage
- Node-zlib packt andere Bytes als Python-zlib – gleichwertig, EduPage entpackt nur (Test prüft Inhalt, nicht Bytes)
- `parseHome` schneidet wie Python am vorletzten `);` – echte Seite hat danach noch Skript
- Nicht oft einloggen (Captcha) – nach Captcha 1 h Pause, nach falschem Passwort Stopp bis Neueintrag in der App
- Die Schule nutzt EduPage-Noten nicht → Noten nur manuell

## Offene Punkte
1. Erster echter Lauf gegen EduPage – bisher nur gegen nachgebaute Daten getestet (Feldnamen: Hausaufgaben-Fach `predmetid`, Fälligkeit `cas_udalosti`, Klasse über `dbi.students[userid]`)
2. Wie EduPage im persönlichen Plan eine Vertretung (nicht nur Entfall) kennzeichnet, ist noch unbekannt → `/api/diagnose?key=<cron>` (vorübergehend) liefert Rohdaten; danach Endpunkt wieder entfernen
3. Push und Scriptable-Widget noch nicht auf einem echten iPhone geprüft
