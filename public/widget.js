// Alltag – Tagesplan-Widget für Scriptable (iOS, kostenlos im App Store).
// Startbildschirm: klein, mittel, groß · Sperrbildschirm: rechteckig, rund, Zeile. Hell/Dunkel wie das iPhone.
// Einrichten: in Alltag → Profil → „Widget-Skript kopieren“ → in Scriptable einfügen.
const SERVER = '__SERVER__';
const TOKEN = '__TOKEN__';

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), 'alltag-widget.json');

async function load() {
  try {
    const r = new Request(`${SERVER}/api/data`);
    r.headers = { Authorization: `Bearer ${TOKEN}` };
    r.timeoutInterval = 15;
    const d = await r.loadJSON();
    if (!d.db) throw new Error(d.error || 'Keine Daten');
    fm.writeString(cachePath, JSON.stringify(d));
    return d;
  } catch (e) {
    if (fm.fileExists(cachePath)) return Object.assign(JSON.parse(fm.readString(cachePath)), { offline: true });
    throw e;
  }
}

/* ---------------------------------------------------------------- Zeit */
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (s) => new Date(`${s}T12:00:00`);
const addDays = (s, n) => { const d = day(s); d.setDate(d.getDate() + n); return iso(d); };
const min = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const now = new Date(), today = iso(now), nm = now.getHours() * 60 + now.getMinutes();
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];

// Wiederholung wie in der App (public/recur.js)
function occursOn(item, date) {
  const start = item.date || item.due;
  if (!start || date < start || (item.until && date > item.until)) return false;
  if (date === start) return true;
  const a = day(start), b = day(date), diff = Math.round((b - a) / 864e5);
  return { daily: true, weekdays: b.getDay() % 6 !== 0, weekly: diff % 7 === 0, biweekly: diff % 14 === 0, monthly: b.getDate() === a.getDate() }[item.repeat] || false;
}

/* ---------------------------------------------------------------- Farben (hell/dunkel automatisch) */
const dyn = (light, dark) => Color.dynamic(new Color(light[0], light[1] ?? 1), new Color(dark[0], dark[1] ?? 1));
const LABEL = dyn(['#000000', 0.9], ['#FFFFFF', 0.94]), LABEL2 = dyn(['#3C3C43', 0.6], ['#EBEBF5', 0.6]), LABEL3 = dyn(['#3C3C43', 0.3], ['#EBEBF5', 0.3]);
const RED = dyn(['#FF3B30'], ['#FF453A']), ORANGE = dyn(['#FF9500'], ['#FF9F0A']), BLUE = dyn(['#007AFF'], ['#0A84FF']), PURPLE = dyn(['#AF52DE'], ['#BF5AF2']);
const PALETTE = [['#007AFF', '#0A84FF'], ['#5856D6', '#5E5CE6'], ['#AF52DE', '#BF5AF2'], ['#FF2D55', '#FF375F'], ['#FF3B30', '#FF453A'], ['#FF9500', '#FF9F0A'],
  ['#34C759', '#30D158'], ['#00C7BE', '#63E6E2'], ['#30B0C7', '#40C8E0'], ['#32ADE6', '#64D2FF'], ['#A2845E', '#AC8E68']];
const colorOf = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; const [l, d] = PALETTE[h % PALETTE.length]; return dyn([l], [d]); };

/* ---------------------------------------------------------------- Tagesplan */
// Stunden + eigene Termine eines Tages; Ganztägiges (Feiertag, Ferientag) separat
function plan(D, date) {
  const lessons = D.snap?.days.find((d) => d.date === date)?.lessons || [];
  const allday = lessons.filter((l) => l.allday).map((l) => l.subject);
  const items = lessons.filter((l) => !l.allday && l.start).map((l) => ({
    start: l.start, end: l.end, title: l.subject, color: colorOf(l.subject), cancelled: l.cancelled,
    sub: l.cancelled ? 'Entfällt' : l.changes?.length ? l.changes.join(' · ') : [l.rooms.join(', '), l.teachers[0]].filter(Boolean).join(' · '),
    changed: !l.cancelled && l.changes?.length > 0,
  }));
  for (const e of D.db.events.filter((x) => occursOn(x, date))) {
    if (!e.start) allday.push(e.title);
    else items.push({ start: e.start, end: e.end || '', title: e.title, color: PURPLE, sub: e.location || '', cancelled: false, changed: false });
  }
  return { allday, items: items.sort((a, b) => a.start.localeCompare(b.start)) };
}
const endOf = (i) => (i.end ? min(i.end) : min(i.start) + 60);

// Heute, solange noch etwas kommt – sonst der nächste Tag mit Einträgen
function pickDay(D) {
  const t = plan(D, today), rest = t.items.filter((i) => endOf(i) > nm);
  if (rest.length) return { date: today, allday: t.allday, items: rest, isToday: true };
  for (let n = 1; n <= 7; n++) {
    const d = addDays(today, n), p = plan(D, d);
    if (p.items.length || p.allday.length) return { date: d, ...p, isToday: false };
  }
  return { date: today, allday: t.allday, items: [], isToday: true };
}
const dayTitle = (d) => (d === today ? 'Heute' : d === addDays(today, 1) ? 'Morgen' : WD[day(d).getDay()]);

function countdown(D) {
  const list = D.holidays || [], off = (d) => list.some((h) => h.start <= d && d <= h.end);
  if (list.some((h) => h.start <= today && today <= h.end)) return 'Ferien';
  const next = list.find((h) => h.start > today && (day(h.end) - day(h.start)) / 864e5 >= 2);
  if (!next) return '';
  let n = 0;
  for (let d = today; d < next.start; d = addDays(d, 1)) if (day(d).getDay() % 6 && !off(d)) n++;
  return `${n} Schultage bis ${next.name}`;
}

/* ---------------------------------------------------------------- Bausteine */
function text(stack, str, size, { weight = 'regular', color = LABEL, lines = 1, opacity = 1 } = {}) {
  const t = stack.addText(String(str));
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semibold' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.textOpacity = opacity;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.75;
  return t;
}

// Eine Zeile wie im Kalender-Widget: Zeit · Farbbalken · Titel/Ort
function row(stack, i, { compact = false, isToday = false } = {}) {
  const cur = isToday && !i.cancelled && min(i.start) <= nm && nm < endOf(i); // läuft gerade
  const r = stack.addStack();
  r.centerAlignContent();
  r.spacing = 6;
  const time = r.addStack();
  time.layoutVertically();
  time.size = new Size(compact ? 34 : 38, 0);
  text(time, i.start, compact ? 11 : 12, { weight: 'semibold', color: cur ? BLUE : LABEL, opacity: i.cancelled ? 0.45 : 1 });
  if (!compact && i.end) text(time, i.end, 10, { color: LABEL2, opacity: i.cancelled ? 0.45 : 1 });
  const bar = r.addStack();
  bar.size = new Size(3, compact ? 14 : 26);
  bar.cornerRadius = 1.5;
  bar.backgroundColor = i.cancelled ? RED : i.changed ? ORANGE : i.color;
  const body = r.addStack();
  body.layoutVertically();
  text(body, i.title, compact ? 12 : 13, { weight: 'semibold', opacity: i.cancelled ? 0.45 : 1 });
  if (!compact && i.sub) text(body, i.sub, 11, { color: i.cancelled ? RED : i.changed ? ORANGE : LABEL2, weight: i.cancelled || i.changed ? 'semibold' : 'regular' });
  r.addSpacer();
}

function header(stack, p, big) {
  const d = day(p.date);
  text(stack, (p.isToday ? WD[d.getDay()] : dayTitle(p.date)).toUpperCase(), big ? 12 : 11, { weight: 'semibold', color: RED });
  text(stack, big ? `${d.getDate()}. ${MON[d.getMonth()]}` : String(d.getDate()), big ? 22 : 30, { weight: 'bold' });
}

/* ---------------------------------------------------------------- Widgets */
function build(D, family) {
  const w = new ListWidget();
  w.url = `${SERVER}/#kalender`;
  const p = pickDay(D), next = p.items.find((i) => !i.cancelled);
  // nach der nächsten Stunde neu zeichnen (iOS entscheidet am Ende selbst, wann)
  const bound = p.isToday && next ? Math.min(...p.items.map((i) => [min(i.start), endOf(i)]).flat().filter((m) => m > nm)) : null;
  w.refreshAfterDate = new Date(Date.now() + Math.min(15, bound ? bound - nm + 1 : 15) * 60e3);

  if (family === 'accessoryInline') {
    w.addText(next ? `${next.start} ${next.title}${next.sub && !next.changed ? ` · ${next.sub.split(' · ')[0]}` : ''}` : 'Nichts geplant');
    return w;
  }
  if (family === 'accessoryCircular') {
    const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
    text(s, next ? next.start : '–', 13, { weight: 'semibold' });
    text(s, next ? next.title.slice(0, 4) : '', 10);
    return w;
  }
  if (family === 'accessoryRectangular') {
    if (!p.items.length) { text(w, p.allday[0] || 'Nichts geplant', 13, { weight: 'semibold' }); return w; }
    for (const i of p.items.slice(0, 2)) {
      text(w, `${i.start} ${i.title}`, 13, { weight: 'semibold', opacity: i.cancelled ? 0.5 : 1 });
      if (i === p.items[0]) text(w, i.sub || dayTitle(p.date), 11);
    }
    return w;
  }

  const g = new LinearGradient();
  g.colors = [dyn(['#FFFFFF'], ['#1C1C1E']), dyn(['#F2F4F9'], ['#141416'])];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);

  if (family === 'small') {
    header(w, p, false);
    w.addSpacer(4);
    if (p.allday.length) text(w, p.allday[0], 11, { weight: 'semibold', color: PURPLE });
    if (!p.items.length) text(w, 'Keine Stunden', 12, { color: LABEL2 });
    for (const i of p.items.slice(0, p.allday.length ? 2 : 3)) { row(w, i, { compact: true, isToday: p.isToday }); w.addSpacer(3); }
    w.addSpacer();
    return w;
  }

  if (family === 'medium') {
    const main = w.addStack();
    const left = main.addStack();
    left.layoutVertically();
    left.size = new Size(78, 0);
    header(left, p, false);
    left.addSpacer();
    const cd = countdown(D);
    if (cd) text(left, cd, 10, { color: LABEL2, lines: 3 });
    main.addSpacer(10);
    const right = main.addStack();
    right.layoutVertically();
    if (p.allday.length) { text(right, p.allday.join(' · '), 11, { weight: 'semibold', color: PURPLE }); right.addSpacer(4); }
    if (!p.items.length) text(right, 'Keine Stunden oder Termine', 13, { color: LABEL2 });
    for (const i of p.items.slice(0, p.allday.length ? 3 : 4)) { row(right, i, { isToday: p.isToday }); right.addSpacer(5); }
    right.addSpacer();
    return w;
  }

  // groß: ganzer restlicher Tag, darunter Fälliges und Ferien-Countdown
  header(w, p, true);
  w.addSpacer(8);
  if (p.allday.length) { text(w, p.allday.join(' · '), 12, { weight: 'semibold', color: PURPLE }); w.addSpacer(6); }
  if (!p.items.length) text(w, 'Keine Stunden oder Termine', 13, { color: LABEL2 });
  for (const i of p.items.slice(0, 7)) { row(w, i, { isToday: p.isToday }); w.addSpacer(5); }
  const due = [...(D.snap?.tasks || []).filter((t) => !t.done && t.due && t.due <= addDays(today, 1)).map((t) => `${t.subject || t.label}: ${t.title}`),
    ...D.db.reminders.filter((r) => !r.done && r.due && r.due <= addDays(today, 1)).map((r) => r.title)];
  w.addSpacer();
  if (due.length) {
    text(w, 'FÄLLIG', 11, { weight: 'semibold', color: LABEL2 });
    for (const d of due.slice(0, 2)) text(w, d, 12);
    w.addSpacer(4);
  }
  const cd = countdown(D);
  if (cd || D.offline) text(w, [cd, D.offline ? 'Offline · letzter Stand' : ''].filter(Boolean).join(' · '), 10, { color: LABEL3 });
  return w;
}

let widget;
try {
  widget = build(await load(), config.widgetFamily || 'medium');
} catch (e) {
  widget = new ListWidget();
  text(widget, 'Alltag', 15, { weight: 'bold' });
  text(widget, `Keine Verbindung: ${e.message}`, 12, { color: LABEL2, lines: 3 });
}
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
