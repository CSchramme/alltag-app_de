'use strict';
// Beispieldaten im Format von snapshot() – zum Ausprobieren ohne EduPage (DEMO=1, Passwort "demo").
const { isoDay, addDays } = require('./edupage');

const TIMES = [['07:50', '08:35'], ['08:40', '09:25'], ['09:45', '10:30'], ['10:35', '11:20'], ['11:40', '12:25'], ['12:30', '13:15'], ['13:45', '14:30']];
const T = {
  Mathematik: ['Hr. Becker', '104'], Deutsch: ['Fr. Schneider', '104'], Englisch: ['Fr. Weber', '204'], Biologie: ['Hr. Wolf', 'NW2'],
  Geschichte: ['Fr. Klein', '112'], Physik: ['Hr. Hoffmann', 'NW1'], Sport: ['Hr. Schulz', 'Halle'], Kunst: ['Fr. Lange', 'K1'],
  Chemie: ['Fr. Braun', 'NW3'], Informatik: ['Hr. Krüger', 'PC1'],
};
const WEEK = [null,
  ['Mathematik', 'Mathematik', 'Englisch', 'Deutsch', 'Biologie', 'Geschichte'],
  ['Deutsch', 'Englisch', 'Physik', 'Physik', 'Sport', 'Sport', 'Kunst'],
  ['Chemie', 'Mathematik', 'Geschichte', 'Englisch', 'Informatik', 'Informatik'],
  ['Biologie', 'Deutsch', 'Mathematik', 'Kunst', 'Kunst', 'Englisch'],
  ['Englisch', 'Chemie', 'Deutsch', 'Mathematik', 'Physik'],
];

function snapshot(now = new Date()) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(now, i);
    if (!WEEK[d.getDay()]) continue;
    const n = days.length;
    const changes = n === 0 ? [{ periods: [3], label: '3.', text: 'Englisch – Entfall', kind: 'cancel', class: '8b' }]
      : n === 1 ? [{ periods: [3, 4], label: '3.–4.', text: 'Physik: Hr. Hoffmann ➔ Fr. Braun, Raum NW3', kind: 'change', class: '8b' }] : [];
    const lessons = WEEK[d.getDay()].map((subject, i) => {
      const ch = changes.filter((c) => c.periods.includes(i + 1)).map((c) => c.text);
      return {
        period: i + 1, start: TIMES[i][0], end: TIMES[i][1], subject, short: subject.slice(0, 2),
        teachers: [ch[0]?.includes('Braun') ? 'Fr. Braun' : T[subject][0]], rooms: [ch[0]?.includes('NW3') ? 'NW3' : T[subject][1]],
        groups: [], topic: subject === 'Mathematik' ? 'Lineare Funktionen' : null,
        cancelled: !!ch[0]?.includes('Entfall'), event: false, online: null, changes: ch,
      };
    });
    days.push({ date: isoDay(d), lessons, changes });
  }
  const school = (n) => days[Math.min(n, days.length - 1)].date;
  const ago = (h) => new Date(now - h * 3600e3).toISOString();
  const task = (id, kind, label, subject, title, due, author, done = false) => ({ id, kind, label, subject, title, due, created: ago(40), author, done });
  return {
    updated: now.toISOString(),
    student: { name: 'Alex Beispiel', class: '8b' },
    days,
    tasks: [
      task('h1', 'homework', 'Hausaufgabe', 'Mathematik', 'Buch S. 84, Nr. 3 a–f und Nr. 5. Rechenweg bitte vollständig aufschreiben.', school(0), 'Hr. Becker'),
      task('h2', 'homework', 'Hausaufgabe', 'Englisch', 'Vokabeln Unit 4 lernen (S. 212–214)', school(1), 'Fr. Weber'),
      task('h3', 'homework', 'Hausaufgabe', 'Deutsch', 'Erörterung zum Thema „Handyverbot an Schulen“ fertigstellen', school(3), 'Fr. Schneider'),
      task('e1', 'exam', 'Klassenarbeit', 'Mathematik', 'Klassenarbeit Nr. 2 – Lineare Funktionen', school(4), 'Hr. Becker'),
      task('e2', 'exam', 'Test', 'Chemie', 'Kurztest Atombau', school(2), 'Fr. Braun'),
    ],
    messages: [
      { id: 'm1', kind: 'message', author: 'Fr. Schneider', time: ago(1.5), attachments: [], last: ago(1),
        text: 'Liebe 8b,\nmorgen bitte unbedingt die Lektüre „Tschick“ mitbringen. Wir beginnen mit der Analyse des dritten Kapitels.\n\nViele Grüße\nS. Schneider',
        likes: 3, liked: false,
        replies: [{ id: 'm1r', kind: 'message', author: 'Alex Beispiel', text: 'Alles klar, danke!', time: ago(1), replies: [], attachments: [] }] },
      { id: 'm2', kind: 'news', author: 'Schulleitung', time: ago(26), replies: [], important: true, confirmed: null, likes: 0, attachments: [{ name: 'Elternbrief_Sprechtag.pdf', url: '#' }],
        text: 'Der Elternsprechtag findet am Donnerstag ab 15 Uhr statt. Die Anmeldung ist ab sofort über das Sekretariat möglich.' },
      { id: 'm3', kind: 'message', author: 'Hr. Schulz', time: ago(52), replies: [], attachments: [], text: 'Sport findet diese Woche draußen statt – bitte an wetterfeste Kleidung denken.' },
    ],
    missing: [{ id: 'x1', title: 'Arbeitsblatt Zellatmung', subject: 'Biologie', date: isoDay(addDays(now, -3)), comment: '' }],
    people: [...new Set(Object.values(T).map(([name]) => name))].map((name, i) => ({ id: `-${i + 1}`, name })),
    errors: [],
  };
}

// eigene Einträge, die beim ersten Demo-Start angelegt werden
function db(now = new Date()) {
  const day = (n) => isoDay(addDays(now, n));
  const id = (s) => `demo-${s}`;
  return {
    reminders: [
      { id: id('r1'), title: 'Sportsachen waschen', notes: '', due: day(0), time: '18:00', category: 'privat', subject: '', done: false },
      { id: id('r2'), title: 'Geschenk für Mama besorgen', notes: 'Buch oder Konzertkarten?', due: day(3), time: '', category: 'privat', subject: '', done: false },
      { id: id('r3'), title: 'Referat Folien fertig machen', notes: '', due: day(2), time: '', category: 'schule', subject: 'Biologie', done: false },
    ],
    events: [
      { id: id('t1'), title: 'Fußballtraining', date: day(0), start: '17:00', end: '18:30', location: 'Sportplatz', notes: '', category: 'privat' },
      { id: id('t2'), title: 'Zahnarzt', date: day(2), start: '15:15', end: '16:00', location: 'Praxis Dr. Sommer', notes: '', category: 'privat' },
      { id: id('t3'), title: 'Kino mit Ben', date: day(5), start: '19:30', end: '', location: '', notes: '', category: 'privat' },
    ],
    notes: [
      { id: id('n1'), title: 'Mathe: Formeln', body: 'Steigung m = (y2 − y1) / (x2 − x1)\nGerade: y = m·x + b', subject: 'Mathematik', pinned: true, updated: now.toISOString() },
      { id: id('n2'), title: 'Einkaufsliste', body: 'Hefte A4 kariert\nTextmarker\nUSB-Stick', subject: '', pinned: false, updated: now.toISOString() },
    ],
    grades: [
      { id: id('g1'), subject: 'Mathematik', value: '2', weight: 2, title: 'Klassenarbeit Nr. 1', date: day(-24) },
      { id: id('g2'), subject: 'Mathematik', value: '3+', weight: 1, title: 'Test Brüche', date: day(-7) },
      { id: id('g3'), subject: 'Englisch', value: '1-', weight: 1, title: 'Vokabeltest', date: day(-5) },
      { id: id('g4'), subject: 'Deutsch', value: '2-', weight: 2, title: 'Klassenarbeit Nr. 1', date: day(-12) },
    ],
  };
}

module.exports = { snapshot, db };
