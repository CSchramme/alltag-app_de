// Alltag – Widget für Scriptable (iOS, kostenlos im App Store).
// Startbildschirm: klein, mittel, groß · Sperrbildschirm: rechteckig, inline.
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

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const min = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const now = new Date(), today = iso(now), nm = now.getHours() * 60 + now.getMinutes();
const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function dayLabel(s) {
  const [y, m, d] = s.split('-').map(Number), dt = new Date(y, m - 1, d);
  const n = Math.round((dt - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  return n === 0 ? 'Heute' : n === 1 ? 'Morgen' : `${WD[dt.getDay()]}, ${d}.${m}.`;
}
const COLORS = ['#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FF3B30', '#FF9500', '#34C759', '#00C7BE', '#30B0C7', '#32ADE6', '#A2845E'];
const colorOf = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return new Color(COLORS[h % COLORS.length]); };
const LABEL = new Color('#000000', 0.9), LABEL2 = new Color('#3C3C43', 0.64), ORANGE = new Color('#FF9500'), BLUE = new Color('#007AFF'), PURPLE = new Color('#AF52DE');

// Tagesablauf: Stunden + eigene Termine mit Uhrzeit
function agenda(D, date) {
  const lessons = (D.snap?.days.find((d) => d.date === date)?.lessons || []).filter((l) => l.start && !l.cancelled)
    .map((l) => ({ title: l.subject, start: l.start, end: l.end, sub: [l.rooms.join(', '), l.teachers.join(', ')].filter(Boolean).join(' · '), color: colorOf(l.subject), alert: l.changes.join(' · ') }));
  const events = D.db.events.filter((e) => e.date === date && e.start)
    .map((e) => ({ title: e.title, start: e.start, end: e.end || '', sub: e.location, color: PURPLE, alert: '' }));
  return [...lessons, ...events].sort((a, b) => a.start.localeCompare(b.start));
}
const endOf = (a) => (a.end ? min(a.end) : min(a.start) + 60);

function focus(D) {
  const items = agenda(D, today);
  const cur = items.find((a) => min(a.start) <= nm && nm < endOf(a));
  if (cur) return { kicker: `Jetzt · bis ${cur.end || ''}`.trim(), a: cur };
  const next = items.find((a) => min(a.start) > nm);
  if (next) { const m = min(next.start) - nm; return { kicker: m <= 90 ? `In ${m} Min.` : `Ab ${next.start}`, a: next }; }
  for (let i = 1; i < 7; i++) {
    const d = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)), a = agenda(D, d)[0];
    if (a) return { kicker: `${dayLabel(d)} ab ${a.start}`, a };
  }
  return null;
}
const changes = (D) => (D.snap?.days || []).filter((d) => d.date >= today).flatMap((d) => d.changes.map((c) => ({ ...c, date: d.date })));
const due = (D) => [
  ...(D.snap?.tasks || []).filter((t) => t.kind !== 'event' && !t.done && t.due && t.due <= tomorrow).map((t) => ({ title: t.subject || t.label, meta: t.title, exam: t.kind === 'exam', due: t.due })),
  ...D.db.reminders.filter((r) => !r.done && r.due && r.due <= tomorrow).map((r) => ({ title: r.title, meta: r.time || dayLabel(r.due), exam: false, due: r.due, own: true })),
].sort((a, b) => a.due.localeCompare(b.due));

function text(stack, str, size, { weight = 'regular', color = LABEL, lines = 1 } = {}) {
  const t = stack.addText(str);
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semibold' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = lines;
  t.minimumScaleFactor = 0.8;
  return t;
}

function focusBlock(stack, D, big) {
  const f = focus(D);
  if (!f) { text(stack, 'Nichts geplant', big ? 18 : 15, { weight: 'semibold', lines: 2 }); return; }
  text(stack, f.kicker.toUpperCase(), 11, { weight: 'semibold', color: f.a.alert ? ORANGE : f.a.color });
  stack.addSpacer(2);
  text(stack, f.a.title, big ? 22 : 19, { weight: 'bold', lines: 2 });
  if (f.a.sub) text(stack, f.a.sub, 12, { color: LABEL2 });
  if (f.a.alert) text(stack, f.a.alert, 12, { weight: 'semibold', color: ORANGE, lines: 2 });
}

function listBlock(stack, title, rows, max) {
  if (!rows.length) return;
  text(stack, title.toUpperCase(), 11, { weight: 'semibold', color: LABEL2 });
  stack.addSpacer(4);
  for (const r of rows.slice(0, max)) {
    const row = stack.addStack();
    row.centerAlignContent();
    const dot = row.addStack();
    dot.size = new Size(7, 7);
    dot.cornerRadius = 3.5;
    dot.backgroundColor = r.color;
    row.addSpacer(6);
    text(row, r.text, 13, { weight: 'semibold' });
    row.addSpacer(4);
    text(row, r.meta || '', 12, { color: LABEL2 });
    stack.addSpacer(4);
  }
}

function build(D, family) {
  const w = new ListWidget();
  w.url = SERVER;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);
  const ch = changes(D), dueList = due(D), f = focus(D);

  if (family === 'accessoryInline') {
    w.addText(f ? `${f.a.title} · ${f.kicker}${ch.length ? ` · ⚠︎${ch.length}` : ''}` : 'Nichts geplant');
    return w;
  }
  if (family === 'accessoryRectangular') {
    const t = (s, bold) => { const x = w.addText(s); x.font = bold ? Font.boldSystemFont(14) : Font.systemFont(12); x.lineLimit = 1; };
    if (!f) { t('Nichts geplant', true); return w; }
    t(f.kicker, false);
    t(f.a.title, true);
    t(ch.length ? `${ch.length} Vertretung${ch.length > 1 ? 'en' : ''}` : f.a.sub || `${dueList.length} fällig`, false);
    return w;
  }

  const g = new LinearGradient();
  g.colors = [new Color('#F5F8FE'), new Color('#E8EEFB')];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 15, 14, 15);

  const subRows = ch.map((c) => ({ color: c.kind === 'cancel' ? new Color('#FF3B30') : ORANGE, text: c.label ? `${c.label} ${c.text}` : c.text, meta: dayLabel(c.date) }));
  const dueRows = dueList.map((x) => ({ color: x.exam ? new Color('#FF3B30') : x.own ? PURPLE : colorOf(x.title), text: x.title, meta: x.meta }));
  const todayRows = agenda(D, today).filter((a) => endOf(a) > nm).map((a) => ({ color: a.color, text: `${a.start} ${a.title}`, meta: a.sub }));

  if (family === 'small') {
    focusBlock(w, D, false);
    w.addSpacer();
    const foot = ch.length ? `⚠︎ ${ch.length} Vertretung${ch.length > 1 ? 'en' : ''}` : dueList.length ? `${dueList.length} fällig` : 'Alles ruhig';
    text(w, foot, 12, { weight: 'semibold', color: ch.length ? ORANGE : BLUE });
  } else if (family === 'medium') {
    const row = w.addStack();
    const left = row.addStack();
    left.layoutVertically();
    left.size = new Size(130, 0);
    focusBlock(left, D, false);
    left.addSpacer();
    row.addSpacer(12);
    const right = row.addStack();
    right.layoutVertically();
    if (subRows.length) listBlock(right, 'Vertretungen', subRows, 3);
    else if (dueRows.length) listBlock(right, 'Fällig', dueRows, 4);
    else listBlock(right, 'Heute noch', todayRows, 4);
    right.addSpacer();
  } else {
    text(w, 'Alltag', 13, { weight: 'semibold', color: LABEL2 });
    w.addSpacer(6);
    focusBlock(w, D, true);
    w.addSpacer(12);
    listBlock(w, 'Vertretungen', subRows, 3);
    if (subRows.length) w.addSpacer(8);
    listBlock(w, 'Fällig', dueRows, 3);
    if (dueRows.length) w.addSpacer(8);
    listBlock(w, 'Heute noch', todayRows, 4);
    w.addSpacer();
  }
  if (D.offline) text(w, 'Offline · letzter Stand', 10, { color: LABEL2 });
  return w;
}

let widget;
try {
  widget = build(await load(), config.widgetFamily || 'medium');
} catch (e) {
  widget = new ListWidget();
  widget.addText('Alltag').font = Font.boldSystemFont(15);
  widget.addText(`Keine Verbindung: ${e.message}`).font = Font.systemFont(12);
}
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
