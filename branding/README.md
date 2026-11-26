# Alltag – Markenauftritt

**Slogan:** Kalender, Stundenplan, Hausaufgaben. Alles in einer App.

**Logo „Tagesbogen“:** Der Bogen ist der Tag von früh bis spät, der Punkt steht für „jetzt“. Der kräftige Teil des Bogens ist der Teil des Tages, der schon vorbei ist.

## Dateien

| Datei | Wofür |
|---|---|
| `alltag-logo.png` | Logo mit Schriftzug, dunkle Schrift – für helle Flächen (Plakat, Folien) |
| `alltag-logo-weiss.png` | Logo mit Schriftzug, weiße Schrift – für dunkle Flächen |
| `alltag-icon.svg`, `alltag-icon-2048.png` | Icon allein, dunkel (Hauptvariante) |
| `alltag-icon-hell.svg`, `alltag-icon-hell-2048.png` | Icon allein, hell – für dunkle Fotos oder Hintergründe |

| `alltag-mail-logo.svg`, `alltag-mail-logo-1024.png` | Absender-Bild in Mail-Apps (randlos, wird rund ausgeschnitten); SVG = `public/bimi.svg` |

SVG lässt sich beliebig groß drucken, PNG reicht bis etwa 17 cm Breite bei 300 dpi.

## Logo neben den Mails (Absender-Bild)

Voraussetzungen erfüllt (Stand 26.11.2026): SPF `-all`, DKIM-Schlüssel `default`, DMARC `p=reject; pct=100`.

- **BIMI (kostenlos, nur Yahoo/AOL):** DNS-Eintrag `default._bimi.alltag-app.de` TXT `v=BIMI1; l=https://alltag-app.de/bimi.svg; a=`. Das SVG ist SVG Tiny PS (`baseProfile="tiny-ps"`, `<title>`, keine Skripte/Bilder/Links). Yahoo zeigt es erst bei genug Mails mit gutem Ruf.
- **Apple Mail (iPhone, iCloud Mail im Web):** Apple Business Connect → Branded Mail. Braucht eine von Apple geprüfte Organisation (D-U-N-S-Nummer oder z. B. Gewerbeschein), Domain-Bestätigung per TXT-Eintrag (14 Tage Zeit), Logo `alltag-mail-logo-1024.png`. Prüfung bis 7 Werktage.
- **Gmail:** nur BIMI mit Zertifikat (CMC ab ca. 650 $/Jahr, VMC mit eingetragener Marke) – vorerst nicht.
- Outlook zeigt keine Absender-Logos.

## Farben

| Name | Hex | Wofür |
|---|---|---|
| Morgenblau | `#2E6BF0` | Hauptfarbe, Schule, Knöpfe (weiße Schrift) |
| Abendrosa | `#FF5F86` | Privates, Geburtstage |
| Apricot | `#FFAE57` | Hinweise, Countdown |
| Minze | `#1FBF9F` | Erledigt, Lernzeit |
| Tinte | `#131A30` | Text, dunkle Flächen |
| Nebel | `#EEF1F8` | Hintergrund |

Auf Abendrosa, Apricot und Minze immer Tinte als Schriftfarbe, nie Weiß.

## Schrift

- **Outfit** (fett, 600/700) für Schriftzug und Überschriften
- **Inter** (400/600) für Fließtext und Zahlen

Beide kostenlos bei Google Fonts. In der App selbst bleibt die Systemschrift.

## Regeln

- Immer „Alltag“ schreiben, nicht ALLTAG oder alltag.
- Rund um das Icon mindestens ein Viertel seiner Breite frei lassen.
- Kleinste Größe: 24 px am Bildschirm, 8 mm im Druck.
- Icon nicht drehen, verzerren oder umfärben.
