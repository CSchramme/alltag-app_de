# Alltag

Schule und Privates an einem Ort, als Web-App im Stil von iOS Liquid Glass für iPhone und PC.

- **Schule (EduPage):** Stundenplan, Vertretungen, Hausaufgaben, Prüfungen und Nachrichten
- **Privat:** Erinnerungen, Termine und Notizen
- **Noten:** trägst du selbst ein; der Durchschnitt wird mit Gewichtung berechnet
- **Mitteilungen:** bei neuen Vertretungen und Nachrichten, zur Uhrzeit einer Erinnerung, 30 Minuten vor einem Termin und abends ein Ausblick auf morgen
- **Widget** für Home- und Sperrbildschirm über die kostenlose App Scriptable

```
app.js        Server und Startdatei für Plesk (Node.js ≥ 20, keine npm-Pakete nötig)
edupage.js    EduPage-Zugriff (übertragen aus der Python-Bibliothek edupage-api 0.13.3)
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
7. **Regelmäßiger Abgleich:** Plesk startet die App nur bei Bedarf. Kopiere unter **Profil → Plesk · geplante Aufgabe** die Adresse. Lege dann in Plesk unter *Geplante Aufgaben* → *Aufgabe hinzufügen* → **URL abrufen** eine Aufgabe mit dieser Adresse an, die **alle 15 Minuten** läuft (`*/15 * * * *`).

Wichtig: `data/` liegt außerhalb des Dokumentenstamms und darf nie in `public/` landen. Dort stehen dein EduPage-Passwort und deine Einträge, also gehört der Ordner in deine Datensicherung.

**Aktualisieren:** In Plesk unter *Git* auf „Pull“ und danach auf *App neu starten* klicken. Ein `npm install` ist nicht nötig, weil die App keine Pakete braucht.

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
