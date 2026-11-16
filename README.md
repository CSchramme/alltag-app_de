# Alltag

Kalender, Stundenplan, Hausaufgaben. Alles in einer App: eine Web-App im Stil von iOS Liquid Glass für iPhone und PC, die EduPage mit Terminen, Erinnerungen, Notizen und Noten zusammenführt.

- **Schule (EduPage):** Stundenplan mit Vertretung/Entfall an der Stunde, Hausaufgaben (Abhaken landet auch in EduPage), Prüfungen, als „fehlt“ markierte Hausaufgaben, Nachrichten lesen, schreiben, beantworten und markieren, „Wo ist Lehrkraft X gerade?“
- **Lernplan:** zu jeder angekündigten Prüfung automatisch Lern-Erinnerungen 7, 3 und 1 Tag vorher
- **Privat:** Erinnerungen und Termine (auch wiederkehrend: täglich, werktags, wöchentlich, alle 2 Wochen, monatlich), Notizen
- **Noten:** trägst du selbst ein; Durchschnitt mit Gewichtung und Zielrechner („Welche Note brauche ich?“)
- **Suche** über alles, **Kurzbefehle/Siri** („Hey Siri, Schule morgen“), **Dunkelmodus** und **Liquid Glass klar/getönt** einstellbar
- **Mitteilungen:** bei neuen Vertretungen und Nachrichten, zur Uhrzeit einer Erinnerung, 30 Minuten vor einem Termin und abends ein Ausblick auf morgen
- **Widget** für Home- und Sperrbildschirm über die kostenlose App Scriptable

```
app.js        Server und Startdatei für Plesk (Node.js ≥ 20, keine npm-Pakete nötig)
edupage.js    EduPage-Zugriff (übertragen aus der Python-Bibliothek edupage-api 0.13.3 und dem EduPage-Webclient)
push.js       Web-Push (RFC 8291/8292) mit Node-Bordmitteln
demo.js       Beispieldaten
public/       die Web-App (Dokumentenstamm), dazu widget.js für Scriptable
data/         wird beim Start angelegt: Schlüssel, EduPage-Zugang, deine Einträge – geheim, nie veröffentlichen
main.py       das ursprüngliche Python-Skript (wird von der App nicht gebraucht)
```

## Lokal ausprobieren

```powershell
npm run demo
```

Danach http://localhost:3000 öffnen. Das Passwort ist `demo`, angezeigt werden Beispieldaten.

## Auf Plesk einrichten

1. **Domain:** Lege eine Domain oder Subdomain an, zum Beispiel `alltag.deine-domain.de`, und aktiviere unter *SSL/TLS-Zertifikate* Let's Encrypt. Ohne HTTPS gibt es keine Mitteilungen.
2. **Code:** Unter *Git* das Repository `https://github.com/CSchramme/private.git` mit dem Zweig `main` in den Ordner der Domain holen (bei dir `/prvt.chrdev.eu`). Bei einem privaten Repository den Zugang mit Token oder Deploy-Key einrichten.
3. **Node.js** (unter *Websites & Domains* → Domain → *Node.js*):
   - Node.js-Version: 20 oder neuer
   - Anwendungsstamm: der Ordner mit `app.js` (bei dir `/prvt.chrdev.eu`)
   - Dokumentenstamm: dessen Unterordner `public` (`/prvt.chrdev.eu/public`) – niemals der Hauptordner
   - Anwendungsstartdatei: `app.js`
   - Anwendungsmodus: `production`
4. Unter **Benutzerdefinierte Umgebungsvariablen** `APP_PASSWORD` auf dein Passwort für die App setzen.
5. **Node.js aktivieren** bzw. **App neu starten**.
6. Die Domain öffnen und dich anmelden. Unter **Profil (oben rechts) → EduPage** Schul-Adresse, Benutzername und Passwort eintragen und auf **Verbinden** tippen.
7. **Regelmäßiger Abgleich:** Plesk beendet Node-Apps, wenn eine Weile niemand die Seite aufruft. Die App hält sich deshalb selbst wach (Aufruf der eigenen Adresse alle 2 Minuten) und gleicht alle 15 Minuten mit EduPage ab. Nach einem Neustart des Servers läuft sie erst wieder, wenn du sie einmal öffnest. Noch zuverlässiger wird es, wenn du unter **Profil → Hintergrund-Abgleich** die Adresse kopierst und sie alle 15 Minuten aufrufen lässt: entweder in Plesk unter *Geplante Aufgaben* → **URL abrufen**, falls dein Hoster das anbietet, oder beim kostenlosen Dienst **cron-job.org**.

Wichtig: `data/` liegt außerhalb des Dokumentenstamms und darf nie in `public/` landen. Dort stehen dein EduPage-Passwort und deine Einträge, also gehört der Ordner in deine Datensicherung.

**Aktualisieren:** In Plesk unter *Git* auf „Pull“ und danach auf *App neu starten* klicken. Ein `npm install` ist nicht nötig, weil die App keine Pakete braucht.

## Öffentliche Version einrichten (alltag-app.de)

Dieselbe App, nur mit Konten, Einladungscodes, eigenem Look und ohne Home Assistant und PC-Fernsteuerung. Sie läuft als **zweite Node-App** neben deiner privaten, mit eigenem Datenordner.

1. **Domain** `alltag-app.de` in Plesk anlegen, unter *SSL/TLS-Zertifikate* Let's Encrypt aktivieren und **„Dauerhafte, SEO-sichere 301-Weiterleitung von HTTP zu HTTPS“** einschalten.
2. **Git:** dasselbe Repository `CSchramme/private`, Zweig `main`, in den Ordner der neuen Domain holen.
3. **Node.js** wie oben (Anwendungsstamm = Ordner mit `app.js`, Dokumentenstamm = `public`, Startdatei `app.js`).
4. **Umgebungsvariablen:**

   | Variable | Wert |
   |---|---|
   | `ACCOUNTS` | `1` |
   | `APP_PASSWORD` | Start-Code für das allererste Konto (dein Admin-Konto). Danach hat er keine Wirkung mehr. |
   | `DATA_KEY` | Zufälliger Schlüssel, mindestens 32 Zeichen. Verschlüsselt die Schul-Passwörter. **Einmal setzen, nie ändern**, sonst müssen alle ihre Schule neu verbinden. Erzeugen z. B. mit `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` und im Passwort-Manager sichern. |
   | `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` | Angaben für Impressum und Datenschutz |
   | `LEGAL_LOG_DAYS` | Nach wie vielen Tagen der Hoster die Server-Protokolle löscht |

5. **App neu starten**, die Domain öffnen, **„Neu hier? Mit Einladungscode registrieren“** und als Code dein `APP_PASSWORD` eingeben. Dieses erste Konto ist Admin.
6. **Demo für die Jury:** Im Profil unter *Einladungen und Konten* einen Code erstellen, damit ein zweites Konto registrieren (z. B. `demo`), es dann in der Liste suchen und **„Als Demo-Konto einrichten“** wählen. Ab dann gibt es auf der Startseite „Demo ansehen“, und `https://alltag-app.de/#demo` öffnet die Demo direkt (gut für einen QR-Code). Was Besucher dort ändern, setzt sich nach 15 Minuten ohne Nutzung zurück.
7. **Datensicherung:** In Plesk unter *Backup-Manager* eine regelmäßige Sicherung einrichten. `data/` enthält alle Konten.

### Sicherheit auf einen Blick

- Jedes Konto hat einen eigenen Datenordner; die Tests prüfen, dass kein Konto die Daten eines anderen sieht.
- Passwörter nur als scrypt-Hash, Schul-Passwörter und EduPage-Sitzungen verschlüsselt (`DATA_KEY`, liegt nicht bei den Daten).
- Registrieren nur mit Einladungscode, zu leichte Passwörter werden abgelehnt.
- Falsche Anmeldeversuche bremsen je Gerät und je Konto (10 in 15 Minuten), nicht alle Nutzer zusammen.
- Cookie nur für die Anmeldung (HttpOnly, SameSite, Secure), ändernde Anfragen nur von der eigenen Seite, strenge Content-Security-Policy, HTTPS wird erzwungen (HSTS).
- Nutzer können sich auf allen anderen Geräten abmelden und ihren Widget-Schlüssel erneuern. Admins können Konten sperren und Passwörter zurücksetzen; alle Sitzungen des Kontos enden dann sofort.
- Ein Admin sieht nur Name, Schulsoftware und Aktivität eines Kontos, keine Inhalte.

## Aufs iPhone

1. Die Adresse in **Safari** öffnen, auf **Teilen → Zum Home-Bildschirm** tippen und Alltag von dort starten.
2. Unter **Profil → Mitteilungen** einschalten und mit „Test-Mitteilung senden“ prüfen (ab iOS 16.4).

Dafür ist kein Apple-Entwicklerkonto nötig.

## Widget (Home- und Sperrbildschirm)

1. Die kostenlose App **Scriptable** laden.
2. In Alltag auf **Profil → Widget-Skript kopieren** tippen.
3. In Scriptable auf **+** tippen, das Skript einfügen und als „Alltag“ speichern.
4. Auf dem Home-Bildschirm lange drücken → **+** → Scriptable und eine Größe wählen. Danach das Widget bearbeiten und bei *Script* „Alltag“ auswählen.

## Test

```powershell
npm test
```
