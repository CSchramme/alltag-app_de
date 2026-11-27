'use strict';
// Neuigkeiten, die die App nach einem Update einmal zeigt (neuester Eintrag zuerst).
// Version 26.x.y: Jahr (26 = 2026), x = Update mit Neuem, y = nur Fehlerbehebungen. Bei jedem sichtbaren Update erhöhen und oben ergänzen.
// Punkte: Text oder { text, kind, need }. kind = neu (Standard) | besser | fix | familie (Symbol und Farbe in der App),
// need: nur zeigen, wenn das Konto es hat ('family' = in einer Familie).
module.exports = [
  { version: '26.6.0', date: '2026-11-27', items: [
    { text: 'Nach jedem Update zeigt Alltag hier, was neu ist. Später findest du das im Profil ganz unten.', kind: 'neu' },
    { text: 'Auf Wunsch bekommst du bei jedem Update eine kurze Mail (Profil → Beta-Test).', kind: 'neu' },
    { text: 'Eltern-Zugang: Deine Elternnachrichten sind sichtbar, und Probleme beim Abgleich stehen direkt beim Kind.', kind: 'besser' },
    { text: 'Familie: neue Übersicht mit einem Platz je Mitglied. Ein freier Platz öffnet das Einladen.', kind: 'familie', need: 'family' },
    { text: 'Eingaben in Fenstern gehen nicht mehr verloren: Solange du tippst, schließt sich ein Fenster beim Scrollen nicht mehr.', kind: 'fix' },
  ] },
  { version: '26.5.0', date: '2026-11-26', items: [
    { text: 'Eltern-Zugang der Schule: Eltern sehen Stundenplan, Vertretungen und Hausaufgaben ihrer Kinder (Profil → Kinder).', kind: 'familie' },
    { text: 'Familien-Plan: bis zu 5 Konten, Einladen per Mail.', kind: 'familie', need: 'family' },
  ] },
  { version: '26.4.0', date: '2026-11-25', items: ['Kalender auch als Monatsansicht, Stundenplan drucken oder als PDF sichern.', { text: 'Prüfungs-Countdown auf „Heute“.', kind: 'besser' }] },
  { version: '26.3.0', date: '2026-11-24', items: ['EduPage-Umfragen direkt in Alltag beantworten.', 'Beta-Test: Fehler und Ideen direkt im Profil melden.'] },
];
