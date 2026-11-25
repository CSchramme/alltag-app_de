'use strict';
// Abo-Pläne: vorbereitet, noch nicht kaufbar und für Nutzer unsichtbar (nur in der Verwaltung). Endpreise in Euro.
// Kostenlos bleibt alles für den Schultag. Pro bekommt, was Speicher oder Rechenzeit kostet oder einfach besonders ist.
const FEATURES = {
  photos: 'Tafelbilder', homeworkPhotos: 'Fotos an Hausaufgaben', calendars: 'Private Kalender (Google, iCloud, Outlook)',
  calendar: 'Kalender-Abo', wallpaper: 'Stundenplan als Sperrbildschirm', designs: 'Exklusive Designs', scanner: 'Hausaufgaben-Scanner (KI)',
};
const SOON = ['homeworkPhotos', 'designs', 'scanner']; // geplant, noch nicht gebaut
const ALL = Object.keys(FEATURES);
const PLANS = {
  free: { name: 'Kostenlos', month: 0, year: 0, accounts: 1, features: [] },
  pro: { name: 'Pro', month: 2.49, year: 19.99, accounts: 1, features: ALL },
  familie: { name: 'Familie', month: 4.99, year: 39.99, accounts: 5, features: ALL }, // bis zu 5 Konten einer Familie (Verknüpfen kommt später)
};
module.exports = { PLANS, FEATURES, SOON };
