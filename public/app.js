'use strict';
/* Alltag – Schule (EduPage) und Privates. Kein Framework: Zustand → innerHTML, Bewegung über eigene Federn. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const NOW = new URLSearchParams(location.search).get('now'); // zum Testen: ?now=2026-11-16T09:10
const now = () => (NOW ? new Date(NOW) : new Date());

/* ---------------------------------------------------------------- Bewegung
   Federn nach Apple: Dämpfungsverhältnis + Response (s) statt Masse/Steifigkeit.
   Sie starten immer am aktuellen Wert mit aktueller Geschwindigkeit → jederzeit unterbrechbar. */
function spring({ from, to, velocity = 0, damping = 1, response = 0.4, onUpdate, onRest }) {
  let raf, last = performance.now();
  const s = { value: from, velocity, to, running: true, stop() { cancelAnimationFrame(raf); s.running = false; } };
  if (reduceMotion.matches) { s.value = to; s.velocity = 0; s.running = false; onUpdate(to); onRest?.(); return s; }
  const k = (2 * Math.PI / response) ** 2, c = 4 * Math.PI * damping / response;
  const step = (t) => {
    const dt = clamp((t - last) / 1000, 0, 0.05), n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    last = t;
    for (let i = 0; i < n; i++) { s.velocity += (-k * (s.value - s.to) - c * s.velocity) * h; s.value += s.velocity * h; }
    if (Math.abs(s.value - s.to) < 0.15 && Math.abs(s.velocity) < 4) {
      s.value = s.to; s.velocity = 0; s.running = false; onUpdate(s.value); onRest?.(); return;
    }
    onUpdate(s.value);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return s;
}

/* Geschwindigkeit aus den letzten ~80 ms – 0, wenn der Finger vor dem Loslassen stand */
function tracker() {
  const pts = [];
  return {
    add(v) { const t = performance.now(); pts.push([v, t]); while (pts.length > 2 && t - pts[0][1] > 80) pts.shift(); },
    velocity() {
      if (pts.length < 2 || performance.now() - pts.at(-1)[1] > 80) return 0;
      const [v0, t0] = pts[0], [v1, t1] = pts.at(-1);
      return t1 > t0 ? (v1 - v0) / (t1 - t0) * 1000 : 0;
    },
  };
}
const project = (v, d = 0.998) => (v / 1000) * d / (1 - d);              // wohin der Schwung trägt
const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

const hapticEl = $('.haptic');
const haptic = () => (navigator.vibrate ? navigator.vibrate(8) : hapticEl.click()); // iOS 18+: Schalter-Klick = Taptic

/* ---------------------------------------------------------------- Format */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : '#');
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMin = () => { const n = now(); return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60; };
const F = {
  long: new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }),
  wd: new Intl.DateTimeFormat('de-DE', { weekday: 'long' }),
  wdShort: new Intl.DateTimeFormat('de-DE', { weekday: 'short' }),
  short: new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }),
  date: new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }),
  full: new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
  time: new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }),
  rel: new Intl.RelativeTimeFormat('de', { numeric: 'auto' }),
  dayMonth: new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }),
  num: new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
};
const today = () => isoDay(now());
function dayName(iso) {
  const n = daysBetween(today(), iso);
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n === -1) return 'Gestern';
  return n > 1 && n < 7 ? F.wd.format(parseDay(iso)) : F.short.format(parseDay(iso));
}
function stamp(iso) { // wie in Mail: 14:32 · Gestern · Montag · 12.11.26
  const d = new Date(iso), n = daysBetween(isoDay(d), today());
  return n <= 0 ? F.time.format(d) : n === 1 ? 'Gestern' : n < 7 ? F.wd.format(d) : F.date.format(d);
}
function ago(iso) {
  if (!iso) return 'noch nie';
  const s = (new Date(iso) - now()) / 1000, a = Math.abs(s);
  if (a < 60) return 'gerade eben';
  if (a < 3600) return F.rel.format(Math.round(s / 60), 'minute');
  if (a < 86400) return F.rel.format(Math.round(s / 3600), 'hour');
  return F.rel.format(Math.round(s / 86400), 'day');
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
const PALETTE = ['blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'green', 'mint', 'teal', 'cyan', 'brown'];
const colorOf = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return `var(--${PALETTE[h % PALETTE.length]})`; };
const CAT = { privat: 'var(--purple)', schule: 'var(--blue)' };
const initials = (name) => {
  const w = String(name || '?').split(/\s+/).filter((x) => x && !x.endsWith('.'));
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w.at(-1)[0] : '')).toUpperCase();
};
const EXAM = /SchA|Schulaufgabe|Stegreif|\bEx\b|Klassenarbeit|Klausur|Test|\bPLN\b|Leistungsnachweis/i;
const room = (r) => (/^\d/.test(r) ? `Raum ${r}` : r);
const where = (l) => [l.rooms.map(room).join(', '), l.teachers.join(', ')].filter(Boolean).join(' · ');
const chip = (text, c, solid) => `<span class="chip${solid ? ' solid' : ''}" style="--c:${c}">${esc(text)}</span>`;
// "2+" → 1,75 · "3-" → 3,25 · "12" → 12
const gradeNum = (v) => { const m = String(v).trim().match(/^(\d+(?:[.,]\d+)?)\s*([+-]?)$/); return m ? parseFloat(m[1].replace(',', '.')) + ({ '+': -0.25, '-': 0.25 }[m[2]] || 0) : null; };
const average = (gs) => {
  const w = gs.map((g) => [gradeNum(g.value), Number(g.weight) || 0]).filter(([n, k]) => n != null && k > 0);
  const sum = w.reduce((a, [, k]) => a + k, 0);
  return sum ? w.reduce((a, [n, k]) => a + n * k, 0) / sum : null;
};

const ICON = {
  chev: '<svg class="chev" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6"/></svg>',
  cal: '<svg viewBox="0 0 44 44"><rect x="7" y="9" width="30" height="28" rx="7"/><path d="M7 17h30M15 5v7M29 5v7"/></svg>',
  check: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="15"/><path d="M15 22.5l4.5 4.5 9-10"/></svg>',
  bubble: '<svg viewBox="0 0 44 44"><path d="M22 8c8.3 0 15 5.8 15 13s-6.7 13-15 13c-1.7 0-3.3-.2-4.8-.7L10 37v-6.7C8 28 7 25 7 21 7 13.8 13.7 8 22 8z"/></svg>',
  cap: '<svg viewBox="0 0 44 44"><path d="M5 17l17-8 17 8-17 8z"/><path d="M12 21v8c0 2.5 4.5 5 10 5s10-2.5 10-5v-8"/></svg>',
  note: '<svg viewBox="0 0 44 44"><path d="M13 7h13l8 8v20a3 3 0 01-3 3H13a3 3 0 01-3-3V10a3 3 0 013-3z"/><path d="M26 7v8h8M16 23h12M16 29h8"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8"/></svg>',
  gift: '<svg viewBox="0 0 44 44"><rect x="8" y="17" width="28" height="8" rx="2"/><path d="M10 25v10a2 2 0 002 2h20a2 2 0 002-2V25M22 17v20M22 17c-3-6-10-6-10-1.5S19 17 22 17zm0 0c3-6 10-6 10-1.5S25 17 22 17z"/></svg>',
  camera: '<svg viewBox="0 0 44 44"><path d="M8 15a3 3 0 013-3h4l3-4h8l3 4h4a3 3 0 013 3v16a3 3 0 01-3 3H11a3 3 0 01-3-3z"/><circle cx="22" cy="23" r="6.5"/></svg>',
  timer: '<svg viewBox="0 0 44 44"><circle cx="22" cy="24" r="14"/><path d="M22 24v-7M18 6h8M22 6v4"/></svg>',
  cart: '<svg viewBox="0 0 44 44"><path d="M6 9h5l4 19h18l4-13H13"/><circle cx="17" cy="35" r="2"/><circle cx="31" cy="35" r="2"/></svg>',
  power: '<svg viewBox="0 0 44 44"><path d="M22 7v14M14 12a13 13 0 1016 0"/></svg>',
  play: '<svg viewBox="0 0 44 44"><path d="M15 10l19 12-19 12z"/></svg>',
  ticket: '<svg viewBox="0 0 44 44"><path d="M7 14a3 3 0 013-3h24a3 3 0 013 3v4a4 4 0 000 8v4a3 3 0 01-3 3H10a3 3 0 01-3-3v-4a4 4 0 000-8z"/><path d="M27 12v20" stroke-dasharray="2 3"/></svg>',
  screen: '<svg viewBox="0 0 44 44"><rect x="6" y="9" width="32" height="22" rx="3"/><path d="M16 37h12M22 31v6"/></svg>',
  pin: '<svg class="pin" viewBox="0 0 16 16"><path d="M10.5 1.5l4 4-2.5 1-3 3 .5 3.5-1 1L5 10.5 1.5 14l-.5-.5L4.5 10 1 6.5l1-1 3.5.5 3-3z"/></svg>',
};

/* ---------------------------------------------------------------- Zustand & Server */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privater Modus */ } },
};
const EMPTY = { days: [], tasks: [], messages: [], student: {} };
let D = null;
const S = () => D.snap || EMPTY;
let tab = 'heute';
let planDay = null;
// Kalenderwoche Mo–So; am Wochenende zeigt der Kalender schon die kommende Woche
const mondayOf = (iso) => addDays(iso, -((parseDay(iso).getDay() + 6) % 7));
let weekStart = null;
const defaultWeek = () => mondayOf(addDays(today(), [0, 6].includes(now().getDay()) ? 2 : 0));
const calWeek = () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
const extraDays = new Map(); // nachgeladene Tage anderer Wochen
const loadedWeeks = new Map();
let taskFilter = 'alle';
let schoolSeg = 'nachrichten';
let showDone = false;
let firstRead = store.get('read', null) === null; // erster Start: vorhandene Nachrichten gelten als gelesen
const read = new Set(store.get('read', []));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body && JSON.stringify(body),
  });
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw Object.assign(new Error('login'), { status: 401 }); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || res.statusText), { status: res.status });
  return json;
}

let loading = null;
function load(refresh = false) {
  loading ??= api(refresh ? '/api/refresh' : '/api/data', { method: refresh ? 'POST' : 'GET' })
    .then(setData)
    .catch((e) => { if (e.status !== 401 && !D) { boot('Server nicht erreichbar. Neuer Versuch in Kürze …'); setTimeout(load, 10000); } })
    .finally(() => { loading = null; });
  return loading;
}

function setData(d) {
  if (firstRead && d.snap) { d.snap.messages.forEach((m) => read.add(m.id)); store.set('read', [...read]); firstRead = false; }
  const first = !D;
  D = d;
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  weekStart ??= defaultWeek();
  if (!calWeek().includes(planDay)) planDay = calWeek().includes(today()) ? today() : weekStart;
  renderAll();
  if (first) { measureTabs(); lensSet(tabGeo[tabIndex(tab)][0]); route(); }
  if (first && ADMIN_PAGE) { if (D.account?.admin) openAdmin(); else location.replace('/'); }
}

function boot(msg) { $('#boot').hidden = false; $('#boot p').textContent = msg; }

function renderAll() {
  renderHeute(); renderKalender(); renderAufgaben(); renderNotizen(); renderSchule(); renderBadges();
  $('#me').textContent = initials(S().student?.name || D.account?.name || 'Ich');
  $('#subjects').innerHTML = subjects().map((s) => `<option value="${esc(s)}">`).join('');
  updateAdd();
}

/* ---------------------------------------------------------------- Abgeleitete Daten */
const week = () => Array.from({ length: 7 }, (_, i) => addDays(today(), i));
const dayOf = (iso) => S().days.find((d) => d.date === iso) || extraDays.get(iso);
const lessonsOn = (iso) => dayOf(iso)?.lessons || [];
const subjects = () => [...new Set([...S().days.flatMap((d) => d.lessons.map((l) => l.subject)), ...D.db.grades.map((g) => g.subject), ...D.db.reminders.map((r) => r.subject)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

// Alles an einem Tag in zeitlicher Reihenfolge: Ganztägiges und Stunden aus dem Stundenplan, eigene Termine
function agenda(date) {
  const items = [];
  lessonsOn(date).forEach((l, i) => items.push(l.allday
    ? { type: 'allday', start: '', t: { id: '', kind: 'event', label: 'Ganztägig', title: l.subject, subject: '' } }
    : { type: 'lesson', start: l.start, end: l.end, l, i }));
  D.db.events.filter((e) => Recur.occursOn(e, date)).forEach((e) => items.push({ type: 'event', start: e.start, end: e.end, e: { ...e, date } }));
  (D.db.birthdays || []).filter((b) => Recur.birthdayOn(b, date)).forEach((b) => items.push({ type: 'bday', start: '', b }));
  return items.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}
const endMin = (a) => (a.end ? toMin(a.end) : toMin(a.start) + 60);

// Schul-Aufgaben aus EduPage + eigene Erinnerungen in einer Liste
function tasks() {
  const edu = S().tasks.filter((t) => t.kind !== 'event').map((t) => ({
    key: `e:${t.id}`, src: 'edu', id: t.id, title: t.title, subject: t.subject, due: t.due, time: '', done: t.done, kind: t.kind, label: t.label, category: 'schule',
  }));
  const own = D.db.reminders.map((r) => ({
    key: `o:${r.id}`, src: 'own', id: r.id, title: r.title, subject: r.subject, due: r.due || null, time: r.time, done: r.done, kind: 'reminder', label: 'Erinnerung', category: r.category, repeat: r.repeat,
  }));
  return [...edu, ...own];
}
const dueSoon = () => { const h = addDays(today(), 1); return tasks().filter((x) => !x.done && x.due && x.due <= h); };

/* ---------------------------------------------------------------- Bausteine */
const largeTitle = (title, eyebrow) => `<header class="large-title"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1></header>`;
const section = (title, goto) => `<h2 class="section-title">${esc(title)}${goto ? `<button data-goto="${goto}">Alle</button>` : ''}</h2>`;
const emptyCard = (icon, text) => `<div class="card empty">${ICON[icon]}${esc(text)}</div>`;

function banners() {
  const out = [];
  if (D.account?.jury) out.push(['info', 'Jugend forscht Version · Full Access', 'Alle Funktionen sind freigeschaltet. Die Beispieldaten setzt der Betreiber nach der Vorstellung zurück.']);
  else if (D.demo) out.push(['info', 'Demo-Modus', 'Du siehst Beispieldaten.']);
  if (!navigator.onLine) out.push(['warn', 'Offline', 'Angezeigt wird der zuletzt geladene Stand.']);
  else if (D.link.connected && D.status?.ok === false) out.push(['warn', `${linkName()}-Abgleich fehlgeschlagen`, D.status.error || '']);
  if (D.school === 'none' && !D.demo) { if (!D.db.lessons?.length) out.push(['info', 'Noch kein Stundenplan', 'Tippe hier und trag deine Stunden einmal ein. Sie gelten dann jede Woche.', 'data-settings']); }
  else if (!D.link.connected) out.push(['info', `${linkName()} noch nicht verbunden`, 'Tippe hier, um Stundenplan, Vertretungen und Nachrichten zu holen.', 'data-settings']);
  return out.map(([k, t, s, attr]) => `<${attr ? `button ${attr}` : 'div'} class="card banner ${k}"><div><b>${esc(t)}</b>${esc(s)}</div></${attr ? 'button' : 'div'}>`).join('');
}

function lessonRow(l, date, i) {
  const isNow = date === today() && l.start && toMin(l.start) <= nowMin() && nowMin() < toMin(l.end);
  const changed = !l.cancelled && l.changes?.length > 0;
  const exam = l.event && EXAM.test(l.subject);
  const chips = [
    l.cancelled && chip('Entfall', 'var(--red)', true),
    changed && chip(l.changes.every((c) => c.startsWith('Raum')) ? 'Raumänderung' : 'Vertretung', 'var(--orange)', true),
    l.event && chip(exam ? 'Prüfung' : 'Termin', exam ? 'var(--red)' : 'var(--indigo)', true),
    l.homework?.length && chip('Hausaufgabe fällig', 'var(--blue)'),
  ].filter(Boolean).join('');
  return `<button class="row lesson${l.cancelled ? ' cancelled' : ''}${changed ? ' changed' : ''}${isNow ? ' now' : ''}" style="--c:${colorOf(l.subject)}" data-day="${date}" data-i="${i}">
    <div class="time"><b>${esc(l.start)}</b><span>${esc(l.end)}</span></div>
    <div class="bar"></div>
    <div class="main"><div class="title">${esc(l.subject)}</div>${where(l) ? `<div class="sub">${esc(where(l))}</div>` : ''}
      ${changed ? `<div class="change-text">${esc(l.changes.join(' · '))}</div>` : ''}
      ${chips ? `<div class="meta-line">${chips}</div>` : ''}</div>
    <div class="num">${l.period ?? ''}</div></button>`;
}
function eventRow(e) {
  const isNow = e.date === today() && e.start && toMin(e.start) <= nowMin() && nowMin() < endMin(e);
  const sub = [e.location, e.repeat && `↻ ${repeatLabel(e.repeat)}`].filter(Boolean).join(' · ');
  return `<button class="row lesson event${isNow ? ' now' : ''}${e.id === justAdded ? ' appear' : ''}" style="--c:${CAT[e.category] || CAT.privat}" data-event="${esc(e.id)}">
    <div class="time"><b>${esc(e.start || 'ganzt.')}</b><span>${esc(e.end)}</span></div>
    <div class="bar"></div>
    <div class="main"><div class="title">${esc(e.title)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
    <div class="num">${chip(e.category === 'schule' ? 'Schule' : 'Privat', CAT[e.category] || CAT.privat)}</div></button>`;
}
function alldayRow(t) {
  const c = t.kind === 'exam' ? 'var(--red)' : 'var(--indigo)';
  return `<button class="row lesson allday" style="--c:${c}"${t.id ? ` data-edu-task="${esc(t.id)}"` : ''}>
    <div class="time"><b>ganzt.</b></div><div class="bar"></div>
    <div class="main"><div class="title">${esc(t.title)}</div><div class="sub">${esc([t.label, t.subject].filter(Boolean).join(' · '))}</div></div></button>`;
}
function bdayRow(b, date) {
  const age = Recur.ageOn(b, date);
  return `<button class="row lesson allday" style="--c:var(--pink)" data-bday="${esc(b.id)}">
    <div class="time"><b>ganzt.</b></div><div class="bar"></div>
    <div class="main"><div class="title">${esc(b.name)}</div><div class="sub">Geburtstag${age ? ` · wird ${age}` : ''}</div></div></button>`;
}
function agendaList(date, items = agenda(date)) {
  let html = '', prev = null;
  for (const a of items) {
    if (a.type === 'lesson' && prev?.type === 'lesson' && prev.end && a.start) {
      const gap = toMin(a.start) - toMin(prev.end);
      if (gap >= 15) html += `<div class="break">${gap >= 40 ? 'Mittagspause' : 'Pause'} · ${gap} Min.</div>`;
    }
    html += a.type === 'lesson' ? lessonRow(a.l, date, a.i) : a.type === 'event' ? eventRow(a.e) : a.type === 'bday' ? bdayRow(a.b, date) : alldayRow(a.t);
    prev = a;
  }
  return html;
}

function changeRow(c, date) {
  const cancel = c.kind === 'cancel';
  return `<button class="row" data-plan-day="${date}">
    <div class="main"><div class="title">${esc(c.text)}</div>
      <div class="meta-line">${chip(dayName(date), 'var(--indigo)')}${c.label ? chip(`${c.label} Std.`, 'var(--teal)') : ''}${chip(cancel ? 'Entfall' : c.kind === 'add' ? 'Zusatz' : 'Vertretung', cancel ? 'var(--red)' : 'var(--orange)', true)}</div>
    </div>${ICON.chev}</button>`;
}

function dueText(x) {
  const n = daysBetween(today(), x.due), d = dayName(x.due);
  if (n < 0 && !x.done) return `${-n} ${n === -1 ? 'Tag' : 'Tage'} überfällig`;
  const day = n >= 0 && n < 2 ? d.toLowerCase() : d;
  return `${x.kind === 'homework' ? 'Fällig ' : ''}${x.kind === 'homework' ? day : d}${x.time ? `, ${x.time}` : ''}`;
}

function taskRow(x) {
  const c = x.subject ? colorOf(x.subject) : CAT[x.category];
  const n = x.due ? daysBetween(today(), x.due) : null;
  const cls = n === null || x.done ? '' : n < 0 ? 'late' : n <= 1 ? 'soon' : '';
  const kindChip = x.kind === 'exam' ? chip(x.label, 'var(--red)', true) : x.kind === 'study' ? chip('Lernen', 'var(--teal)', true)
    : x.src === 'own' && x.category === 'privat' ? chip('Privat', CAT.privat) : '';
  const rep = x.repeat ? `<span class="due">↻ ${esc(repeatLabel(x.repeat))}</span>` : '';
  return `<div class="row task${x.done ? ' done' : ''}${x.id === justAdded ? ' appear' : ''}" style="--c:${c}" data-key="${esc(x.key)}">
    <button class="check" role="checkbox" aria-checked="${x.done}" aria-label="${esc(x.title)} erledigt"></button>
    <button class="main" data-open-key="${esc(x.key)}">
      <div class="title clamp2">${esc(x.title)}</div>
      <div class="meta-line">${x.subject ? chip(x.subject, c) : ''}${kindChip}${x.due ? `<span class="due ${cls}">${esc(dueText(x))}</span>` : ''}${rep}</div>
    </button></div>`;
}

function msgRow(m) {
  const extra = [m.replies.length && `${m.replies.length} ${m.replies.length === 1 ? 'Antwort' : 'Antworten'}`, m.attachments.length && `${m.attachments.length} Anhang`, m.likes && `♥ ${m.likes}`].filter(Boolean);
  const confirm = m.important && !m.confirmed ? chip('Bestätigen', 'var(--orange)', true) : '';
  return `<button class="row msg${read.has(m.id) ? '' : ' unread'}" data-msg="${esc(m.id)}">
    <div class="avatar" style="--c:${colorOf(m.author)}">${esc(initials(m.author))}</div>
    <div class="main"><div class="head"><div class="title">${m.starred ? '<span class="star">★</span> ' : ''}${esc(m.author || linkName())}</div><time>${esc(stamp(m.last || m.time))}</time></div>
      <div class="sub clamp2">${esc(m.text)}</div>
      ${extra.length || confirm ? `<div class="meta-line">${confirm}${extra.map((x) => chip(x, 'var(--blue)')).join('')}</div>` : ''}</div></button>`;
}

/* ---------------------------------------------------------------- Heute */
function heroHTML() {
  const t = today(), m = nowMin();
  const timed = agenda(t).filter((a) => a.start && a.type !== 'allday' && !(a.type === 'lesson' && a.l.cancelled));
  const cur = timed.find((a) => toMin(a.start) <= m && m < endMin(a));
  const next = timed.find((a) => toMin(a.start) > m);
  const info = (a) => (a.type === 'lesson'
    ? { title: a.l.subject, sub: where(a.l), c: colorOf(a.l.subject), attrs: `data-day="${t}" data-i="${a.i}"`, alert: a.l.changes.join(' · '), what: `${a.l.period}. Stunde` }
    : { title: a.e.title, sub: a.e.location, c: CAT[a.e.category] || CAT.privat, attrs: `data-event="${esc(a.e.id)}"`, alert: '', what: 'Termin' });
  const card = ({ kicker, title, sub, c, attrs = '', alert = '', progress, left, right }) => `
    <button class="hero glass pressable${alert ? ' alert' : ''}" style="--c:${c}" ${attrs}>
      <div class="kicker">${esc(kicker)}</div><div class="subject">${esc(title)}</div>${sub ? `<div class="where">${esc(sub)}</div>` : ''}
      ${alert ? `<div class="change-text">${esc(alert)}</div>` : ''}
      ${progress !== undefined ? `<div class="progress"><i style="--p:${progress.toFixed(3)}"></i></div>` : ''}
      ${left || right ? `<div class="foot"><span>${left || ''}</span><span>${right || ''}</span></div>` : ''}</button>`;
  if (cur) {
    const i = info(cur), after = timed[timed.indexOf(cur) + 1];
    return card({ ...i, kicker: `Jetzt · ${i.what}`, progress: (m - toMin(cur.start)) / (endMin(cur) - toMin(cur.start)),
      left: `noch <b>${Math.ceil(endMin(cur) - m)} Min.</b>`, right: after ? `Danach <b>${esc(info(after).title)}</b>` : 'Danach frei' });
  }
  if (next) {
    const i = info(next), mins = Math.round(toMin(next.start) - m);
    return card({ ...i, kicker: mins <= 90 ? `In ${mins} Min. · ${i.what}` : `Als Nächstes · ${next.start} Uhr`,
      left: `${esc(next.start)}${next.end ? ` – ${esc(next.end)}` : ' Uhr'}`, right: `noch <b>${timed.length - timed.indexOf(next)}</b> heute` });
  }
  const nd = week().slice(1).find((d) => agenda(d).some((a) => a.start && !(a.type === 'lesson' && a.l.cancelled)));
  if (nd) {
    const items = agenda(nd).filter((a) => a.start && !(a.type === 'lesson' && a.l.cancelled));
    const lessons = items.filter((a) => a.type === 'lesson'), evs = items.filter((a) => a.type === 'event');
    const i = info(items[0]);
    return card({ ...i, kicker: timed.length ? 'Für heute erledigt' : 'Heute ist nichts geplant', title: `${dayName(nd)} ab ${items[0].start}`, sub: `${i.title}${i.sub ? ` · ${i.sub}` : ''}`, alert: '',
      left: [lessons.length && `${lessons.length} Stunden`, evs.length && `${evs.length} Termin${evs.length > 1 ? 'e' : ''}`].filter(Boolean).join(' · '),
      right: lessons.length ? `Schluss <b>${esc(lessons.at(-1).end)}</b>` : '' });
  }
  return card({ kicker: 'Die nächsten Tage', title: 'Nichts geplant', sub: 'Tippe auf +, um einen Termin anzulegen.', c: 'var(--indigo)' });
}

/* ---------------------------------------------------------------- Klingelzeiten und Ferien-Countdown */
// Wo im Stundenraster stehen wir gerade? → Stunde läuft (Gong um …) oder Pause (bis …)
function bellState() {
  const bells = S().bells || [], m = nowMin(), dow = now().getDay();
  if (!bells.length || dow === 0 || dow === 6 || (D.holidays || []).some((h) => h.start <= today() && today() <= h.end)) return null;
  for (let i = 0; i < bells.length; i++) {
    const b = bells[i], s = toMin(b.start), e = toMin(b.end);
    if (m >= s && m < e) return { lesson: true, b, left: Math.ceil(e - m), at: b.end };
    if (m < s && (i === 0 ? s - m <= 30 : true)) return i === 0 ? { before: true, b, left: Math.ceil(s - m), at: b.start } : { lesson: false, b, left: Math.ceil(s - m), at: b.start };
  }
  return null;
}
function bellRow() {
  const st = bellState();
  if (!st) return '';
  const text = st.lesson ? `${st.b.name}. Stunde · Gong um ${st.at}` : st.before ? `Unterricht beginnt um ${st.at}` : `Pause · weiter um ${st.at} (${st.b.name}. Stunde)`;
  return `<button class="card bell-row pressable" data-bells><span class="bell-dot${st.lesson ? '' : ' pause'}"></span><span class="main">${esc(text)}</span><b>${st.left} Min.</b></button>`;
}
function openBells() {
  const bells = S().bells || [], st = bellState();
  openSheet('Klingelzeiten', `<div class="list card">${bells.map((b, i) => {
    const gap = i ? toMin(b.start) - toMin(bells[i - 1].end) : 0;
    return `${gap >= 5 ? `<div class="break">Pause · ${gap} Min.</div>` : ''}<div class="row${st?.b === b ? ' now-row' : ''}"><div class="main"><div class="title">${esc(b.name)}. Stunde</div></div><div class="trail">${esc(b.start)} – ${esc(b.end)}</div></div>`;
  }).join('')}</div>`);
}
const holidayLabel = (n) => n || 'Ferien';
function holidayCard() {
  const list = D.holidays || [], t = today(), off = (d) => list.some((h) => h.start <= d && d <= h.end);
  const cur = list.find((h) => h.start <= t && t <= h.end);
  if (cur) {
    let back = addDays(cur.end, 1);
    while (parseDay(back).getDay() % 6 === 0 || off(back)) back = addDays(back, 1);
    const n = daysBetween(t, back);
    return `<div class="card holiday"><div class="big">${n}</div><div class="main"><div class="title">${n === 1 ? 'Tag' : 'Tage'} ${esc(holidayLabel(cur.name))}</div><div class="sub">Schule wieder ab ${esc(F.short.format(parseDay(back)))}</div></div></div>`;
  }
  const next = list.find((h) => h.start > t && daysBetween(h.start, h.end) >= 2);
  if (!next) return '';
  let days = 0;
  for (let d = t; d < next.start; d = addDays(d, 1)) if (parseDay(d).getDay() % 6 && !off(d)) days++;
  return `<div class="card holiday"><div class="big">${days}</div><div class="main"><div class="title">${days === 1 ? 'Schultag' : 'Schultage'} bis zu den ${esc(holidayLabel(next.name))}</div><div class="sub">ab ${esc(F.short.format(parseDay(next.start)))}</div></div></div>`;
}

/* ---------------------------------------------------------------- Schulweg: Wetter und Verbindungen */
// Welcher Weg steht an? Heute vor der ersten Stunde: hin · bis 1 h nach Schulschluss: zurück · sonst der nächste Schultag
function schoolTimes(date) {
  const ls = lessonsOn(date).filter((l) => !l.cancelled && !l.allday && l.start && l.end);
  return ls.length ? { start: ls.map((l) => l.start).sort()[0], end: ls.map((l) => l.end).sort().at(-1) } : null;
}
function nextWay() {
  const t = today(), m = nowMin(), tt = schoolTimes(t), hm = `${pad(now().getHours())}:${pad(now().getMinutes())}`;
  if (tt && m < toMin(tt.start)) return { date: t, dir: 'school', time: tt.start, back: tt.end };
  if (tt && m < toMin(tt.end) + 60) return { date: t, dir: 'home', time: m > toMin(tt.end) ? hm : tt.end };
  const nd = week().slice(1).find(schoolTimes);
  return nd && { date: nd, dir: 'school', time: schoolTimes(nd).start, back: schoolTimes(nd).end };
}
const WX = [[0, '☀️', 'klar'], [2, '⛅', 'leicht bewölkt'], [3, '☁️', 'bewölkt'], [48, '🌫️', 'Nebel'], [57, '🌦️', 'Niesel'], [67, '🌧️', 'Regen'], [77, '🌨️', 'Schnee'], [82, '🌧️', 'Schauer'], [86, '🌨️', 'Schneeschauer'], [99, '⛈️', 'Gewitter']];
function wxAt(date, time) {
  const h = (D.weather || []).find((x) => x.t === `${date}T${time.slice(0, 2)}:00`);
  if (!h) return null;
  const [, icon, text] = WX.find(([max]) => h.code <= max) || WX[0], hour = Number(time.slice(0, 2));
  return { ...h, icon: h.code <= 2 && (hour < 7 || hour >= 18) ? '🌙' : icon, text };
}
let wayTrips = { key: '', at: 0, list: null, error: '' };
function loadTrips(w) {
  const key = `${w.dir}|${w.date}|${w.time}`;
  if (wayTrips.key === key && (wayTrips.pending || Date.now() - wayTrips.at < 120e3)) return;
  wayTrips = { ...wayTrips, key, pending: true };
  api(`/api/trips?to=${w.dir}&date=${w.date}&time=${w.time}`)
    .then((r) => { wayTrips = { key, at: Date.now(), list: r.trips, error: '' }; })
    .catch((x) => { wayTrips = { key, at: Date.now(), list: null, error: x.message }; })
    .finally(() => { const el = $('#way'); if (el) el.outerHTML = wayCard(); });
}
function tripRow(x) {
  const late = toMin(x.depRt) - toMin(x.dep), off = x.legs.some((l) => l.cancelled), l0 = x.legs[0];
  const lines = x.legs.map((l) => `<b class="line">${esc(l.line)}</b>`).join('<span class="via">›</span>');
  const sub = [`${l0.kind} → ${l0.dir}`, l0.plat && `Steig ${l0.plat}`, x.legs.length > 1 && `${x.legs.length - 1}× umsteigen`].filter(Boolean).join(' · ');
  return `<div class="row trip"><div class="lines">${lines}</div><div class="main"><div class="title">${esc(x.dep)} → ${esc(x.arr)}</div><div class="sub">${esc(sub)}</div></div>
    ${off ? chip('fällt aus', 'var(--red)', true) : late > 0 ? chip(`+${late}`, 'var(--orange)', true) : '<span class="due">pünktlich</span>'}</div>`;
}
function wayCard() {
  const w = nextWay(), stops = D.stops || {};
  if (!w || (!D.place && !(stops.home && stops.school))) return '';
  const hasTrips = stops.home && stops.school;
  if (hasTrips) loadTrips(w);
  const key = `${w.dir}|${w.date}|${w.time}`, mine = wayTrips.key === key ? wayTrips : {};
  const list = mine.list || [], pick = w.dir === 'school' ? list.at(-1) : list[0];
  const go = pick?.dep || (w.dir === 'school' ? `${pad(Math.floor((toMin(w.time) - 30) / 60))}:${pad((toMin(w.time) - 30) % 60)}` : w.time);
  const legs = [['Hin', w.dir === 'school' ? go : null], ['Zurück', w.dir === 'school' ? w.back : go]].filter(([, t]) => t)
    .map(([label, t]) => [label, t, wxAt(w.date, t)]).filter(([, , x]) => x);
  const hints = [legs.some(([, , x]) => x.rain >= 50) && 'Schirm einpacken', legs.some(([, , x]) => x.temp <= 0) && 'Frost – warm anziehen'].filter(Boolean);
  const day = w.date === today() ? '' : ` · ${dayName(w.date)}`;
  return `<div class="card way" id="way">
    <div class="way-head"><span class="kicker">${w.dir === 'school' ? 'Zur Schule' : 'Nach Hause'}${esc(day)}</span>${w.dir === 'school' && !day ? `<span class="due">Beginn ${esc(w.time)}</span>` : ''}</div>
    ${legs.length ? `<div class="wx-row">${legs.map(([label, t, x]) => `<div class="wx"><span class="wx-icon">${x.icon}</span><div class="wx-t"><div class="wx-l"><b>${x.temp}°</b> <span>${esc(x.text)}</span></div><small>${label} ${esc(t)}${x.rain >= 20 ? ` · ☂ ${x.rain} %` : ''}</small></div></div>`).join('')}</div>` : ''}
    ${hints.length ? `<div class="way-hint">${esc(hints.join(' · '))}</div>` : ''}
    ${hasTrips ? `<div class="list">${mine.error ? `<p class="footnote warn-text" style="margin:8px 16px 12px;text-align:left">${esc(mine.error)}</p>`
      : mine.list ? (list.length ? (w.dir === 'school' ? list.slice(-2) : list.slice(0, 2)).map(tripRow).join('') : '<p class="footnote" style="margin:8px 16px 12px;text-align:left">Keine passende Verbindung gefunden.</p>')
      : '<div class="row"><div class="spinner"></div></div>'}</div>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- Lernzeit (Fokus-Timer) */
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} Min.` : ''}` : `${m} Min.`);
const timerLeft = () => Math.max(0, Math.ceil((D.timer.end - Date.now()) / 1000));
const mmss = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const ring = (r, size) => `<svg class="ring" viewBox="0 0 44 44" style="width:${size}px;height:${size}px" aria-hidden="true"><circle cx="22" cy="22" r="19"/><circle cx="22" cy="22" r="19" class="fill" pathLength="100" data-ring style="stroke-dashoffset:${(100 * (1 - r)).toFixed(2)}"/></svg>`;
function timerCard() {
  const t = D.timer;
  if (!t) return '';
  return `<button class="card timer-card pressable" data-timer style="--c:${t.subject ? colorOf(t.subject) : 'var(--teal)'}">${ring(timerLeft() / (t.minutes * 60), 46)}
    <div class="main"><div class="kicker">Lernzeit${t.subject ? ` · ${esc(t.subject)}` : ''}</div><div class="big" data-timer-left>${mmss(timerLeft())}</div></div><span class="due">von ${t.minutes} Min.</span></button>`;
}
function openTimer() {
  const t = D.timer, monday = mondayOf(today()), wk = (D.db.sessions || []).filter((s) => s.date >= monday);
  const sum = {};
  for (const s of wk) sum[s.subject || 'Ohne Fach'] = (sum[s.subject || 'Ohne Fach'] || 0) + s.minutes;
  const by = Object.entries(sum).sort((a, b) => b[1] - a[1]), max = by[0]?.[1] || 1;
  const total = wk.reduce((a, s) => a + s.minutes, 0), todayMin = wk.filter((s) => s.date === today()).reduce((a, s) => a + s.minutes, 0);
  const stats = `<p class="label-sm">Diese Woche · ${fmtMin(total)}${todayMin ? ` · heute ${fmtMin(todayMin)}` : ''}</p>
    ${by.length ? `<div class="card stats">${by.map(([s, m]) => `<div class="stat"><span>${esc(s)}</span><i style="--w:${(m / max).toFixed(3)};--c:${s === 'Ohne Fach' ? 'var(--teal)' : colorOf(s)}"></i><b>${fmtMin(m)}</b></div>`).join('')}</div>` : emptyCard('timer', 'Diese Woche noch keine Lernzeit.')}`;
  if (t) {
    openSheet('Lernzeit', `<div class="timer-big" style="--c:${t.subject ? colorOf(t.subject) : 'var(--teal)'}">${ring(timerLeft() / (t.minutes * 60), 220)}
        <div class="timer-text"><b data-timer-left>${mmss(timerLeft())}</b><span>${esc(t.subject || 'Lernen')} · ${t.minutes} Min.</span></div></div>
      <p class="footnote" style="margin-top:0">Wenn die Zeit um ist, kommt eine Mitteilung – auch bei geschlossener App.</p>
      <button class="btn-plain danger" id="timer-stop" type="button" style="margin:8px auto 0">Beenden</button>${stats}`);
    $('#timer-stop').onclick = () => stopTimer(true);
    return;
  }
  const next = tasks().filter((x) => !x.done && x.subject && (x.kind === 'exam' || x.kind === 'study')).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0]?.subject || '';
  openSheet('Lernzeit', `<form class="form" id="timer-form">
    ${group(fText('subject', 'Fach (optional)', next, 'list="subjects" maxlength="80"'))}
    <p class="label-sm">Dauer</p>
    ${fChoice('minutes', [[15, '15 Min.'], [25, '25 Min.'], [45, '45 Min.'], [60, '60 Min.']], store.get('timer-min', 25))}
    <button class="btn-primary pressable" type="submit" style="margin-top:16px">Starten</button></form>${stats}`);
  $('#timer-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    store.set('timer-min', Number(body.minutes));
    try { setData(await api('/api/timer', { method: 'POST', body })); haptic(); openTimer(); } catch (x) { toast(x.message); }
  };
}
let stopping = false;
async function stopTimer(early) {
  if (stopping || !D.timer) return;
  stopping = true;
  try {
    setData(await api('/api/timer/stop', { method: 'POST' }));
    haptic();
    toast(early ? 'Lernzeit beendet' : 'Geschafft – Zeit für eine Pause');
    if (sheetOpen && $('#sheet-title').textContent === 'Lernzeit') openTimer();
  } catch (x) { toast(x.message); } finally { stopping = false; }
}
setInterval(() => { // Sekundentakt nur für sichtbare Anzeigen
  if (!D?.timer || document.hidden) return;
  const s = timerLeft(), r = s / (D.timer.minutes * 60);
  $$('[data-timer-left]').forEach((el) => { el.textContent = mmss(s); });
  $$('[data-ring]').forEach((el) => { el.style.strokeDashoffset = (100 * (1 - r)).toFixed(2); });
  if (s === 0) stopTimer(false);
}, 1000);

/* ---------------------------------------------------------------- Tafelbilder */
const photoUrl = (p) => `/api/photos/${encodeURIComponent(p.id)}`;
function photoGrid(list) {
  const ps = [...list].sort((a, b) => ((b.date || '') + b.updated).localeCompare((a.date || '') + a.updated));
  return ps.length ? `<div class="photo-grid">${ps.map((p) => `<button class="card photo pressable${p.id === justAdded ? ' appear' : ''}" data-photo="${esc(p.id)}">
      <img src="${photoUrl(p)}" alt="${esc(p.caption || p.subject || 'Tafelbild')}" loading="lazy" decoding="async">
      <div class="cap"><b>${esc(p.subject || 'Tafelbild')}</b>${p.date ? `<span>${esc(F.short.format(parseDay(p.date)))}</span>` : ''}</div></button>`).join('')}</div>`
    : emptyCard('camera', 'Noch keine Tafelbilder. Tippe auf +, um eins aufzunehmen.');
}
// Foto aufnehmen oder wählen → verkleinern (schnellerer Upload, weniger Platz) → Fach und Datum zuordnen
function pickPhoto(pre = {}) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try { photoForm(await shrink(f), pre); } catch { toast('Dieses Bildformat wird nicht unterstützt'); }
  };
  inp.click(); // muss direkt im Tippen passieren (iOS)
}
async function shrink(file, max = 2200) {
  const img = await createImageBitmap(file), k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('jpeg'))), 'image/jpeg', 0.82));
}
function photoForm(blob, pre) {
  const cur = lessonsOn(today()).filter((l) => l.start && !l.cancelled && !l.allday && toMin(l.start) <= nowMin()).at(-1);
  const src = URL.createObjectURL(blob);
  openSheet('Tafelbild', `<form class="form" novalidate><img class="photo-full" src="${src}" alt="Vorschau">
    ${group(fText('subject', 'Fach', pre.subject || cur?.subject || '', 'list="subjects" maxlength="80"'), fRow('Datum', `<input type="date" name="date" value="${esc(pre.date || today())}">`), fText('caption', 'Beschriftung (optional)', '', 'maxlength="300"'))}
    <p class="form-error" role="alert"></p><button class="btn-primary pressable" type="submit">Sichern</button></form>`);
  const f = $('#sheet form'), btn = $('button[type=submit]', f);
  f.onsubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Lädt hoch …';
    try {
      // als Formular-Datei mit Base64-Inhalt – die Firewall des Hosters sperrt image/jpeg als Anfrage-Typ
      const b64 = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = fail; r.readAsDataURL(blob); });
      const body = new FormData();
      body.append('bild', new Blob([b64]), 'bild.jpg');
      const res = await fetch(`/api/photos?${new URLSearchParams(Object.fromEntries(new FormData(f)))}`, { method: 'POST', credentials: 'same-origin', body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.statusText);
      D.db.photos = [...D.db.photos, j];
      justAdded = j.id; setTimeout(() => { justAdded = null; }, 1200);
      URL.revokeObjectURL(src);
      haptic();
      closeSheet();
      renderNotizen();
    } catch (x) { $('.form-error', f).textContent = x.message; btn.disabled = false; btn.textContent = 'Sichern'; }
  };
}
function openPhoto(id) {
  const p = D.db.photos.find((x) => x.id === id);
  if (!p) return;
  formSheet('photos', p, p.subject || 'Tafelbild', `<a href="${photoUrl(p)}" target="_blank" rel="noopener"><img class="photo-full" src="${photoUrl(p)}" alt="${esc(p.caption || 'Tafelbild')}"></a>
    ${group(fText('subject', 'Fach', p.subject, 'list="subjects" maxlength="80"'), fRow('Datum', `<input type="date" name="date" value="${esc(p.date)}">`), fText('caption', 'Beschriftung', p.caption, 'maxlength="300"'))}`);
}

/* ---------------------------------------------------------------- Einkaufsliste (Home Assistant, z. B. Cookidoo) */
let shop = { items: null, error: '', at: 0 }, shopBusy = false;
function loadShop(force) {
  if (shopBusy || (!force && Date.now() - shop.at < 30e3)) return;
  shopBusy = true;
  api('/api/shop').then((items) => { shop = { items, error: '', at: Date.now() }; }, (x) => { shop = { ...shop, error: x.message, at: Date.now() }; })
    .finally(() => { shopBusy = false; if (notesSeg === 'einkauf') renderNotesBody(); });
}
function shopBody() {
  if (!D.ha?.connected || !D.ha.todo) {
    return `<div class="card empty">${ICON.cart}Verbinde im Profil Home Assistant und wähle dort deine Einkaufsliste – zum Beispiel die von Cookidoo.
      <button class="btn-link" data-settings style="display:block;margin:10px auto 0">Profil öffnen</button></div>`;
  }
  loadShop();
  const items = shop.items || [], open = items.filter((i) => i.status !== 'completed'), done = items.filter((i) => i.status === 'completed');
  return `<form class="card shop-add" id="shop-add"><input name="text" placeholder="Artikel hinzufügen" maxlength="200" autocomplete="off" enterkeyhint="done" aria-label="Artikel hinzufügen"><button class="btn-link" type="submit">Hinzufügen</button></form>
    ${shop.error ? `<p class="footnote warn-text" style="margin:0 4px 12px">${esc(shop.error)}</p>` : ''}
    ${!shop.items ? (shop.error ? '' : '<div class="card row"><div class="spinner"></div></div>') : open.length ? `<div class="list card">${open.map(shopRow).join('')}</div>` : emptyCard('check', 'Alles eingekauft.')}
    ${done.length ? `<h2 class="section-title">Erledigt<button data-shop-clear>Entfernen</button></h2><div class="list card">${done.map(shopRow).join('')}</div>` : ''}`;
}
const shopRow = (i) => `<div class="row task${i.status === 'completed' ? ' done' : ''}" style="--c:var(--green)">
  <button class="check" role="checkbox" aria-checked="${i.status === 'completed'}" aria-label="${esc(i.summary)} erledigt" data-shop="${esc(i.uid)}"></button>
  <div class="main"><div class="title">${esc(i.summary)}</div></div></div>`;
function wireShop() {
  const f = $('#shop-add');
  if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const inp = $('input', f), text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    try { shop = { items: await api('/api/shop', { method: 'POST', body: { text } }), error: '', at: Date.now() }; haptic(); } catch (x) { inp.value = text; toast(x.message); }
    renderNotesBody();
    $('#shop-add input')?.focus();
  };
}
async function toggleShop(uid) {
  const it = shop.items?.find((i) => i.uid === uid);
  if (!it) return;
  const done = it.status !== 'completed';
  it.status = done ? 'completed' : 'needs_action';
  haptic();
  renderNotesBody();
  try { shop = { items: await api(`/api/shop/${encodeURIComponent(uid)}`, { method: 'POST', body: { done } }), error: '', at: Date.now() }; } catch (x) { it.status = done ? 'needs_action' : 'completed'; toast(x.message); }
  renderNotesBody();
}
async function clearShop() {
  try { shop = { items: await api('/api/shop/done', { method: 'DELETE' }), error: '', at: Date.now() }; haptic(); } catch (x) { toast(x.message); }
  renderNotesBody();
}

/* ---------------------------------------------------------------- Zuhause: PC und andere Knöpfe aus Home Assistant */
let pcState = { list: null, at: 0 }, pcBusy = false;
function loadPc(force) {
  if (pcBusy || (!force && Date.now() - pcState.at < 30e3)) return;
  pcBusy = true;
  api('/api/ha/pc').then((list) => { pcState = { list, at: Date.now() }; }, () => { pcState = { ...pcState, at: Date.now() }; })
    .finally(() => { pcBusy = false; const el = $('#pc'); if (el) el.outerHTML = pcCard(); });
}
function pcCard() {
  const ids = D.ha?.connected ? D.ha.pc : [];
  if (!ids?.length) return '';
  loadPc();
  const list = ids.map((id) => pcState.list?.find((e) => e.id === id) || { id, name: id.split('.')[1].replace(/_/g, ' '), state: '' });
  return `<div id="pc">${section('Zuhause')}<div class="pc-grid"><button class="card pc-btn pressable" data-screen>${ICON.screen}<span>Bildschirm</span><small>ansehen und steuern</small></button>${list.map((e) => {
    const sw = e.id.startsWith('switch.'), on = e.state === 'on', gone = e.state === 'unavailable';
    return `<button class="card pc-btn pressable${on ? ' on' : ''}" data-pc="${esc(e.id)}"${gone ? ' disabled' : ''}>${sw ? ICON.power : ICON.play}<span>${esc(e.name)}</span>
      ${gone ? '<small>nicht erreichbar</small>' : sw && e.state ? `<small>${on ? 'An' : 'Aus'}</small>` : ''}</button>`;
  }).join('')}</div></div>`;
}
async function runPc(id, el) {
  el.disabled = true;
  haptic();
  try { await api(`/api/ha/pc/${encodeURIComponent(id)}`, { method: 'POST' }); toast(`${$('span', el).textContent}: ausgelöst`); } catch (x) { toast(x.message); }
  el.disabled = false;
  setTimeout(() => loadPc(true), 1500);
}

/* ---------------------------------------------------------------- PC-Bildschirm: ansehen, Maus und Tastatur */
const SKEYS = [['Escape', 'Esc'], ['Tab', 'Tab'], ['Enter', 'Enter'], ['Backspace', '⌫'], ['Delete', 'Entf'], ['ArrowLeft', '←'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowRight', '→'],
  ['Win', 'Win'], ['Alt+Tab', 'Alt+Tab'], ['Ctrl+C', 'Strg+C'], ['Ctrl+V', 'Strg+V'], ['Ctrl+Z', 'Strg+Z'], ['Ctrl+A', 'Strg+A'], ['F5', 'F5'], ['Alt+F4', 'Alt+F4']];
const KEYMAP = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'F5']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let scr = null;
function openScreen() {
  if (scr) return;
  closeSheet();
  const el = document.createElement('div');
  el.className = 'screen-view';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'PC-Bildschirm');
  el.innerHTML = `<div class="screen-bar">
      <button class="sbtn" data-s="close" aria-label="Schließen">✕</button>
      <button class="sbtn" data-s="mon" hidden></button>
      <button class="sbtn" data-s="zoom" aria-label="Vergrößern">1×</button>
      <button class="sbtn" data-s="kbd">Tastatur</button>
      <button class="sbtn" data-s="keys" aria-expanded="false">Tasten</button>
      <button class="sbtn" data-s="up" aria-label="Nach oben scrollen">▲</button>
      <button class="sbtn" data-s="down" aria-label="Nach unten scrollen">▼</button></div>
    <div class="screen-keys" hidden>${SKEYS.map(([k, l]) => `<button class="sbtn" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="screen-area"><img alt="PC-Bildschirm" draggable="false"><p class="screen-msg">Verbinde mit dem PC …</p></div>
    <input class="screen-input" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Tastatur">`;
  document.body.append(el);
  appEl.inert = true;
  scr = { el, img: $('img', el), msg: $('.screen-msg', el), input: $('.screen-input', el), seq: 0, zoom: 1, n: 1, s: 0, q: [], p: Promise.resolve(), wheel: 0, moved: 0 };
  wireScreen(scr);
  screenLoop(scr);
}
function closeScreen() {
  if (!scr) return;
  document.removeEventListener('keydown', scr.onkey, true);
  scr.el.remove();
  scr = null;
  appEl.inert = false;
}
// Eingaben sammeln und alle 50 ms in Reihenfolge abschicken
function sendEv(e) {
  const s = scr;
  if (!s) return;
  s.q.push(e);
  if (s.t) return;
  s.t = setTimeout(() => {
    const events = s.q.splice(0);
    s.t = null;
    s.p = s.p.then(() => api('/api/screen/input', { method: 'POST', body: { events } })).catch(() => {});
  }, 50);
}
function wireScreen(s) {
  const pos = (e) => { const r = s.img.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const btn = (b) => ({ 0: 0, 2: 1, 1: 2 })[b] ?? 0; // Browser: links/Mitte/rechts → PC: links/rechts/Mitte
  s.img.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { e.preventDefault(); sendEv({ t: 'move', ...pos(e) }); sendEv({ t: 'down', b: btn(e.button) }); return; }
    s.touch = { x: e.clientX, y: e.clientY, at: Date.now(), p: pos(e) };
  });
  s.img.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { if (Date.now() - s.moved > 40) { s.moved = Date.now(); sendEv({ t: 'move', ...pos(e) }); } return; }
    if (s.touch && Math.hypot(e.clientX - s.touch.x, e.clientY - s.touch.y) > 10) s.touch = null; // wischen = Bild verschieben
  });
  s.img.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') { sendEv({ t: 'move', ...pos(e) }); sendEv({ t: 'up', b: btn(e.button) }); return; }
    const t = s.touch;
    s.touch = null;
    if (!t) return;
    const b = Date.now() - t.at > 500 ? 1 : 0; // lange drücken = Rechtsklick
    sendEv({ t: 'move', ...t.p }); sendEv({ t: 'down', b }); sendEv({ t: 'up', b });
    haptic();
  });
  s.img.addEventListener('pointercancel', () => { s.touch = null; });
  s.img.addEventListener('contextmenu', (e) => e.preventDefault());
  $('.screen-area', s.el).addEventListener('wheel', (e) => {
    e.preventDefault();
    s.wheel += e.deltaY;
    if (Math.abs(s.wheel) >= 60) { sendEv({ t: 'wheel', d: -Math.sign(s.wheel) * 120 }); s.wheel = 0; }
  }, { passive: false });
  s.onkey = (e) => {
    if (!scr) return;
    let k = null;
    if ((e.ctrlKey || e.metaKey) && /^[acvxz]$/i.test(e.key)) k = `Ctrl+${e.key.toUpperCase()}`;
    else if (KEYMAP.has(e.key)) k = e.key;
    if (k) { e.preventDefault(); e.stopPropagation(); return sendEv({ t: 'key', k }); }
    if (e.target === s.input) return; // Text vom Handy kommt über das input-Ereignis (Umlaute, Autokorrektur)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); sendEv({ t: 'text', s: e.key }); }
  };
  document.addEventListener('keydown', s.onkey, true);
  s.input.addEventListener('input', () => { if (s.input.value) { sendEv({ t: 'text', s: s.input.value }); s.input.value = ''; } });
  s.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s],[data-k]');
    if (!b) return;
    haptic();
    if (b.dataset.k) return sendEv({ t: 'key', k: b.dataset.k });
    const a = b.dataset.s;
    if (a === 'close') return closeScreen();
    if (a === 'kbd') return s.input.focus();
    if (a === 'keys') { const k = $('.screen-keys', s.el); k.hidden = !k.hidden; b.setAttribute('aria-expanded', String(!k.hidden)); return; }
    if (a === 'up' || a === 'down') return sendEv({ t: 'wheel', d: a === 'up' ? 360 : -360 });
    if (a === 'zoom') { s.zoom = s.zoom >= 3 ? 1 : s.zoom + 1; s.img.style.setProperty('--z', s.zoom); b.textContent = `${s.zoom}×`; return; }
    if (a === 'mon') { const next = s.s === -1 ? 0 : s.s + 1 >= s.n ? -1 : s.s + 1; s.s = next; monLabel(s); sendEv({ t: 'screen', i: next }); }
  });
}
function monLabel(s) {
  const b = $('[data-s=mon]', s.el);
  b.hidden = s.n < 2;
  b.textContent = s.s === -1 ? 'Alle Bildschirme' : `Bildschirm ${s.s + 1}`;
}
async function screenLoop(s) {
  const say = (t) => { s.msg.hidden = !t; s.msg.textContent = t; };
  while (scr === s) {
    try {
      const r = await fetch(`/api/screen/frame?after=${s.seq}`, { credentials: 'same-origin', cache: 'no-store' });
      if (scr !== s) return;
      if (r.status === 401) { closeScreen(); return showLogin(); }
      if (r.status === 200) {
        s.seq = Number(r.headers.get('X-Seq'));
        s.n = Number(r.headers.get('X-Screens')) || 1;
        if (!s.t) s.s = Number(r.headers.get('X-Screen'));
        const url = URL.createObjectURL(await r.blob()), old = s.img.src;
        s.img.src = url;
        if (old.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(old), 2000);
        say('');
        monLabel(s);
      } else if (r.status === 204) {
        if (r.headers.get('X-Agent') !== '1') { say('PC nicht verbunden. Läuft dort das Fernsteuerungs-Programm? (Profil → PC-Bildschirm)'); await sleep(2000); }
        else if (r.headers.get('X-Locked') === '1') say('Der PC ist gesperrt – bitte am PC anmelden.');
      } else await sleep(2000);
    } catch { await sleep(2000); }
  }
}

/* ---------------------------------------------------------------- Ticket (öffnet die offizielle App bzw. Website) */
function ticketRow() {
  const t = D.ticket;
  if (!t?.url) return '';
  const n = t.until ? daysBetween(today(), t.until) : null;
  const sub = n == null ? 'Öffnen' : n < 0 ? 'abgelaufen' : n === 0 ? 'läuft heute ab' : n <= 7 ? `läuft in ${n} ${n === 1 ? 'Tag' : 'Tagen'} ab` : `bis ${F.short.format(parseDay(t.until))}`;
  const href = /^(javascript|data|vbscript|file|blob):/i.test(t.url) ? '#' : t.url;
  return `<a class="card bell-row ticket pressable" href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : ''}>${ICON.ticket}<span class="main">${esc(t.name || 'Ticket')}</span><b class="${n != null && n <= 7 ? 'warn' : ''}">${esc(sub)}</b></a>`;
}

/* ---------------------------------------------------------------- Geburtstage */
function nextBirthday(b) {
  for (let i = 0; i <= 366; i++) { const d = addDays(today(), i); if (Recur.birthdayOn(b, d)) return d; }
  return null;
}
function bdayItem(b, d) {
  const n = daysBetween(today(), d), age = Recur.ageOn(b, d);
  const when = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n < 7 ? dayName(d) : `${F.short.format(parseDay(d))} · in ${n} Tagen`;
  return `<button class="row bday${n === 0 ? ' today' : ''}" data-bday="${esc(b.id)}"><div class="avatar" style="--c:var(--pink)">${esc(initials(b.name))}</div>
    <div class="main"><div class="title">${esc(b.name)}</div><div class="sub">${esc(when)}${age ? ` · wird ${age}` : ''}</div></div>${n === 0 ? '<span class="cake">🎂</span>' : ''}</button>`;
}
function openBirthdays() {
  const all = (D.db.birthdays || []).map((b) => ({ b, d: nextBirthday(b) })).sort((a, b) => (a.d || '9').localeCompare(b.d || '9'));
  openSheet('Geburtstage', `${all.length ? `<div class="list card">${all.map(({ b, d }) => bdayItem(b, d)).join('')}</div>` : emptyCard('gift', 'Noch keine Geburtstage eingetragen.')}
    <button class="btn-primary pressable" data-new="birthday" style="margin-top:16px">Geburtstag hinzufügen</button>`);
}

function renderHeute() {
  const t = today();
  const changes = S().days.filter((d) => d.date >= t).flatMap((d) => d.changes.map((c) => changeRow(c, d.date)));
  const left = agenda(t).filter((a) => a.type === 'allday' || a.type === 'bday' || (a.start && endMin(a) > nowMin()));
  const bdays = (D.db.birthdays || []).map((b) => ({ b, d: nextBirthday(b) })).filter((x) => x.d).sort((a, b) => a.d.localeCompare(b.d));
  const show = left.length ? t : week().slice(1).find((d) => agenda(d).length);
  const due = dueSoon().sort((a, b) => (a.due + (a.time || '')).localeCompare(b.due + (b.time || '')));
  const msgs = S().messages;
  $('#view-heute').innerHTML = `
    ${largeTitle('Heute', F.long.format(now()))}
    ${banners()}
    <div class="today-grid"><div class="col">
      ${heroHTML()}
      ${timerCard()}
      ${bellRow()}
      ${wayCard()}
      ${ticketRow()}
      ${holidayCard()}
      ${changes.length ? section('Vertretungen') + `<div class="list card">${changes.join('')}</div>` : ''}
      ${show ? section(show === t ? 'Tagesablauf' : dayName(show), 'kalender') + `<div class="list card">${agendaList(show)}</div>` : ''}
    </div><div class="col">
      ${section('Fällig', 'aufgaben')}
      ${due.length ? `<div class="list card">${due.slice(0, 6).map(taskRow).join('')}</div>` : emptyCard('check', 'Für heute und morgen ist nichts fällig.')}
      ${msgs.length ? section('Nachrichten', 'schule') + `<div class="list card">${msgs.slice(0, 3).map(msgRow).join('')}</div>` : ''}
      ${pcCard()}
      ${bdays.length ? `<h2 class="section-title">Geburtstage<button data-bdays>Alle</button></h2><div class="list card">${bdays.slice(0, 3).map(({ b, d }) => bdayItem(b, d)).join('')}</div>` : ''}
    </div></div>
    ${D.link.connected ? `<p class="footnote">${linkName()} aktualisiert ${esc(ago(D.snap?.updated))} · <button class="btn-link" data-refresh>Jetzt aktualisieren</button>${S().bells?.length ? ' · <button class="btn-link" data-bells>Klingelzeiten</button>' : ''}</p>` : ''}`;
}

/* ---------------------------------------------------------------- Segment-Steuerung mit gleitendem Daumen */
function Seg(el, onPick) {
  const thumb = $('.thumb', el), btns = $$('button', el);
  let geo = [], x = 0, w = 0, anim = null;
  const measure = () => { geo = btns.map((b) => [b.offsetLeft, b.offsetWidth]); };
  const at = (pos) => {
    if (!geo[0]?.[1]) measure();
    const i = clamp(Math.floor(pos), 0, geo.length - 1), j = Math.min(i + 1, geo.length - 1), f = clamp(pos - i, 0, 1);
    return [geo[i][0] + (geo[j][0] - geo[i][0]) * f, geo[i][1] + (geo[j][1] - geo[i][1]) * f];
  };
  const set = (px, width) => {
    x = px;
    if (width !== w) { w = width; thumb.style.width = `${width}px`; }
    thumb.style.transform = `translateX(${px}px)`;
  };
  btns.forEach((b, i) => b.addEventListener('click', () => onPick(i)));
  return {
    measure,
    track(pos) { anim?.stop(); set(...at(pos)); },            // 1:1 an die Scroll-Position gekoppelt
    mark(i) { btns.forEach((b, k) => b.setAttribute('aria-selected', String(k === i))); },
    glide(i) {
      this.mark(i);
      const [to, width] = at(i), from = x, w0 = w, v = anim?.running ? anim.velocity : 0;
      anim?.stop();
      anim = spring({ from, to, velocity: v, damping: 0.86, response: 0.34,
        onUpdate: (px) => set(px, to === from ? width : w0 + (width - w0) * clamp((px - from) / (to - from), 0, 1)) });
    },
  };
}
const segHTML = (items, sel, label) => `<div class="seg-bar"><div class="seg glass" role="tablist" aria-label="${label}"><div class="thumb"></div>
  ${items.map(([k, l]) => `<button role="tab" style="flex:1 1 auto;padding:0 10px" aria-selected="${k === sel}">${l}</button>`).join('')}</div></div>`;

/* ---------------------------------------------------------------- Kalender (Woche Mo–So, wechselbar) */
function loadWeek(start) {
  const have = calWeek().slice(0, 5).every((d) => dayOf(d));
  if (!D.link.connected || (have && loadedWeeks.has(start)) || loadedWeeks.get(start) === 'loading') return;
  if (have && start === mondayOf(today())) return;
  loadedWeeks.set(start, 'loading');
  api(`/api/week?start=${start}`).then(({ days }) => {
    days.forEach((d) => { if (!S().days.some((x) => x.date === d.date)) extraDays.set(d.date, d); });
    loadedWeeks.set(start, Date.now());
    if (weekStart === start) renderKalender();
  }).catch(() => { loadedWeeks.delete(start); if (weekStart === start) renderKalender(); });
}
function shiftWeek(n) {
  weekStart = n === 0 ? defaultWeek() : addDays(weekStart, 7 * n);
  planDay = calWeek().includes(today()) ? today() : weekStart;
  haptic();
  renderKalender();
  const v = $('#view-kalender .pager');
  if (v && !reduceMotion.matches) { v.classList.remove('slide-l', 'slide-r'); void v.offsetWidth; v.classList.add(n < 0 ? 'slide-r' : 'slide-l'); }
}
let planSeg = null;
function dayPage(date) {
  const d = parseDay(date), items = agenda(date), weekend = d.getDay() % 6 === 0;
  const loading = !weekend && !dayOf(date) && loadedWeeks.get(weekStart) === 'loading';
  return `<h3 class="page-day${date === today() ? ' today' : ''}">${esc(F.wd.format(d))} <span>${d.getDate()}.</span></h3>
    ${items.length ? `<div class="list card">${agendaList(date, items)}</div>` : `<div class="card empty slim">${loading ? '<div class="spinner"></div>' : weekend ? 'Wochenende' : 'Nichts eingetragen'}</div>`}
    <button class="add-row pressable" data-new-event="${date}">+ Termin</button>`;
}

function renderKalender() {
  weekStart ??= defaultWeek();
  const v = $('#view-kalender'), days = calWeek(), first = parseDay(days[0]), last = parseDay(days[6]);
  const range = first.getMonth() === last.getMonth() ? `${first.getDate()}. – ${F.dayMonth.format(last)}` : `${F.dayMonth.format(first)} – ${F.dayMonth.format(last)}`;
  // leeres Wochenende schmal, damit die Schultage am PC Platz haben
  const emptyWeekend = days.slice(5).every((d) => !agenda(d).length);
  v.innerHTML = `
    ${largeTitle('Kalender', `KW ${isoWeek(first)}`)}
    <div class="week-nav">
      <button class="glass circle pressable" data-week="-1" aria-label="Vorherige Woche"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="week-range">${esc(range)}</div>
      <button class="glass circle pressable" data-week="1" aria-label="Nächste Woche"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      ${weekStart !== defaultWeek() ? '<button class="today-pill glass pressable" data-week="0">Heute</button>' : ''}
    </div>
    <div class="seg-bar"><div class="seg days glass" role="tablist" aria-label="Tag"><div class="thumb"></div>
      ${days.map((date) => {
        const dt = parseDay(date), dot = (dayOf(date)?.changes.length ? 'var(--orange)' : '') || (D.db.events.some((e) => Recur.occursOn(e, date)) ? 'var(--purple)' : '') || ((D.db.birthdays || []).some((b) => Recur.birthdayOn(b, date)) ? 'var(--pink)' : '');
        return `<button role="tab" class="${date === today() ? 'today' : ''}" aria-selected="${date === planDay}" aria-label="${esc(F.long.format(dt))}">
          <span>${esc(F.wdShort.format(dt).replace('.', ''))}</span><b>${dt.getDate()}</b>${dot ? `<i style="background:${dot}"></i>` : ''}</button>`;
      }).join('')}
    </div></div>
    <div class="pager${emptyWeekend ? ' slim-weekend' : ''}">${days.map((date) => `<div class="page">${dayPage(date)}</div>`).join('')}</div>`;
  loadWeek(weekStart);
  const pager = $('.pager', v);
  planSeg = Seg($('.days', v), (i) => pager.scrollTo({ left: pager.children[i].offsetLeft - pager.children[0].offsetLeft, behavior: reduceMotion.matches ? 'auto' : 'smooth' }));
  let settle;
  const step = () => (pager.children[1]?.offsetLeft - pager.children[0].offsetLeft) || pager.clientWidth;
  pager.addEventListener('scroll', () => {
    const pos = pager.scrollLeft / step();
    planSeg.track(pos);
    clearTimeout(settle);
    settle = setTimeout(() => {
      const i = Math.round(pos);
      planDay = days[i] || planDay;
      planSeg.mark(i);
    }, 90);
  }, { passive: true });
  syncPlan();
}

function syncPlan() {
  if (tab !== 'kalender' || !planSeg) return;
  const pager = $('#view-kalender .pager'), i = Math.max(0, calWeek().indexOf(planDay));
  planSeg.measure();
  const page = pager.children[i], from = page.offsetLeft - pager.children[0].offsetLeft;
  // PC (ohne Tagesleiste): Woche ab Montag zeigen und nur so weit scrollen, dass der Tag sichtbar ist
  const desktop = getComputedStyle($('#view-kalender .seg-bar')).display === 'none';
  pager.scrollLeft = desktop ? Math.max(0, from + page.offsetWidth - (pager.clientWidth - 64)) : from;
  planSeg.track(i);
  planSeg.mark(i);
}

/* ---------------------------------------------------------------- Aufgaben */
const FILTERS = [['alle', 'Alle'], ['schule', 'Schule'], ['privat', 'Privat']];
let taskSeg = null;
function renderAufgaben() {
  $('#view-aufgaben').innerHTML = `${largeTitle('Aufgaben', '')}${segHTML(FILTERS, taskFilter, 'Filter')}<div id="task-list"></div>`;
  taskSeg = Seg($('#view-aufgaben .seg'), (i) => { taskFilter = FILTERS[i][0]; taskSeg.glide(i); renderTaskList(); });
  renderTaskList();
  if (tab === 'aufgaben') requestAnimationFrame(() => taskSeg.track(FILTERS.findIndex(([k]) => k === taskFilter)));
}

function renderTaskList() {
  const all = tasks(), open = all.filter((x) => !x.done).length;
  $('#view-aufgaben .eyebrow').textContent = open ? `${open} offen` : 'Alles erledigt';
  const t = today(), list = all.filter((x) => taskFilter === 'alle' || x.category === taskFilter);
  const bucket = (x) => { if (!x.due) return 5; const n = daysBetween(t, x.due); return n < 0 ? 0 : n === 0 ? 1 : n === 1 ? 2 : n < 7 ? 3 : 4; };
  const names = ['Überfällig', 'Heute', 'Morgen', 'Nächste 7 Tage', 'Später', 'Ohne Datum'];
  const groups = names.map(() => []);
  const key = (x) => (x.due || '9999') + (x.time || '');
  list.filter((x) => !x.done).sort((a, b) => key(a).localeCompare(key(b))).forEach((x) => groups[bucket(x)].push(x));
  const done = list.filter((x) => x.done);
  const body = groups.map((g, i) => (g.length ? `<p class="label-sm">${names[i]}</p><div class="list card">${g.map(taskRow).join('')}</div>` : '')).join('');
  const missing = taskFilter === 'privat' ? [] : S().missing || [];
  const miss = missing.length ? `<p class="label-sm warn-label">Als fehlend markiert</p><div class="list card">${missing.map((m) => `
    <div class="row"><div class="main"><div class="title">${esc(m.title)}</div>
      <div class="meta-line">${m.subject ? chip(m.subject, colorOf(m.subject)) : ''}${chip('fehlt', 'var(--red)', true)}${m.date ? `<span class="due">${esc(F.date.format(parseDay(m.date)))}</span>` : ''}</div>
      ${m.comment ? `<div class="sub">${esc(m.comment)}</div>` : ''}</div></div>`).join('')}</div>` : '';
  $('#task-list').innerHTML = miss + (body || emptyCard('check', 'Nichts offen. Tippe auf +, um eine Erinnerung anzulegen.')) +
    (done.length ? `<button class="disclosure" data-toggle-done>${showDone ? 'Erledigte ausblenden' : `Erledigte einblenden (${done.length})`}</button>` : '') +
    (showDone && done.length ? `<div class="list card" style="margin-top:10px">${done.map(taskRow).join('')}</div>` : '');
}

async function toggleTask(key, btn) {
  const x = tasks().find((t) => t.key === key);
  if (!x) return;
  const done = !x.done;
  const target = x.src === 'edu' ? S().tasks.find((t) => t.id === x.id) : D.db.reminders.find((r) => r.id === x.id);
  const next = x.src === 'own' && done && target.repeat ? Recur.nextOccurrence(target, target.due || today()) : null;
  if (next) { // wiederkehrend: Abhaken schiebt auf den nächsten Termin – wie in der Erinnerungen-App
    haptic();
    btn?.closest('.task')?.classList.add('leaving');
    target.due = next;
    setTimeout(() => { renderTaskList(); renderHeute(); renderBadges(); }, 800);
    toast(`Erledigt · nächstes Mal ${dayName(next)}`);
    return api(`/api/items/reminders/${encodeURIComponent(x.id)}`, { method: 'PUT', body: { due: next, done: false } }).catch(() => toast('Nicht gespeichert'));
  }
  target.done = done;
  $$(`.task[data-key="${CSS.escape(key)}"] .check`).forEach((b) => b.setAttribute('aria-checked', String(done)));
  haptic();
  const leaving = done && !showDone;
  if (leaving) btn?.closest('.task')?.classList.add('leaving');
  setTimeout(() => { renderTaskList(); renderHeute(); renderBadges(); }, leaving ? 800 : 0);
  try {
    if (x.src === 'edu') {
      const r = await api(`/api/tasks/${encodeURIComponent(x.id)}`, { method: 'POST', body: { done } });
      if (r.synced && done) toast('Auch in EduPage abgehakt');
    }
    else await api(`/api/items/reminders/${encodeURIComponent(x.id)}`, { method: 'PUT', body: { done } });
  } catch { target.done = !done; renderTaskList(); renderHeute(); renderBadges(); }
}

/* ---------------------------------------------------------------- Notizen */
const NOTES_ALL = [['notizen', 'Notizen'], ['tafel', 'Tafelbilder'], ['einkauf', 'Einkauf']];
let NOTES = NOTES_ALL; // ohne Home Assistant (öffentliche Version) ohne Einkauf
let notesSeg = 'notizen', notesSegCtl = null;
function renderNotizen() {
  NOTES = NOTES_ALL.filter(([k]) => k !== 'einkauf' || D.features?.ha !== false);
  if (!NOTES.some(([k]) => k === notesSeg)) notesSeg = 'notizen';
  $('#view-notizen').innerHTML = `${largeTitle('Notizen', '')}${segHTML(NOTES, notesSeg, 'Bereich')}<div id="notes-body"></div>`;
  notesSegCtl = Seg($('#view-notizen .seg'), (i) => { notesSeg = NOTES[i][0]; notesSegCtl.glide(i); renderNotesBody(); });
  renderNotesBody();
  if (tab === 'notizen') requestAnimationFrame(() => notesSegCtl.track(NOTES.findIndex(([k]) => k === notesSeg)));
}
function renderNotesBody() {
  const el = $('#notes-body');
  if (notesSeg === 'tafel') { el.innerHTML = photoGrid(D.db.photos); return; }
  if (notesSeg === 'einkauf') { // Eingabe überlebt das Neuzeichnen nach dem Laden
    const old = $('#shop-add input'), val = old?.value, focused = old && document.activeElement === old;
    el.innerHTML = shopBody();
    wireShop();
    if (val) $('#shop-add input').value = val;
    if (focused) $('#shop-add input')?.focus();
    return;
  }
  const notes = [...D.db.notes].sort((a, b) => (b.pinned - a.pinned) || (b.updated || '').localeCompare(a.updated || ''));
  el.innerHTML = `
    ${notes.length ? `<div class="notes-grid">${notes.map((n) => `
      <button class="card note pressable${n.id === justAdded ? ' appear' : ''}" data-note="${esc(n.id)}">
        <div class="title">${n.pinned ? ICON.pin : ''}${esc(n.title || n.body.split('\n')[0] || 'Neue Notiz')}</div>
        <div class="body">${esc(n.title ? n.body : n.body.split('\n').slice(1).join('\n'))}</div>
        <div class="meta-line">${n.subject ? chip(n.subject, colorOf(n.subject)) : ''}<span class="due">${esc(stamp(n.updated))}</span></div>
      </button>`).join('')}</div>` : emptyCard('note', 'Noch keine Notizen. Tippe auf +, um eine anzulegen.')}`;
}

/* ---------------------------------------------------------------- Schule: Nachrichten + Noten */
const schoolSegs = () => [['nachrichten', 'Nachrichten'], ['noten', 'Noten'], ...(eduLike() ? [['lehrer', 'Lehrkräfte']] : [])]; // Lehrkräfte-Suche gibt es nur mit EduPage
let schoolSegCtl = null;
function renderSchule() {
  const s = S().student, segs = schoolSegs();
  if (!segs.some(([k]) => k === schoolSeg)) schoolSeg = 'nachrichten';
  $('#view-schule').innerHTML = `${largeTitle('Schule', s?.class ? `Klasse ${s.class}` : D.link.connected ? linkName() : 'Nicht verbunden')}${segHTML(segs, schoolSeg, 'Bereich')}<div id="school-body"></div>`;
  schoolSegCtl = Seg($('#view-schule .seg'), (i) => { schoolSeg = segs[i][0]; schoolSegCtl.glide(i); renderSchoolBody(); updateAdd(); });
  renderSchoolBody();
  if (tab === 'schule') requestAnimationFrame(() => schoolSegCtl.track(segs.findIndex(([k]) => k === schoolSeg)));
}

function renderSchoolBody() {
  const el = $('#school-body');
  if (schoolSeg === 'lehrer') return renderTeachers(el);
  if (schoolSeg === 'nachrichten') {
    const msgs = S().messages;
    el.innerHTML = !D.link.connected
      ? `<button class="card empty" data-settings>${ICON.bubble}Verbinde ${linkName()} im Profil, um deine Nachrichten zu sehen.</button>`
      : msgs.length ? `<div class="list card">${msgs.map(msgRow).join('')}</div>` : emptyCard('bubble', 'Keine Nachrichten.');
    return;
  }
  const by = {};
  D.db.grades.forEach((g) => (by[g.subject] ||= []).push(g));
  const subj = Object.entries(by).sort(([a], [b]) => a.localeCompare(b, 'de')).map(([name, gs]) => ({ name, gs: gs.sort((a, b) => (b.date || '').localeCompare(a.date || '')), avg: average(gs) }));
  const avgs = subj.map((x) => x.avg).filter((x) => x != null);
  el.innerHTML = subj.length ? `
    <div class="card row" style="padding:18px 20px;margin-bottom:14px"><div class="main"><div class="sub">Gesamtschnitt</div>
      <div class="big-num">${avgs.length ? F.num.format(avgs.reduce((a, b) => a + b, 0) / avgs.length) : '–'}</div></div>
      <div class="trail">${D.db.grades.length} Noten · ${subj.length} Fächer</div></div>
    <div class="list card">${subj.map((x) => `
      <button class="row grade-row" data-subject="${esc(x.name)}" style="--c:${colorOf(x.name)}">
        <div class="main"><div class="title">${esc(x.name)}</div>
          <div class="grade-chips">${x.gs.slice(0, 8).map((g) => `<span class="grade-chip">${esc(g.value)}</span>`).join('')}</div></div>
        <div class="avg">${x.avg == null ? '–' : F.num.format(x.avg)}</div>${ICON.chev}</button>`).join('')}</div>
    <p class="footnote">Durchschnitt nach deiner Gewichtung. Tendenzen (+/−) zählen ±0,25.</p>`
    : `<button class="card empty" data-new="grade">${ICON.cap}Noch keine Noten. Tippe hier oder auf +, um eine einzutragen.</button>`;
}

function renderBadges() {
  const t = today(), unread = S().messages.filter((m) => !read.has(m.id) || (m.important && !m.confirmed)).length;
  const subs = S().days.filter((d) => d.date >= t).reduce((n, d) => n + d.changes.length, 0);
  for (const [name, n] of [['schule', unread], ['aufgaben', dueSoon().length + (S().missing?.length || 0)], ['kalender', subs]]) {
    const b = $(`#tabbar [data-tab="${name}"] .badge`);
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : n;
  }
  navigator.setAppBadge?.(unread + subs).catch(() => {});
}

/* ---------------------------------------------------------------- Sheet: ziehen, schleudern, unterbrechen */
const sheet = $('#sheet'), scrim = $('#scrim'), appEl = $('#app'), sheetBody = $('.sheet-body', sheet);
let sheetY = 0, sheetH = 1, sheetAnim = null, sheetOpen = false, lastFocus = null, drag = null;

function sheetSet(y) {
  sheetY = y;
  sheet.style.transform = `translateY(${y}px)`;
  const p = clamp(1 - y / sheetH, 0, 1);
  scrim.style.opacity = p;
  appEl.style.transform = p ? `translateY(${p * 8}px) scale(${1 - 0.06 * p})` : ''; // Hintergrund tritt zurück
}
function sheetTo(target, { velocity, damping = 1, response = 0.42, done } = {}) {
  const v = velocity ?? (sheetAnim?.running ? sheetAnim.velocity : 0);
  sheetAnim?.stop();
  sheetAnim = spring({ from: sheetY, to: target, velocity: v, damping, response, onUpdate: sheetSet, onRest: done });
}
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  sheetBody.innerHTML = html;
  sheetBody.scrollTop = 0;
  if (sheetOpen) { sheetBody.classList.remove('swap'); void sheetBody.offsetWidth; sheetBody.classList.add('swap'); return; }
  sheetOpen = true;
  lastFocus = document.activeElement;
  sheet.hidden = scrim.hidden = false;
  appEl.classList.add('pushed');
  appEl.inert = true;
  sheetH = innerHeight - sheet.offsetTop; // bis ganz aus dem Bild (am PC schwebt es mittig)
  if (!sheetAnim?.running) sheetSet(sheetH); // läuft gerade ein Schließen, geht es von dort zurück nach oben
  if (reduceMotion.matches) { sheet.style.opacity = 0; requestAnimationFrame(() => { sheet.style.opacity = 1; }); }
  sheetTo(0);
  $('.sheet-close', sheet).focus({ preventScroll: true });
}
function closeSheet(velocity) {
  if (!sheetOpen) return;
  sheetOpen = false;
  appEl.inert = false;
  const finish = () => {
    sheet.hidden = scrim.hidden = true;
    appEl.classList.remove('pushed');
    appEl.style.transform = sheet.style.opacity = '';
  };
  lastFocus?.focus?.({ preventScroll: true });
  if (reduceMotion.matches) { sheet.style.opacity = scrim.style.opacity = 0; setTimeout(() => { if (!sheetOpen) { finish(); sheetSet(sheetH); } }, 200); return; }
  sheetTo(sheetH, { velocity, response: 0.38, done: finish });
}

function dragStart(y) {
  if (!sheetOpen) return;
  sheetAnim?.stop();               // greift das Sheet dort, wo es gerade ist
  drag = { y0: y, base: sheetY, tr: tracker() };
  drag.tr.add(sheetY);
}
function dragMove(y) {
  if (!drag) return;
  let ny = drag.base + y - drag.y0;
  if (ny < 0) ny = -rubberband(-ny, sheetH); // nach oben: zunehmender Widerstand statt harter Kante
  sheetSet(ny);
  drag.tr.add(ny);
}
function dragEnd() {
  if (!drag) return;
  const v = drag.tr.velocity();
  drag = null;
  if (sheetY > 0 && v > -150 && sheetY + project(v) > sheetH * 0.4) closeSheet(v);
  else sheetTo(0, { velocity: v, damping: sheetY < 0 ? 1 : 0.86, response: 0.36 });
}

const head = $('.sheet-head', sheet);
head.addEventListener('pointerdown', (e) => {
  if (e.button || e.target.closest('button')) return;
  head.setPointerCapture(e.pointerId);
  dragStart(e.clientY);
});
head.addEventListener('pointermove', (e) => drag && dragMove(e.clientY));
head.addEventListener('pointerup', dragEnd);
head.addEventListener('pointercancel', dragEnd);

/* Inhalt: ganz oben angekommen, wird weiteres Ziehen nach unten zum Schließen-Ziehen (nicht in Eingabefeldern) */
let touch = null;
sheetBody.addEventListener('touchstart', (e) => {
  touch = e.touches.length === 1 && !e.target.closest('textarea, input') ? { y: e.touches[0].clientY, active: false } : null;
}, { passive: true });
sheetBody.addEventListener('touchmove', (e) => {
  if (!touch) return;
  const y = e.touches[0].clientY;
  if (!touch.active) {
    if (sheetBody.scrollTop > 0 || y <= touch.y) { touch = null; return; }
    touch.active = true;
    dragStart(touch.y);
  }
  e.preventDefault();
  dragMove(y);
}, { passive: false });
const touchEnd = () => { if (touch?.active) dragEnd(); touch = null; };
sheetBody.addEventListener('touchend', touchEnd);
sheetBody.addEventListener('touchcancel', touchEnd);
scrim.addEventListener('click', () => closeSheet());
$('.sheet-close', sheet).addEventListener('click', () => closeSheet());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeSheet();
  // Kalender: Pfeiltasten wechseln die Woche
  if (tab !== 'kalender' || sheetOpen || !/^Arrow(Left|Right)$/.test(e.key) || e.target.closest?.('input, textarea')) return;
  shiftWeek(e.key === 'ArrowRight' ? 1 : -1);
});

/* ---------------------------------------------------------------- Formulare für eigene Einträge */
const fText = (name, ph, v, attrs = '') => `<label class="field"><input name="${name}" placeholder="${ph}" value="${esc(v)}" ${attrs}></label>`;
const fArea = (name, ph, v, rows = 3) => `<label class="field"><textarea name="${name}" placeholder="${ph}" rows="${rows}">${esc(v)}</textarea></label>`;
const fRow = (label, input) => `<label class="field inline"><span>${label}</span>${input}</label>`;
const fChoice = (name, opts, v) => `<div class="choice" role="radiogroup">${opts.map(([val, lab]) => `<label><input type="radio" name="${name}" value="${val}"${String(val) === String(v) ? ' checked' : ''}><span>${lab}</span></label>`).join('')}</div>`;
const group = (...rows) => `<div class="list card form-group">${rows.filter(Boolean).join('')}</div>`;
const CATS = [['privat', 'Privat'], ['schule', 'Schule']];
const repeatLabel = (v) => (Recur.REPEAT.find(([k]) => k === v) || ['', ''])[1];
const fRepeat = (it) => group(
  fRow('Wiederholen', `<select name="repeat">${Recur.REPEAT.map(([v, l]) => `<option value="${v}"${(it?.repeat || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`),
  fRow('Endet', `<input type="date" name="until" value="${esc(it?.until)}">`));
let justAdded = null; // frisch angelegter Eintrag federt in die Liste

function formSheet(kind, item, title, fields, after) {
  openSheet(title, `<form class="form" novalidate>${fields}
    <p class="form-error" role="alert"></p>
    <button class="btn-primary pressable" type="submit">${item ? 'Sichern' : 'Hinzufügen'}</button>
    ${item ? '<button class="btn-plain danger del" type="button">Löschen</button>' : ''}</form>`);
  const f = $('#sheet form'), err = $('.form-error', f);
  const rep = $('select[name=repeat]', f);
  if (rep) { const upd = () => { $('input[name=until]', f).closest('.field').hidden = !rep.value; }; rep.onchange = upd; upd(); }
  if (!item && matchMedia('(hover: hover)').matches) f.elements[0]?.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    $$('input[type=checkbox]', f).forEach((c) => { body[c.name] = c.checked; });
    try {
      const saved = await api(item ? `/api/items/${kind}/${encodeURIComponent(item.id)}` : `/api/items/${kind}`, { method: item ? 'PUT' : 'POST', body });
      D.db[kind] = [...D.db[kind].filter((x) => x.id !== saved.id), saved];
      if (!item) { justAdded = saved.id; setTimeout(() => { justAdded = null; }, 1200); }
      haptic();
      if (after) return after();
      closeSheet();
      renderAll();
    } catch (x) { err.textContent = x.message === 'Pflichtfeld fehlt' ? 'Bitte fülle das erste Feld aus.' : x.message; }
  };
  const del = $('.del', f);
  if (del) del.onclick = async () => {
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Wirklich löschen?'; return; } // zweites Tippen bestätigt
    await api(`/api/items/${kind}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    D.db[kind] = D.db[kind].filter((x) => x.id !== item.id);
    if (after) return after();
    closeSheet();
    renderAll();
  };
}

function reminderForm(r) {
  formSheet('reminders', r, r ? 'Erinnerung' : 'Neue Erinnerung', `
    ${group(fText('title', 'Titel', r?.title, 'required maxlength="200"'), fArea('notes', 'Notiz', r?.notes))}
    ${group(fRow('Datum', `<input type="date" name="due" value="${esc(r?.due || (r ? '' : today()))}">`), fRow('Uhrzeit', `<input type="time" name="time" value="${esc(r?.time)}">`))}
    ${fRepeat(r)}
    ${fChoice('category', CATS, r?.category || 'privat')}
    ${group(fText('subject', 'Fach (optional)', r?.subject, 'list="subjects" maxlength="80"'))}
    <p class="footnote" style="text-align:left;margin:6px 4px 0">Mit Uhrzeit kommt zu diesem Zeitpunkt eine Mitteilung (auf etwa 15 Minuten genau).</p>`);
}

function eventForm(e, date) {
  formSheet('events', e, e ? 'Termin' : 'Neuer Termin', `
    ${group(fText('title', 'Titel', e?.title, 'required maxlength="200"'), fText('location', 'Ort', e?.location, 'maxlength="120"'))}
    ${group(fRow('Datum', `<input type="date" name="date" required value="${esc(e?.date || date || today())}">`),
      fRow('Beginn', `<input type="time" name="start" value="${esc(e?.start)}">`), fRow('Ende', `<input type="time" name="end" value="${esc(e?.end)}">`))}
    ${fRepeat(e)}
    ${fChoice('category', CATS, e?.category || 'privat')}
    ${group(fArea('notes', 'Notiz', e?.notes))}`);
}

function noteForm(n) {
  formSheet('notes', n, n ? 'Notiz' : 'Neue Notiz', `
    ${group(fText('title', 'Titel', n?.title, 'maxlength="200"'), fArea('body', 'Text', n?.body, 12))}
    ${group(fText('subject', 'Fach (optional)', n?.subject, 'list="subjects" maxlength="80"'),
      `<label class="field inline"><span>Oben anheften</span><input type="checkbox" class="switch" name="pinned"${n?.pinned ? ' checked' : ''}></label>`)}`);
}

function gradeForm(g, subject) {
  formSheet('grades', g, g ? 'Note' : 'Neue Note', `
    ${group(fText('subject', 'Fach', g?.subject || subject, 'required list="subjects" maxlength="80"'),
      fText('value', 'Note, z. B. 2+ oder 12', g?.value, 'required maxlength="12" inputmode="text" autocapitalize="off"'),
      fText('title', 'Wofür? z. B. Klassenarbeit', g?.title, 'maxlength="120"'))}
    ${group(fRow('Datum', `<input type="date" name="date" value="${esc(g?.date || today())}">`))}
    <p class="label-sm" style="margin-top:16px">Gewichtung</p>
    ${fChoice('weight', [[0.5, '×½'], [1, '×1'], [2, '×2'], [3, '×3']], g?.weight ?? 1)}`);
}

function birthdayForm(b) {
  formSheet('birthdays', b, b ? b.name : 'Neuer Geburtstag', `
    ${group(fText('name', 'Name', b?.name, 'required maxlength="120"'), fRow('Geburtstag', `<input type="date" name="date" required value="${esc(b?.date)}">`))}
    <p class="label-sm">Zusätzlich vorher erinnern</p>
    ${fChoice('before', [[0, 'Nein'], [1, '1 Tag'], [3, '3 Tage'], [7, '1 Woche']], b?.before ?? 3)}
    ${group(fArea('notes', 'Geschenkideen, Notiz', b?.notes))}
    <p class="footnote" style="text-align:left;margin:6px 4px 0">Mitteilung jeweils morgens um 8 Uhr. Jahr unbekannt? Trag 1900 ein – dann wird kein Alter angezeigt.</p>`);
}

function newChooser() {
  const tiles = [['reminder', 'Erinnerung', ICON.check], ['event', 'Termin', ICON.cal], ['note', 'Notiz', ICON.note], ['grade', 'Note', ICON.cap], ['photo', 'Tafelbild', ICON.camera], ['timer', 'Lernzeit', ICON.timer], ['birthday', 'Geburtstag', ICON.gift]].filter(([k]) => k !== 'photo' || D.features?.photos !== false);
  openSheet('Neu', `<div class="new-grid">${tiles.map(([k, l, i]) => `<button class="card new-tile pressable" data-new="${k}">${i}<span>${l}</span></button>`).join('')}</div>`);
}
const NEW = { reminder: () => reminderForm(), event: () => eventForm(null, planDay), note: () => noteForm(), grade: () => gradeForm(), birthday: () => birthdayForm(), photo: () => pickPhoto(), timer: () => openTimer() };
const ADD = { heute: newChooser, kalender: () => eventForm(null, planDay), aufgaben: () => reminderForm(),
  notizen: () => (notesSeg === 'tafel' ? pickPhoto() : notesSeg === 'einkauf' ? $('#shop-add input')?.focus() : noteForm()),
  schule: () => (schoolSeg === 'noten' ? gradeForm() : composeMessage()) };
const updateAdd = () => { $('#add').hidden = tab === 'schule' && (schoolSeg === 'lehrer' || (schoolSeg === 'nachrichten' && !(D.link.connected && eduLike()))); }; // Nachrichten schreiben nur über EduPage

/* ---------------------------------------------------------------- Detail-Sheets */
function openLesson(date, i) {
  const l = lessonsOn(date)[i];
  if (!l) return;
  const hw = tasks().filter((t) => t.due === date && t.subject && t.subject === l.subject);
  const pics = D.db.photos.filter((p) => p.subject === l.subject && p.date === date);
  const kv = [['Tag', F.long.format(parseDay(date))], ['Zeit', `${l.start} – ${l.end} Uhr`], ['Stunde', l.period ? `${l.period}.` : ''],
    ['Raum', l.rooms.join(', ')], ['Lehrkraft', l.teachers.join(', ')], ['Gruppe', l.groups.join(', ')], ['Thema', l.topic]].filter(([, v]) => v);
  openSheet(l.subject, `
    ${l.changes.length || l.cancelled ? `<div class="card banner warn"><div><b>${l.cancelled ? 'Entfällt' : 'Vertretung'}</b>${esc(l.changes.join(' · '))}</div></div>` : ''}
    <div class="card"><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    ${l.homework?.length ? `<p class="label-sm">Hausaufgabe fällig</p>${l.homework.map((h) => `<div class="card bubble">${linkify(h)}</div>`).join('')}` : ''}
    ${l.online ? `<a class="btn-primary pressable" style="line-height:52px" href="${esc(safeUrl(l.online))}" target="_blank" rel="noopener">Online-Stunde öffnen</a>` : ''}
    ${hw.length ? `<p class="label-sm">Fällig in dieser Stunde</p><div class="list card">${hw.map(taskRow).join('')}</div>` : ''}
    <p class="label-sm">Tafelbilder</p>
    ${pics.length ? `<div class="photo-strip">${pics.map((p) => `<button class="photo-thumb" data-photo="${esc(p.id)}"><img src="${photoUrl(p)}" alt="${esc(p.caption || 'Tafelbild')}" loading="lazy"></button>`).join('')}</div>` : ''}
    <button class="btn-plain pressable" data-new-photo="${esc(l.subject)}" data-date="${date}">+ Tafelbild aufnehmen</button>`);
}

function openEduTask(id) {
  const t = S().tasks.find((x) => x.id === id);
  if (!t) return;
  const kv = [['Fach', t.subject], ['Fällig', t.due && F.long.format(parseDay(t.due))], ['Eingetragen', t.created && F.full.format(new Date(t.created))], ['Von', t.author]].filter(([, v]) => v);
  openSheet(t.label, `
    <div class="card bubble">${linkify(t.title)}${t.details ? `\n\n${linkify(t.details)}` : ''}</div>
    <div class="card"><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    ${t.kind !== 'event' ? `<button class="btn-primary pressable" data-toggle-key="e:${esc(t.id)}">${t.done ? 'Als offen markieren' : 'Als erledigt markieren'}</button>` : ''}
    <p class="footnote">Aus ${linkName()} – ändern kannst du den Eintrag nur dort.</p>`);
}

function openMessage(id) {
  const m = S().messages.find((x) => x.id === id);
  if (!m) return;
  if (!read.has(id)) { read.add(id); store.set('read', [...read]); renderSchoolBody(); renderHeute(); renderBadges(); }
  const kind = { news: 'Mitteilung', chat: 'Chat', message: 'Nachricht' }[m.kind] || 'Nachricht';
  openSheet(m.author || 'Nachricht', `
    <div class="meta-line" style="margin:0 4px">${chip(kind, 'var(--blue)')}<span class="due">${esc(F.full.format(new Date(m.time)))}</span></div>
    ${m.important ? (m.confirmed
      ? `<p class="footnote" style="text-align:left;margin:0 4px">✓ Gelesen bestätigt am ${esc(F.full.format(new Date(String(m.confirmed).replace(' ', 'T'))))}</p>`
      : `<div class="card banner warn"><div><b>Lesebestätigung erbeten</b>Die Lehrkraft möchte wissen, dass du die Nachricht gelesen hast.</div></div>
         <button class="btn-primary pressable" data-confirm="${esc(m.id)}">Gelesen bestätigen</button>`) : ''}
    <div class="card bubble">${linkify(m.text)}</div>
    <div class="msg-actions">${eduLike() ? `<button class="pill like pressable${m.liked ? ' on' : ''}" data-like="${esc(m.id)}" aria-pressed="${!!m.liked}">${m.liked ? '♥' : '♡'} Gefällt mir${m.likes ? ` · ${m.likes}` : ''}</button>` : ''}
      <button class="pill pressable${m.starred ? ' on' : ''}" data-star="${esc(m.id)}" aria-pressed="${!!m.starred}">${m.starred ? '★ Markiert' : '☆ Markieren'}</button></div>
    ${m.attachments.length ? `<div class="list card">${m.attachments.map((a) => `<a class="row attach" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${ICON.clip}<span class="main">${esc(a.name)}</span>${ICON.chev}</a>`).join('')}</div>` : ''}
    ${m.replies.length ? `<p class="label-sm">Antworten (${m.replies.length})</p><div class="thread">${m.replies.map((r) => `<div class="reply bubble${r.author === S().student?.name ? ' mine' : ''}"><b>${esc(r.author)} · ${esc(stamp(r.time))}</b>${linkify(r.text)}</div>`).join('')}</div>` : ''}
    ${D.link.connected && eduLike() ? `<form class="composer" data-reply="${esc(m.id)}">
      ${group(fArea('text', `Antwort an ${m.author || 'alle'}`, '', 3))}
      <p class="form-error" role="alert"></p>
      <button class="btn-primary pressable" type="submit">Antworten</button></form>` : ''}`);
}

function openSubject(name) {
  const gs = D.db.grades.filter((g) => g.subject === name).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const avg = average(gs);
  openSheet(name, `
    <div class="card row" style="padding:18px 20px"><div class="main"><div class="sub">Durchschnitt</div><div class="big-num">${avg == null ? '–' : F.num.format(avg)}</div></div><div class="trail">${gs.length} Noten</div></div>
    ${gs.length ? `<div class="card calc">
      <div class="title">Zielrechner</div><div class="sub">Welche Note brauchst du in der nächsten Prüfung?</div>
      ${group(fRow('Wunsch-Schnitt', `<input id="calc-target" inputmode="decimal" autocomplete="off" placeholder="${isPoints(gs) ? 'z. B. 10' : 'z. B. 2,0'}">`))}
      <p class="label-sm">Gewichtung der nächsten Note</p>
      ${fChoice('calc-weight', [[0.5, '×½'], [1, '×1'], [2, '×2'], [3, '×3']], 2)}
      <p class="calc-out" id="calc-out" aria-live="polite"></p></div>` : ''}
    <div class="list card">${gs.map((g) => `
      <button class="row" data-grade="${esc(g.id)}"><div class="main"><div class="title">${esc(g.title || 'Note')}</div>
        <div class="sub">${g.date ? esc(F.date.format(parseDay(g.date))) : ''}${Number(g.weight) !== 1 ? ` · Gewichtung ×${esc(F.num.format(g.weight))}` : ''}</div></div>
        <div class="avg">${esc(g.value)}</div>${ICON.chev}</button>`).join('')}</div>
    <button class="btn-plain pressable" data-new-grade="${esc(name)}">+ Note in ${esc(name)}</button>`);
  if (gs.length) wireCalc(gs);
}

/* ---------------------------------------------------------------- Noten-Zielrechner */
const isPoints = (gs) => gs.some((g) => (gradeNum(g.value) ?? 0) > 6); // Oberstufe 0–15 Punkte: höher ist besser
function gradeText(need, points) {
  if (points) return `${Math.max(0, Math.ceil(need - 1e-9))} Punkte`;
  const opts = [];
  for (let n = 1; n <= 6; n++) opts.push([n - 0.25, `${n}+`], [n, `${n}`], [n + 0.25, `${n}−`]);
  return (opts.filter(([v]) => v >= 1 && v <= 6 && v <= need + 1e-9).at(-1) || [1, '1'])[1]; // schlechteste Note, die noch reicht
}
function wireCalc(gs) {
  const w = gs.map((g) => [gradeNum(g.value), Number(g.weight) || 0]).filter(([n, k]) => n != null && k > 0);
  const sum = w.reduce((a, [n, k]) => a + n * k, 0), W = w.reduce((a, [, k]) => a + k, 0), points = isPoints(gs);
  const out = $('#calc-out'), inp = $('#calc-target');
  const run = () => {
    const target = parseFloat(inp.value.replace(',', '.')), k = Number($('input[name="calc-weight"]:checked').value);
    out.className = 'calc-out';
    if (!Number.isFinite(target)) { out.textContent = ''; return; }
    const need = (target * (W + k) - sum) / k, [best, worst] = points ? [15, 0] : [1, 6];
    if (points ? need > best : need < best) { out.classList.add('bad'); out.textContent = `Nicht erreichbar – selbst eine ${best} reicht nicht.`; }
    else if (points ? need <= worst : need >= worst) { out.classList.add('good'); out.textContent = 'Geschafft – das klappt mit jeder Note.'; }
    else out.innerHTML = `Du brauchst mindestens eine <b>${esc(gradeText(need, points))}</b> <span>(rechnerisch ${esc(F.num.format(need))})</span>`;
  };
  inp.oninput = run;
  $$('input[name="calc-weight"]').forEach((r) => { r.onchange = run; });
}

/* ---------------------------------------------------------------- Nachrichten schreiben, antworten, markieren */
const composeTo = new Map();
function composeMessage() {
  composeTo.clear();
  openSheet('Neue Nachricht', `<form class="composer" data-new-msg>
    <div class="card to-card"><div class="to-chips" id="to-chips"></div>
      <input id="to-search" placeholder="An: Lehrkraft suchen" autocomplete="off" aria-label="Empfänger suchen"></div>
    <div class="list card" id="to-results" hidden></div>
    ${group(fArea('text', 'Nachricht', '', 8))}
    <div id="msg-preview"></div>
    <p class="form-error" role="alert"></p>
    <button class="btn-primary pressable" type="submit">Weiter</button></form>`);
  const inp = $('#to-search'), res = $('#to-results');
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase(), hits = q ? (S().people || []).filter((p) => p.name.toLowerCase().includes(q) && !composeTo.has(p.id)).slice(0, 6) : [];
    res.hidden = !hits.length;
    res.innerHTML = hits.map((p) => `<button type="button" class="row" data-pick="${esc(p.id)}"><div class="avatar small" style="--c:${colorOf(p.name)}">${esc(initials(p.name))}</div><div class="main"><div class="title">${esc(p.name)}</div></div></button>`).join('');
  };
  drawRecipients();
}
function drawRecipients() {
  const box = $('#to-chips');
  if (!box) return;
  box.innerHTML = [...composeTo].map(([id, name]) => `<button type="button" class="to-chip pressable" data-unpick="${esc(id)}" aria-label="${esc(name)} entfernen">${esc(name)} <span aria-hidden="true">×</span></button>`).join('');
  $('#to-search').value = '';
  $('#to-results').hidden = true;
  delete $('#sheet form').dataset.sure; // Empfänger geändert → Vorschau neu bestätigen
  $('#msg-preview').innerHTML = '';
  $('#sheet form button[type=submit]').textContent = 'Weiter';
}

// Senden geht an echte Lehrkräfte: erst Vorschau, dann ausdrücklich bestätigen
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form.composer');
  if (!f) return;
  e.preventDefault();
  const text = f.text.value.trim(), btn = $('button[type=submit]', f), err = $('.form-error', f);
  err.textContent = '';
  if (!text) { err.textContent = 'Bitte einen Text eingeben.'; return; }
  const isNew = 'newMsg' in f.dataset;
  if (isNew && !composeTo.size) { err.textContent = 'Bitte mindestens eine Lehrkraft auswählen.'; return; }
  if (!f.dataset.sure) {
    f.dataset.sure = '1';
    if (isNew) $('#msg-preview').innerHTML = `<div class="card preview"><div class="sub">An ${esc([...composeTo.values()].join(', '))}</div><div class="bubble">${esc(text)}</div></div>`;
    btn.textContent = isNew ? 'Jetzt senden' : 'Antwort wirklich senden?';
    haptic();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Wird gesendet …';
  try {
    const r = await api(isNew ? '/api/messages' : `/api/messages/${encodeURIComponent(f.dataset.reply)}/reply`, { method: 'POST', body: isNew ? { to: [...composeTo.keys()], text } : { text } });
    setData(r);
    haptic();
    toast(r.demo ? 'Demo – nicht wirklich gesendet' : isNew ? 'Nachricht gesendet' : 'Antwort gesendet');
    if (isNew) closeSheet(); else openMessage(f.dataset.reply);
  } catch (x) {
    err.textContent = x.message;
    btn.disabled = false;
    btn.textContent = isNew ? 'Jetzt senden' : 'Antwort wirklich senden?';
  }
});
document.addEventListener('input', (e) => { // Text geändert → Vorschau neu bestätigen
  const f = e.target.closest('form.composer');
  if (f?.dataset.sure && e.target.name === 'text') { delete f.dataset.sure; $('button[type=submit]', f).textContent = 'newMsg' in f.dataset ? 'Weiter' : 'Antworten'; const p = $('#msg-preview'); if (p) p.innerHTML = ''; }
});

async function toggleLike(id) {
  const m = S().messages.find((x) => x.id === id);
  if (!m) return;
  m.liked = !m.liked;
  m.likes = Math.max(0, (m.likes || 0) + (m.liked ? 1 : -1));
  haptic();
  openMessage(id);
  renderSchoolBody();
  try { await api(`/api/messages/${encodeURIComponent(id)}/like`, { method: 'POST', body: { liked: m.liked } }); }
  catch (e) { m.liked = !m.liked; m.likes = Math.max(0, m.likes + (m.liked ? 1 : -1)); toast(e.message); if (sheetOpen) openMessage(id); renderSchoolBody(); }
}
async function confirmRead(id, btn) {
  const m = S().messages.find((x) => x.id === id);
  if (!m) return;
  btn.disabled = true;
  btn.textContent = 'Wird bestätigt …';
  try {
    await api(`/api/messages/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
    m.confirmed = new Date().toISOString();
    haptic();
    toast('Gelesen bestätigt');
    openMessage(id);
    renderSchoolBody(); renderHeute(); renderBadges();
  } catch (e) { btn.disabled = false; btn.textContent = 'Gelesen bestätigen'; toast(e.message); }
}

async function toggleStar(id, btn) {
  const m = S().messages.find((x) => x.id === id);
  if (!m) return;
  m.starred = !m.starred;
  btn.classList.toggle('on', m.starred);
  btn.setAttribute('aria-pressed', String(m.starred));
  btn.textContent = m.starred ? '★ Markiert' : '☆ Markieren';
  haptic();
  renderSchoolBody();
  api(`/api/messages/${encodeURIComponent(id)}/star`, { method: 'POST', body: { starred: m.starred } }).catch(() => toast('Nicht gespeichert'));
}

/* ---------------------------------------------------------------- Wo ist Lehrkraft X gerade? */
function teacherRow(p, mine) {
  return `<button class="row" data-teacher="${esc(p.id)}"><div class="avatar small" style="--c:${colorOf(p.name)}">${esc(initials(p.name))}</div>
    <div class="main"><div class="title">${esc(p.name)}</div>${mine ? `<div class="meta-line">${chip('unterrichtet dich', 'var(--blue)')}</div>` : ''}</div>${ICON.chev}</button>`;
}
function renderTeachers(el) {
  if (!D.link.connected) { el.innerHTML = `<button class="card empty" data-settings>${ICON.cap}Verbinde EduPage im Profil, um Lehrkräfte zu finden.</button>`; return; }
  const mine = new Set(S().days.flatMap((d) => d.lessons.flatMap((l) => l.teachers)));
  const people = [...(S().people || [])].sort((a, b) => mine.has(b.name) - mine.has(a.name));
  el.innerHTML = `<div class="search-field card"><input id="teacher-q" type="search" placeholder="Lehrkraft suchen" autocomplete="off" aria-label="Lehrkraft suchen"></div><div class="list card" id="teacher-list"></div>`;
  const inp = $('#teacher-q'), list = $('#teacher-list');
  const draw = () => {
    const q = inp.value.trim().toLowerCase(), ps = people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 80);
    list.innerHTML = ps.length ? ps.map((p) => teacherRow(p, mine.has(p.name))).join('') : '<div class="empty">Niemand gefunden.</div>';
  };
  inp.oninput = draw;
  draw();
}
async function openTeacher(id) {
  const p = (S().people || []).find((x) => x.id === id);
  if (!p) return;
  openSheet(p.name, '<div class="card empty slim"><div class="spinner"></div></div>');
  let lessons, source;
  try { ({ lessons, source } = await api(`/api/teacher/${encodeURIComponent(id)}`)); } catch (e) {
    if ($('#sheet-title').textContent === p.name) sheetBody.innerHTML = `<div class="card banner warn"><div><b>Nicht verfügbar</b>${esc(e.message)}</div></div>`;
    return;
  }
  if (!sheetOpen || $('#sheet-title').textContent !== p.name) return;
  const m = nowMin(), act = lessons.filter((l) => l.start && !l.cancelled && !l.allday);
  const cur = act.find((l) => toMin(l.start) <= m && m < toMin(l.end)), next = act.find((l) => toMin(l.start) > m);
  const info = (l) => [l.classes?.join(', '), l.subject].filter(Boolean).join(' · ');
  const state = cur ? ['Jetzt · bis ' + cur.end, cur.rooms.map(room).join(', ') || 'Unterricht', info(cur)]
    : next ? [`Gerade frei · ab ${next.start}`, next.rooms.map(room).join(', ') || next.subject, info(next)]
      : ['Heute', act.length ? 'Kein Unterricht mehr' : 'Kein Unterricht', ''];
  sheetBody.innerHTML = `<div class="hero glass" style="--c:${colorOf(p.name)}"><div class="kicker">${esc(state[0])}</div><div class="subject">${esc(state[1])}</div>${state[2] ? `<div class="where">${esc(state[2])}</div>` : ''}</div>
    ${source === 'regular' ? '<p class="footnote" style="text-align:left;margin:8px 4px 0">Laut regulärem Stundenplan der Schule – Vertretungen sind hier nicht berücksichtigt.</p>' : ''}
    ${lessons.length ? `<p class="label-sm">Heute</p><div class="list card">${lessons.map((l) => `
      <div class="row lesson${l === cur ? ' now' : ''}${l.cancelled ? ' cancelled' : ''}" style="--c:${colorOf(l.subject)}">
        <div class="time"><b>${esc(l.start || 'ganzt.')}</b><span>${esc(l.end)}</span></div><div class="bar"></div>
        <div class="main"><div class="title">${esc(l.subject)}</div><div class="sub">${esc([l.rooms.map(room).join(', '), l.classes?.join(', ')].filter(Boolean).join(' · '))}</div></div></div>`).join('')}</div>` : ''}`;
  sheetBody.classList.remove('swap'); void sheetBody.offsetWidth; sheetBody.classList.add('swap');
}

/* ---------------------------------------------------------------- Suche */
function openSearch() {
  openSheet('Suchen', `<div class="search-field card"><input id="q" type="search" placeholder="Aufgaben, Termine, Notizen, Nachrichten …" autocomplete="off" enterkeyhint="search" aria-label="Suchbegriff"></div><div id="results"><p class="footnote">Durchsucht Aufgaben, Termine, Notizen, Nachrichten, Stundenplan und Lehrkräfte.</p></div>`);
  const q = $('#q');
  q.focus({ preventScroll: true }); // noch in der Tipp-Geste, sonst öffnet iOS keine Tastatur
  q.oninput = () => { $('#results').innerHTML = searchResults(q.value); };
}
function searchResults(raw) {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return '<p class="footnote">Mindestens zwei Buchstaben eingeben.</p>';
  const has = (...s) => s.some((x) => String(x || '').toLowerCase().includes(q));
  const note = (n) => `<button class="row" data-note="${esc(n.id)}"><div class="main"><div class="title">${esc(n.title || n.body.split('\n')[0] || 'Notiz')}</div><div class="sub clamp2">${esc(n.body)}</div></div>${ICON.chev}</button>`;
  const groups = [
    ['Aufgaben', tasks().filter((x) => has(x.title, x.subject)).slice(0, 8).map(taskRow)],
    ['Termine', D.db.events.filter((e) => has(e.title, e.location, e.notes)).slice(0, 8).map((e) => eventRow(e))],
    ['Notizen', D.db.notes.filter((n) => has(n.title, n.body, n.subject)).slice(0, 8).map(note)],
    ['Nachrichten', S().messages.filter((m) => has(m.author, m.text, ...m.replies.map((r) => r.text))).slice(0, 8).map(msgRow)],
    ['Stundenplan', S().days.flatMap((d) => d.lessons.map((l, i) => [d.date, l, i])).filter(([, l]) => has(l.subject, l.teachers.join(' '), l.rooms.join(' '))).slice(0, 8).map(([d, l, i]) => lessonRow(l, d, i))],
    ['Lehrkräfte', (S().people || []).filter((p) => has(p.name)).slice(0, 6).map((p) => teacherRow(p))],
  ].filter(([, rows]) => rows.length);
  return groups.length ? groups.map(([t, rows]) => `<p class="label-sm">${t}</p><div class="list card">${rows.join('')}</div>`).join('')
    : `<div class="card empty slim">Nichts gefunden für „${esc(raw.trim())}“.</div>`;
}

/* ---------------------------------------------------------------- Hinweis-Kapsel (wie iOS-Systemmeldungen) */
let toastTimer;
function toast(text) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'glass'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = text;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------------------------------------------------------------- Profil: EduPage, Mitteilungen, Widget, Plesk */
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushReady = () => isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));

async function setPush(on) {
  if (on) {
    const perm = await Notification.requestPermission(); // muss direkt in der Nutzergeste passieren (iOS)
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Mitteilungen sind blockiert – erlaube sie in den Systemeinstellungen.' : 'Ohne Erlaubnis keine Mitteilungen.');
    const [{ key }, reg] = await Promise.all([api('/api/push/key'), navigator.serviceWorker.ready]);
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
    await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  } else {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
  }
}

function copy(text, hint) {
  navigator.clipboard.writeText(text).then(() => { hint.textContent = 'Kopiert.'; haptic(); }).catch(() => {
    hint.innerHTML = '<textarea readonly rows="5" class="copybox"></textarea>';
    $('textarea', hint).value = text;
    $('textarea', hint).select();
  });
}

let untisChoice = null, untisFound = []; // WebUntis: erst Schule suchen und wählen, dann anmelden
function untisPick() {
  const c = untisChoice;
  if (c) {
    return `${group(`<div class="row"><div class="main"><div class="title">${esc(c.name)}</div><div class="sub">${esc(c.address || c.server)}</div></div><button type="button" class="btn-link" data-untis-change>Ändern</button></div>`)}
      <input type="hidden" name="server" value="${esc(c.server)}"><input type="hidden" name="school" value="${esc(c.school)}"><input type="hidden" name="name" value="${esc(c.name)}">`;
  }
  return `${group(fRow('Schule', '<input id="untis-q" placeholder="Name oder Ort" autocapitalize="off" spellcheck="false" enterkeyhint="search">'),
    '<button type="button" class="row" data-untis-search><span class="btn-plain">Schule suchen</span></button>')}
    <div id="untis-results">${untisFound.length ? `<div class="list card">${untisFound.map((s, i) => `<button type="button" class="row" data-untis-school="${i}"><div class="main"><div class="title">${esc(s.name)}</div><div class="sub">${esc(s.address)}</div></div>${ICON.chev}</button>`).join('')}</div>` : ''}</div>`;
}
const LINK_HELP = {
  untis: 'Such deine Schule wie in der Untis-App und melde dich mit deinem WebUntis-Zugang an. Anmeldungen über Microsoft oder mit Zwei-Faktor-Code gehen noch nicht. Die Zugangsdaten liegen verschlüsselt auf dem Server und gehen nur an WebUntis.',
  schulmanager: 'Benutzername oder E-Mail und Passwort wie auf schulmanager-online.de. Mit Zwei-Faktor-Anmeldung geht es noch nicht. Die Zugangsdaten liegen verschlüsselt auf dem Server und gehen nur an Schulmanager.',
};
function edupageSection() {
  const e = D.link, kind = D.school === 'none' ? 'edupage' : D.school;
  if (D.demo) return group(`<div class="row"><div class="main"><div class="title">Demo-Daten</div><div class="sub">Im Demo-Modus ist keine Schulsoftware verbunden.</div></div></div>`);
  if (e.connected && !$('#sheet')?.dataset.editEdu) {
    const where = kind === 'untis' ? e.name || e.school : kind === 'schulmanager' ? 'Schulmanager' : `${e.school}.edupage.org`;
    return `${group(`<div class="row"><div class="main"><div class="title">Verbunden</div><div class="sub">${esc(e.user)} · ${esc(where)}</div></div></div>`,
      `<div class="row"><div class="main">Letzter Abgleich</div><div class="trail">${esc(ago(D.snap?.updated))}</div></div>`,
      `<button class="row" data-refresh><span class="btn-plain">Jetzt aktualisieren</span></button>`,
      `<button class="row" data-edit-edu><span class="btn-plain">Zugang ändern</span></button>`,
      `<button class="row" data-disconnect><span class="btn-plain danger">Verbindung trennen</span></button>`)}
      ${D.status?.ok === false ? `<p class="footnote warn-text">${esc(D.status.error)}</p>` : ''}`;
  }
  if (kind !== 'edupage') {
    if (kind === 'untis' && !untisChoice && e.server) untisChoice = { name: e.name || e.school, school: e.school, server: e.server, address: '' };
    return `<form class="form" id="edu-form" autocomplete="off">
      ${kind === 'untis' ? `<div id="untis-pick">${untisPick()}</div>` : ''}
      ${group(fText('user', kind === 'schulmanager' ? 'Benutzername oder E-Mail' : 'Benutzername', e.user, 'autocapitalize="off" spellcheck="false" required'),
        fText('pass', 'Passwort', '', 'type="password" autocomplete="new-password" required'))}
      <p class="form-error" role="alert"></p>
      <button class="btn-primary pressable" type="submit">${e.connected ? 'Sichern' : 'Verbinden'}</button>
      <p class="footnote" style="text-align:left">${LINK_HELP[kind]}</p></form>`;
  }
  return `<form class="form" id="edu-form" autocomplete="off">
    ${group(fRow('Schule', `<input name="school" placeholder="meineschule" value="${esc(e.school)}" autocapitalize="off" spellcheck="false" required><em class="suffix">.edupage.org</em>`),
      fText('user', 'Benutzername', e.user, 'autocapitalize="off" spellcheck="false" required'),
      fText('pass', 'Passwort', '', 'type="password" autocomplete="new-password" required'))}
    <p class="form-error" role="alert"></p>
    <button class="btn-primary pressable" type="submit">${e.connected ? 'Sichern' : 'Verbinden'}</button>
    <p class="footnote" style="text-align:left">Die Schul-Adresse ist der Teil vor „.edupage.org“. Die Zugangsdaten bleiben auf deinem Server und werden nur an EduPage geschickt.</p></form>`;
}

async function openSettings() {
  delete sheet.dataset.editEdu;
  const s = S().student || {};
  openSheet('Profil', `
    <div class="card row" style="padding:16px">
      <div class="avatar" style="--c:var(--blue);width:58px;height:58px;font-size:21px">${esc(initials(s.name || D.account?.name || 'Ich'))}</div>
      <div class="main"><div class="title">${esc(D.account?.name || s.name || 'Alltag')}</div><div class="sub">${D.account ? `${esc(schoolName(D.school))}${D.account.admin ? ' · Admin' : ''}` : s.class ? `Klasse ${esc(s.class)}` : 'Schule und Privates'}</div></div>
    </div>
    ${accountSection()}
    ${D.school === 'none' && !D.demo ? `<p class="label-sm">Stundenplan</p><div id="own-plan">${ownPlan()}</div>` : ''}
    <p class="label-sm">Ferien</p>
    ${group(fRow('Bundesland', `<select id="state-select">${[['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'], ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen']].map(([v, l]) => `<option value="${v}"${D.state === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`))}
    <p class="label-sm">Schulweg</p>
    ${group(
      `<button class="row" data-choose="place"><div class="main"><div class="title">Ort fürs Wetter</div></div><div class="trail">${esc(D.place?.name || 'Wählen')}</div>${ICON.chev}</button>`,
      `<button class="row" data-choose="home"><div class="main"><div class="title">Haltestelle zu Hause</div></div><div class="trail">${esc(D.stops?.home?.name || 'Wählen')}</div>${ICON.chev}</button>`,
      `<button class="row" data-choose="school"><div class="main"><div class="title">Haltestelle Schule</div></div><div class="trail">${esc(D.stops?.school?.name || 'Wählen')}</div>${ICON.chev}</button>`,
      fRow('Wecker-Vorlauf', `<select id="wake-lead">${[20, 30, 45, 60, 75, 90, 120].map((v) => `<option value="${v}"${D.wakeLead === v ? ' selected' : ''}>${v} Min.</option>`).join('')}</select>`))}
    <p class="footnote" style="margin-top:8px;text-align:left">Fahrplan mit Echtzeit aus dem bayerischen Nahverkehr (Bahnland Bayern), Wetter von Open-Meteo. Der Wecker richtet sich nach der Abfahrt zur ersten Stunde, ohne Haltestellen nach dem Unterrichtsbeginn.</p>
    <p class="label-sm">Ticket</p>
    <form class="form" id="ticket-form">${group(fText('name', 'Name, z. B. Allgäu-Walser-Pass', D.ticket?.name, 'maxlength="80"'),
      fText('url', 'Link zum Ticket (App oder Website)', D.ticket?.url, 'inputmode="url" autocapitalize="off" spellcheck="false" maxlength="1000"'),
      fRow('Gültig bis', `<input type="date" name="until" value="${esc(D.ticket?.until)}">`))}
      <button class="btn-plain pressable" type="submit">Ticket sichern</button></form>
    <p class="footnote" style="margin-top:0;text-align:left">Auf „Heute“ erscheint ein Knopf, der dein Ticket in der offiziellen App oder auf der Website öffnet. Vor dem Ablauf kommt eine Erinnerung (1 Woche, 1 Tag vorher und am Tag).</p>
    ${D.features?.ha === false ? '' : `
    <p class="label-sm">Home Assistant</p>
    <div id="ha-section">${haSection()}</div>
    <p class="label-sm">PC-Bildschirm</p>
    <div class="list card">
      <div class="row"><div class="main"><div class="sub">Am PC: 1. Programm laden · 2. Rechtsklick darauf → „Mit PowerShell ausführen“ (oder als HASS.Agent-Befehl) · 3. Hier oder auf „Heute“ unter Zuhause „Bildschirm“ öffnen. Tippen = Klick, lange drücken = Rechtsklick.</div></div></div>
      <button class="row" id="screen-dl" disabled><span class="btn-plain">Programm für den PC laden</span></button>
      <button class="row" data-screen><span class="btn-plain">Bildschirm öffnen</span></button>
    </div>
    <p class="footnote" style="margin-top:8px;text-align:left">Das Programm enthält einen eigenen Schlüssel – nicht weitergeben. Solange es läuft, kann jeder mit deinem Alltag-Passwort den PC sehen und steuern. Bei gesperrtem Windows gibt es kein Bild.</p>
    `}
    <p class="label-sm">Darstellung</p>
    <div class="card" style="padding:14px 16px">
      <div class="sub" style="margin-bottom:8px">Erscheinungsbild</div>
      ${fChoice('look', [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']], store.get('look-ui', 'auto'))}
      <div class="look-glass"><div class="sub" style="margin:14px 0 8px">Liquid Glass</div>
      ${fChoice('glass', [['tinted', 'Getönt'], ['clear', 'Klar']], store.get('glass-ui', 'tinted'))}
      <p class="look-hint">„Klar“ ist durchsichtiger und lässt mehr vom Hintergrund durchscheinen, „Getönt“ ist besser lesbar.</p></div>
    </div>
    ${D.school === 'none' ? '' : `<p class="label-sm">${linkName()}</p><div id="edu-section">${edupageSection()}</div>`}
    <p class="label-sm">Mitteilungen</p>
    <div class="list card">
      <label class="row"><div class="main"><div class="title">Mitteilungen</div><div class="sub">Vertretungen, Nachrichten, Erinnerungen, Termine und abends der Ausblick auf morgen</div></div>
        <input type="checkbox" class="switch" id="push-toggle" aria-label="Mitteilungen" disabled></label>
      <label class="row"><div class="main"><div class="title">Vor jeder Stunde</div><div class="sub">Kurz vorher: Fach, Raum, Lehrkraft und Vertretung</div></div>
        <input type="checkbox" class="switch" id="lesson-push"${D.lessonPush ? ' checked' : ''} aria-label="Mitteilung vor jeder Stunde"></label>
      <button class="row" id="push-test" hidden><span class="btn-plain">Test-Mitteilung senden</span></button>
    </div>
    <p class="footnote" id="push-hint" style="margin-top:8px;text-align:left"></p>
    <p class="label-sm">Widget (iPhone)</p>
    <div class="list card">
      <div class="row"><div class="main"><div class="sub">1. Gratis-App „Scriptable“ laden · 2. Skript kopieren · 3. In Scriptable „+“, einfügen, „Alltag“ nennen · 4. Widget „Scriptable“ hinzufügen und beim Bearbeiten „Alltag“ wählen</div></div></div>
      <button class="row" id="widget-copy" disabled><span class="btn-plain">Widget-Skript kopieren</span></button>
      ${D.account?.demo ? '' : '<button class="row" id="widget-rotate"><span class="btn-plain danger">Schlüssel erneuern</span></button>'}
    </div>
    <p class="footnote" id="widget-hint" style="margin-top:8px;text-align:left">Das Skript enthält einen eigenen Lese-Schlüssel – nicht weitergeben.</p>
    <p class="label-sm">Kurzbefehle (Siri)</p>
    <div class="list card">
      <div class="row"><div class="main"><div class="sub">In der App „Kurzbefehle“: neuer Kurzbefehl → Aktion „Inhalte von URL abrufen“ mit dieser Adresse → danach „Text sprechen“ oder „Ergebnis anzeigen“. Nenn ihn z. B. „Schule morgen“ – dann reicht „Hey Siri, Schule morgen“.</div></div></div>
      <button class="row" id="sc-today" disabled><span class="btn-plain">Adresse für „Heute“ kopieren</span></button>
      <button class="row" id="sc-tomorrow" disabled><span class="btn-plain">Adresse für „Morgen“ kopieren</span></button>
      <div class="row"><div class="main"><div class="sub"><b>Wecker:</b> Automation „Tageszeit 20:00“ → „Inhalte von URL abrufen“ (Wecker-Adresse) → „Wenn Inhalte einen Wert haben“ → „Wecker erstellen“ mit diesen Inhalten als Uhrzeit. Kein Unterricht = kein Wecker.</div></div></div>
      <button class="row" id="sc-wake" disabled><span class="btn-plain">Wecker-Adresse kopieren</span></button>
      <div class="row"><div class="main"><div class="sub"><b>Fokus:</b> Automation „Tageszeit 7:00“ (oder „Ankommen“ an der Schule) → „Inhalte von URL abrufen“ (Fokus-Adresse) → „Fokus festlegen“: Schule an, bis zu dieser Uhrzeit (= Schulschluss).</div></div></div>
      <button class="row" id="sc-focus" disabled><span class="btn-plain">Fokus-Adresse kopieren</span></button>
    </div>
    <p class="footnote" id="sc-hint" style="margin-top:8px;text-align:left">Die Adresse enthält deinen Lese-Schlüssel – nicht weitergeben.</p>
    <div id="cron-box"><p class="label-sm">Hintergrund-Abgleich</p>
    <div class="list card">
      <div class="row"><div class="main"><div class="sub">Die App hält sich auf dem Server selbst wach und gleicht alle 15 Minuten ab. Nach einem Server-Neustart startet sie erst wieder, wenn du sie öffnest. Noch zuverlässiger: diese Adresse beim kostenlosen Dienst cron-job.org alle 15 Minuten aufrufen lassen.</div></div></div>
      <button class="row" id="cron-copy" disabled><span class="btn-plain">Adresse kopieren</span></button>
    </div>
    <p class="footnote" id="cron-hint" style="margin-top:8px;text-align:left"></p></div>
    <div class="list card" style="margin-top:22px"><button class="row" id="logout"><span class="btn-plain danger">Abmelden</span></button></div>
    <p class="legal-links"><a target="_blank" rel="noopener" href="/impressum.html">Impressum</a><a target="_blank" rel="noopener" href="/datenschutz.html">Datenschutz</a></p>`);

  $('#logout').onclick = logout;
  $('#lesson-push').onchange = async (e) => {
    haptic();
    try { setData(await api('/api/settings', { method: 'POST', body: { lessonPush: e.target.checked } })); } catch (x) { e.target.checked = !e.target.checked; toast(x.message); }
  };
  $$('#sheet [data-choose]').forEach((b) => { b.onclick = () => openChooser(b.dataset.choose); });
  $('#ticket-form').onsubmit = async (e) => {
    e.preventDefault();
    try { setData(await api('/api/settings', { method: 'POST', body: { ticket: Object.fromEntries(new FormData(e.target)) } })); haptic(); toast('Ticket gesichert'); } catch (x) { toast(x.message); }
  };
  if (D.features?.ha !== false) wireHa();
  wireAccount();
  const rot = $('#widget-rotate');
  if (rot) rot.onclick = async () => { // falls der Lese-Schlüssel in falsche Hände geraten ist
    if (!rot.dataset.sure) { rot.dataset.sure = '1'; $('span', rot).textContent = 'Wirklich? Widget und Kurzbefehle musst du danach neu einrichten.'; return; }
    try { await api('/api/tokens/widget', { method: 'POST' }); haptic(); toast('Neuer Schlüssel. Bitte Widget-Skript und Kurzbefehle neu kopieren.'); openSettings(); } catch (x) { toast(x.message); }
  };
  $('#wake-lead').onchange = async (e) => {
    try { setData(await api('/api/settings', { method: 'POST', body: { wakeLead: Number(e.target.value) } })); haptic(); } catch (x) { toast(x.message); }
  };
  $('#state-select').onchange = async (e) => {
    try { setData(await api('/api/settings', { method: 'POST', body: { state: e.target.value } })); toast('Ferien aktualisiert'); } catch (x) { toast(x.message); }
  };
  $$('#sheet input[name=look], #sheet input[name=glass]').forEach((r) => {
    r.onchange = () => { // weicher Übergang statt hartem Helligkeitssprung
      try { localStorage.setItem(r.name, r.value); } catch { /* privater Modus */ }
      store.set(`${r.name}-ui`, r.value);
      haptic();
      if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(applyLook); else applyLook();
    };
  });
  wireEduForm();
  api('/api/tokens').then(async (tokens) => {
    const { widget, cron } = tokens;
    // vorher laden: Safari erlaubt das Kopieren nur direkt in der Tipp-Geste
    const tpl = await fetch('/widget.js').then((r) => r.text());
    const script = tpl.replace('__SERVER__', location.origin).replace('__TOKEN__', widget);
    const cronUrl = `${location.origin}/api/cron?key=${cron}`;
    $('#cron-box').hidden = !cron; // mit Konten nur für Admins
    $('#widget-copy').disabled = $('#cron-copy').disabled = false;
    $('#widget-copy').onclick = () => copy(script, $('#widget-hint'));
    $('#sc-today').disabled = $('#sc-tomorrow').disabled = $('#sc-wake').disabled = $('#sc-focus').disabled = false;
    $('#sc-wake').onclick = () => copy(`${location.origin}/api/wake?key=${widget}`, $('#sc-hint'));
    $('#sc-focus').onclick = () => copy(`${location.origin}/api/focus?key=${widget}`, $('#sc-hint'));
    $('#sc-today').onclick = () => copy(`${location.origin}/api/summary?day=heute&key=${widget}`, $('#sc-hint'));
    $('#sc-tomorrow').onclick = () => copy(`${location.origin}/api/summary?day=morgen&key=${widget}`, $('#sc-hint'));
    $('#cron-copy').onclick = () => copy(cronUrl, $('#cron-hint'));
    if (!tokens.screen || !$('#screen-dl')) return;
    const agent = (await fetch('/screen-agent.ps1').then((r) => r.text())).replace('__SERVER__', location.origin).replace('__KEY__', tokens.screen);
    $('#screen-dl').disabled = false;
    $('#screen-dl').onclick = () => { // mit BOM, damit Windows PowerShell die Datei als UTF-8 liest
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff', agent], { type: 'text/plain' }));
      a.download = 'alltag-fernsteuerung.ps1';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
  }).catch(() => {});

  const toggle = $('#push-toggle'), test = $('#push-test'), hint = $('#push-hint');
  const say = (t) => { hint.textContent = t; };
  if (D.features?.push === false) { toggle.disabled = true; say('In der Demo gibt es keine Mitteilungen.'); return; }
  if (!pushReady()) {
    say(isIOS && !standalone()
      ? 'Tippe in Safari auf Teilen → „Zum Home-Bildschirm“ und öffne Alltag von dort, um Mitteilungen zu erhalten.'
      : !isSecureContext ? 'Mitteilungen brauchen HTTPS – in Plesk ein SSL-Zertifikat (Let’s Encrypt) aktivieren.' : 'Dieser Browser unterstützt keine Mitteilungen.');
    return;
  }
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  toggle.checked = !!sub && Notification.permission === 'granted';
  toggle.disabled = Notification.permission === 'denied';
  test.hidden = !toggle.checked;
  if (toggle.disabled) say('Mitteilungen sind für diese App blockiert. Erlaube sie in den Systemeinstellungen.');
  toggle.onchange = () => {
    const on = toggle.checked;
    toggle.disabled = true;
    say('');
    setPush(on).then(() => { test.hidden = !on; if (on) say('Aktiv. Du bekommst ab jetzt Bescheid.'); haptic(); })
      .catch((e) => { toggle.checked = !on; say(e.message); })
      .finally(() => { toggle.disabled = false; });
  };
  test.onclick = () => api('/api/push/test', { method: 'POST' }).then((r) => say(r.ok ? 'Gesendet – kommt gleich an.' : 'Kein Gerät registriert.')).catch((e) => say(e.message));
}

/* ---------------------------------------------------------------- Konto, Admin-Bereich, eigener Stundenplan */
const schoolName = (k) => ({ edupage: 'EduPage', untis: 'WebUntis', schulmanager: 'Schulmanager', none: 'Ohne Schulsoftware' })[k] || k;
const linkName = () => schoolName(D?.school && D.school !== 'none' ? D.school : 'edupage');
const eduLike = () => !!D?.demo || D?.school === 'edupage'; // Antworten, Gefällt mir, Lehrkräfte: nur EduPage (Demo-Daten sehen wie EduPage aus)
const WEEKDAYS = [[1, 'Montag'], [2, 'Dienstag'], [3, 'Mittwoch'], [4, 'Donnerstag'], [5, 'Freitag'], [6, 'Samstag']];

function accountSection() {
  const a = D.account;
  if (!a) return '';
  const sid = `<button class="row" data-copy-support><div class="main"><div class="title">Support-ID</div><div class="sub" id="support-hint">Nenn sie, wenn du Hilfe brauchst. Tippen kopiert.</div></div><div class="trail code">${esc(a.support)}</div></button>`;
  if (a.demo) return `<p class="label-sm">Konto</p>${group(sid)}<p class="footnote" style="text-align:left;margin-top:8px">${a.jury ? 'Jugend forscht Version · Full Access. Alle Funktionen sind frei, die Beispieldaten setzt der Betreiber zurück.' : 'Das ist ein Demo-Konto mit Beispieldaten. Was du hier änderst, wird 15 Minuten nach dem letzten Besuch zurückgesetzt.'}</p>`;
  return `<p class="label-sm">Konto</p>
    ${group(sid, fRow('Schulsoftware', `<select id="school-select">${SCHOOL_OPTS.map(([v, l]) => `<option value="${v}"${D.school === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`),
      D.accountsUrl ? `<a class="row" href="${esc(D.accountsUrl)}/konto"><div class="main"><div class="title">Konto verwalten</div><div class="sub">${esc(a.email || 'E-Mail')}, Passwort, Geräte, Konto löschen</div></div>${ICON.chev}</a>` : '',
      a.admin ? `<a class="row" href="/admin"><div class="main"><div class="title">Verwaltung öffnen</div><div class="sub">Einladungen, Flyer und Konten</div></div>${ICON.chev}</a>` : '')}`;
}
function wireAccount() {
  const sel = $('#school-select');
  if (sel) {
    sel.onchange = async () => {
      try { setData(await api('/api/account', { method: 'POST', body: { school: sel.value } })); haptic(); openSettings(); }
      catch (x) { toast(x.message); }
    };
  }
  const sup = $('#sheet [data-copy-support]');
  if (sup) sup.onclick = () => copy(D.account.support, $('#support-hint'));
  $$('#sheet [data-lesson]').forEach((b) => { b.onclick = () => lessonForm(D.db.lessons.find((l) => l.id === b.dataset.lesson)); });
  $('#sheet [data-new-lesson]')?.addEventListener('click', () => lessonForm());
}
/* ---------------------------------------------------------------- Verwaltung: eigene Seite /admin, nur für Admins */
const ADMIN_PAGE = location.pathname === '/admin';
let adminState = null, lastFlyer = null;
const shownCode = (c) => String(c).replace(/^(\d{3})(\d{3})$/, '$1 $2'); // 482 913 liest sich leichter vor
// Balken je Tag (eine Reihe, eine Farbe). Tooltip beim Zeigen, Zahlen zusätzlich als Tabelle.
function dayBars(days, key, unit) {
  const W = 360, H = 136, B = 114, n = days.length, gap = 2, bw = (W - (n - 1) * gap) / n, max = Math.max(1, ...days.map((d) => d[key])); // ~Handybreite: Schrift bleibt lesbar
  const y = (v) => B - (v / max) * (B - 22), day = (d) => F.short.format(parseDay(d.date));
  const bars = days.map((d, i) => {
    const x = i * (bw + gap), v = d[key], top = y(v), r = Math.min(4, bw / 2, B - top);
    const shape = v ? `<path d="M${x} ${B}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${B}Z"/>` : '';
    return `<g><title>${esc(day(d))}: ${v} ${unit}</title><rect class="hit" x="${x - gap / 2}" y="0" width="${bw + gap}" height="${B}"/>${shape}</g>`;
  }).join('');
  const total = days.reduce((s, d) => s + d[key], 0), last = days.at(-1);
  return `<svg class="day-bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${unit} pro Tag, letzte ${n} Tage: zusammen ${total}, höchstens ${max}, heute ${last[key]}`)}">
    <line class="grid" x1="0" x2="${W}" y1="22" y2="22"/><text x="0" y="14">${max}</text>${bars}<line class="base" x1="0" x2="${W}" y1="${B}" y2="${B}"/>
    <text x="0" y="${H - 4}">${esc(day(days[0]))}</text><text x="${W}" y="${H - 4}" text-anchor="end">heute</text></svg>`;
}
function statsSection(s) {
  if (!s) return '';
  const sum = (k, n = 30) => s.days.slice(-n).reduce((a, d) => a + d[k], 0), today = s.days.at(-1);
  const share = (obj, total) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="row"><div class="main"><div class="title">${esc(k)}</div>
    <div class="meter" aria-hidden="true"><i style="width:${total ? Math.round((v / total) * 100) : 0}%"></i></div></div><div class="trail">${v}${total ? ` · ${Math.round((v / total) * 100)} %` : ''}</div></div>`).join('');
  const dev = Object.values(s.platforms).reduce((a, b) => a + b, 0);
  const USE = [['link', 'Schulsoftware verbunden oder Stundenplan eingetragen'], ['push', 'Mitteilungen an'], ['events', 'Termine'], ['reminders', 'Erinnerungen'], ['grades', 'Noten'], ['notes', 'Notizen'], ['photos', 'Tafelbilder']];
  const table = `<details class="stats-table"><summary>Zahlen als Tabelle</summary><table><thead><tr><th>Tag</th><th>Besucher</th><th>Aufrufe</th><th>Aktive Konten</th><th>Neue Konten</th><th>Demo</th></tr></thead>
    <tbody>${s.days.slice().reverse().map((d) => `<tr><td>${esc(F.short.format(parseDay(d.date)))}</td><td>${d.visitors}</td><td>${d.views}</td><td>${d.active}</td><td>${d.signups}</td><td>${d.demo}</td></tr>`).join('')}</tbody></table></details>`;
  return `<section class="card admin-card wide">
      <h2>Statistik</h2>
      <p class="sub">Ohne Cookies und ohne fremde Dienste. Besucher zählen je Tag einmal, eigene Besuche als Admin und Demo-Konten zählen nicht.</p>
      <div class="admin-stats">${[[today.visitors, 'Besucher heute'], [sum('visitors'), 'Besuche in 30 Tagen'], [today.active, 'Konten heute in der App'], [sum('signups'), 'neue Konten in 30 Tagen']]
        .map(([n, l]) => `<div class="card admin-stat"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
      <div class="stats-charts"><figure><figcaption>Besucher der Website pro Tag</figcaption>${dayBars(s.days, 'visitors', 'Besucher')}</figure>
        <figure><figcaption>Konten pro Tag in der App</figcaption>${dayBars(s.days, 'active', 'Konten')}</figure></div>
      ${table}
      <div class="stats-lists">
        <div><h3>Geräte der Besucher (30 Tage)</h3>${dev ? group(share(s.platforms, dev)) : '<p class="footnote">Noch keine Besuche.</p>'}</div>
        <div><h3>Schulsoftware der Konten</h3>${s.accounts ? group(share(Object.fromEntries(Object.entries(s.schools).map(([k, v]) => [schoolName(k), v])), s.accounts)) : '<p class="footnote">Noch keine Konten.</p>'}</div>
        <div><h3>Was genutzt wird (von ${s.accounts} Konten)</h3>${group(...USE.map(([k, l]) => `<div class="row"><div class="main"><div class="title">${l}</div></div><div class="trail">${s.use[k]}</div></div>`))}</div>
        <div><h3>Aktivität</h3>${group(...[[s.active.day, 'aktiv in 24 Stunden'], [s.active.week, 'aktiv in 7 Tagen'], [s.active.month, 'aktiv in 30 Tagen'], [sum('logins'), 'Anmeldungen in 30 Tagen'], [sum('demo'), 'Demo gestartet in 30 Tagen'], [sum('views'), 'Seitenaufrufe in 30 Tagen']]
          .map(([v, l]) => `<div class="row"><div class="main"><div class="title">${l}</div></div><div class="trail">${v}</div></div>`))}</div>
      </div>
    </section>`;
}
async function openAdmin(data) {
  if (!ADMIN_PAGE) { location.href = '/admin'; return; }
  try { data ||= await api('/api/admin'); } catch (x) { toast(x.message); return; }
  data.stats ||= adminState?.stats; // nach Aktionen schickt der Server keine neue Statistik mit
  adminState = data;
  let el = $('#admin-page');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-page';
    el.className = 'admin-page';
    document.body.append(el);
    appEl.inert = true; // die App darunter ist hier nicht bedienbar, Sheets (Konto-Details) liegen darüber
  }
  const nameOf = (id) => data.accounts.find((a) => a.id === id)?.name || 'gelöschtes Konto';
  const single = data.invites.filter((i) => !i.uses && i.open), flyers = data.invites.filter((i) => i.uses).reverse();
  const used = data.invites.filter((i) => !i.uses && i.usedBy).slice(-10).reverse();
  const active = data.accounts.filter((a) => a.lastSeen && Date.now() - Date.parse(a.lastSeen) < 7 * 864e5).length;
  const site = (data.site || location.host).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const opt = (name, values, label, sel) => `<select name="${name}">${values.map((v) => `<option value="${v}"${v === sel ? ' selected' : ''}>${label(v)}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="admin-wrap">
    <header class="admin-head"><img src="/icon.svg" alt="" width="48" height="48"><div class="main"><p class="eyebrow">Alltag</p><h1>Verwaltung</h1></div><a class="btn-ghost" href="/">Zur App</a></header>
    <p class="footnote" id="acc-health" style="text-align:left;margin:0">Prüfe Konto-Dienst und Mailversand …</p>
    <div class="admin-stats">${[[data.accounts.length, 'Konten'], [active, 'aktiv in den letzten 7 Tagen'], [single.length, 'offene Einladungen'], [flyers.reduce((n, i) => n + i.usedCount, 0), 'über Flyer angemeldet']]
      .map(([n, l]) => `<div class="card admin-stat"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
    <div class="admin-grid">
      ${statsSection(data.stats)}
      <section class="card admin-card">
        <h2>Flyer (A6, doppelseitig)</h2>
        <p class="sub">Ein Code für alle Flyer: Er gilt für die gewählte Zahl an Anmeldungen und bis zum Ablaufdatum. Du bekommst eine ZIP-Datei mit Vorder- und Rückseite als Bild (z. B. für den dm-Fotodruck) und eine Druck-PDF für Druckereien.</p>
        <form class="form" id="flyer-form">${group(fRow('Anmeldungen', opt('uses', [50, 100, 200, 500], (v) => `bis zu ${v}`, 100)), fRow('Gültig', opt('days', [30, 60, 90], (v) => `${v} Tage`, 90)),
          fText('email', 'Deine E-Mail für Fragen', data.legal?.email, 'type="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="120"'),
          fText('site', 'Adresse der App', site, 'autocapitalize="off" spellcheck="false" maxlength="60" required'))}
          <button class="btn-primary pressable" type="submit">Code und Flyer erstellen</button></form>
        <div id="flyer-preview" class="flyer-previews"></div>
      </section>
      <section class="card admin-card">
        <h2>Einladung für eine Person</h2>
        <p class="sub">6 Ziffern, nur einmal nutzbar, 7 Tage gültig.</p>
        <form class="form" id="invite-form">${group(fText('note', 'Für wen? (siehst nur du)', '', 'maxlength="80"'))}
          <button class="btn-primary pressable" type="submit">Einladungscode erstellen</button></form>
        <p class="footnote" id="invite-hint" style="text-align:left"></p>
        ${single.length ? group(...single.map((i) => `<div class="row"><div class="main"><div class="title code">${esc(shownCode(i.code))}</div><div class="sub">${esc(i.note || 'ohne Notiz')} · gültig bis ${esc(F.short.format(new Date(i.expires)))}</div>
          <div class="code-actions"><button class="btn-plain" type="button" data-copy-code="${esc(i.code)}">Kopieren</button><button class="btn-plain danger" type="button" data-del-code="${esc(i.code)}">Löschen</button></div></div></div>`))
          : '<p class="footnote" style="text-align:left">Keine offenen Einladungen.</p>'}
      </section>
      <section class="card admin-card wide">
        <h2>Flyer-Codes</h2>
        ${flyers.length ? group(...flyers.map((i) => `<div class="row"><div class="main"><div class="title code">${esc(shownCode(i.code))}</div>
          <div class="sub">${esc(i.note || 'Flyer')} · ${i.usedCount} von ${i.uses} Anmeldungen · ${i.open ? `gültig bis ${esc(F.short.format(new Date(i.expires)))}` : 'beendet'}</div>
          ${i.open ? `<div class="code-actions"><button class="btn-plain" type="button" data-flyer="${esc(i.code)}">Flyer laden</button><button class="btn-plain danger" type="button" data-del-code="${esc(i.code)}">Stoppen</button></div>` : ''}</div></div>`))
          : '<p class="footnote" style="text-align:left">Noch keine Flyer.</p>'}
      </section>
      <section class="card admin-card wide">
        <h2>Konten (${data.accounts.length})</h2>
        ${group(`<label class="field"><input id="acc-q" type="search" placeholder="Name oder Support-ID" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`)}
        <div class="list card" id="acc-list">${data.accounts.map((a) => `<button class="row" data-acc="${esc(a.id)}" data-q="${esc(`${a.name} ${a.support} ${a.support.replace('-', '')}`.toLowerCase())}"><div class="main"><div class="title">${esc(a.name)}${a.admin ? ' · Admin' : ''}${a.jury ? ' · Jugend forscht' : a.demo ? ' · Demo' : ''}${a.disabled ? ' · gesperrt' : ''}</div>
          <div class="sub"><span class="code">${esc(a.support)}</span> · ${esc(schoolName(a.school))} · ${a.lastSeen ? `aktiv ${esc(ago(a.lastSeen))}` : `angelegt ${esc(ago(a.created))}`}</div></div>${ICON.chev}</button>`).join('')}</div>
      </section>
      ${used.length ? `<section class="card admin-card wide"><h2>Zuletzt eingelöste Einladungen</h2>${group(...used.map((i) => `<div class="row"><div class="main"><div class="title code">${esc(shownCode(i.code))}</div><div class="sub">${esc(i.note || 'ohne Notiz')} → ${esc(nameOf(i.usedBy))}</div></div></div>`))}</section>` : ''}
    </div></div>`;
  api('/api/admin/health').then((h) => {
    const box = $('#acc-health', el);
    if (box) box.textContent = h.ok ? `Konto-Dienst erreichbar · Mailversand: ${h.mail} · ${h.unconfirmed} Konten warten auf E-Mail-Bestätigung` : `Konto-Dienst nicht erreichbar: ${h.error}`;
  }, () => {});
  const hint = $('#invite-hint', el), preview = () => { if (lastFlyer) $('#flyer-preview', el).innerHTML = `<img src="${lastFlyer.front}" alt="Vorderseite des Flyers"><img src="${lastFlyer.back}" alt="Rückseite des Flyers">`; };
  preview();
  $('#invite-form', el).onsubmit = async (e) => {
    e.preventDefault();
    try { const d = await api('/api/admin/invites', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); haptic(); openAdmin(d); } catch (x) { hint.textContent = x.message; }
  };
  $$('[data-copy-code]', el).forEach((b) => { b.onclick = () => copy(b.dataset.copyCode, hint); });
  $$('[data-del-code]', el).forEach((b) => {
    b.onclick = async () => {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Sicher?'; return; }
      try { openAdmin(await api(`/api/admin/invites/${encodeURIComponent(b.dataset.delCode)}`, { method: 'DELETE' })); } catch (x) { toast(x.message); }
    };
  });
  const form = $('#flyer-form', el), opts = () => Object.fromEntries(new FormData(form));
  const makeFlyer = async (inv, btn) => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Erstelle Flyer …';
    try {
      const { flyerA6 } = await import('/flyer.mjs');
      lastFlyer = await flyerA6({ code: inv.code, until: new Date(inv.expires).toLocaleDateString('de-DE'), email: opts().email.trim(), site: opts().site.trim(), name: data.legal?.name, address: data.legal?.address });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(lastFlyer.zip);
      a.download = `alltag-flyer-${inv.code}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      haptic();
      preview();
    } catch (x) { toast(x.message); }
    btn.disabled = false;
    btn.textContent = label;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    try {
      const b = opts(), d = await api('/api/admin/invites', { method: 'POST', body: { uses: Number(b.uses), days: Number(b.days), note: `Flyer ${F.short.format(now())}` } });
      await makeFlyer(d.invites.find((i) => i.code === d.created[0]), btn);
      toast('Flyer erstellt');
      openAdmin(d);
    } catch (x) { toast(x.message); }
  };
  $$('[data-flyer]', el).forEach((b) => { b.onclick = () => makeFlyer(data.invites.find((i) => i.code === b.dataset.flyer), b); });
  $$('[data-acc]', el).forEach((b) => { b.onclick = () => openAcc(data.accounts.find((a) => a.id === b.dataset.acc)); });
  $('#acc-q', el).oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $$('#acc-list [data-acc]', el).forEach((b) => { b.hidden = !!q && !b.dataset.q.includes(q); }); };
}
function openAcc(a, password) {
  const self = a.id === D.account?.id;
  openSheet(a.name, `
    ${group(`<div class="row"><div class="main">Support-ID</div><div class="trail code">${esc(a.support)}</div></div>`,
      a.email ? `<div class="row"><div class="main">E-Mail</div><div class="trail">${esc(a.email)}${a.emailOk ? '' : ' (unbestätigt)'}</div></div>` : '',
      `<div class="row"><div class="main">Schulsoftware</div><div class="trail">${esc(a.demo ? 'Demo-Daten' : schoolName(a.school))}</div></div>`,
      `<div class="row"><div class="main">Angelegt</div><div class="trail">${esc(ago(a.created))}</div></div>`,
      `<div class="row"><div class="main">Zuletzt aktiv</div><div class="trail">${esc(ago(a.lastSeen))}</div></div>`)}
    ${password ? `<p class="label-sm">Neues Passwort</p>${group(`<div class="row"><div class="main"><div class="title code">${esc(password)}</div><div class="sub">Nur jetzt sichtbar. Gib es ${esc(a.name)} persönlich weiter.</div><div class="code-actions"><button class="btn-plain" type="button" data-copy-pw>Kopieren</button></div></div></div>`)}<p class="footnote" id="acc-hint" style="text-align:left"></p>` : ''}
    ${self ? '<p class="footnote" style="text-align:left">Das ist dein eigenes Konto. E-Mail, Passwort und Löschen findest du auf der Konto-Seite (Profil → Konto verwalten).</p>'
      : group('<button class="row" data-do="reset"><span class="btn-plain">Passwort zurücksetzen</span></button>',
        a.demo ? '' : `<button class="row" data-do="admin"><span class="btn-plain">${a.admin ? 'Admin-Rechte entziehen' : 'Zum Admin machen'}</span></button>`,
        a.demo ? `<button class="row" data-do="jury"><span class="btn-plain">${a.jury ? 'Jugend-forscht-Kennzeichnung entfernen' : 'Als „Jugend forscht Version · Full Access“ kennzeichnen'}</span></button>` : '',
        a.demo ? '<button class="row" data-do="resetDemo"><span class="btn-plain">Demo-Daten zurücksetzen</span></button>' : '',
        a.admin ? '' : `<button class="row" data-do="demo"><span class="btn-plain">${a.demo ? 'Demo-Konto beenden' : 'Als Demo-Konto einrichten'}</span></button>`,
        `<button class="row" data-do="disable"><span class="btn-plain${a.disabled ? '' : ' danger'}">${a.disabled ? 'Entsperren' : 'Sperren'}</span></button>`,
        '<button class="row" data-do="delete"><span class="btn-plain danger">Konto löschen</span></button>')}
    <button class="btn-plain" type="button" data-back style="margin-top:12px">Zurück</button>`);
  $('#sheet [data-back]').onclick = () => closeSheet();
  const pwBtn = $('#sheet [data-copy-pw]');
  if (pwBtn) pwBtn.onclick = () => copy(password, $('#acc-hint'));
  const url = `/api/admin/accounts/${encodeURIComponent(a.id)}`;
  $$('#sheet [data-do]').forEach((b) => {
    b.onclick = async () => {
      const act = b.dataset.do;
      const ask = { delete: 'Wirklich löschen? Alle Daten sind dann weg.', reset: 'Wirklich zurücksetzen?', resetDemo: 'Wirklich? Alles, was Besucher eingetragen haben, ist dann weg.', demo: a.demo ? 'Wirklich beenden? Das Konto ist danach leer.' : 'Wirklich? Alle Daten des Kontos werden durch Beispieldaten ersetzt.' }[act];
      if (ask && !b.dataset.sure) { b.dataset.sure = '1'; $('span', b).textContent = ask; return; }
      try {
        if (act === 'delete') { const d = await api(url, { method: 'DELETE' }); closeSheet(); return openAdmin(d); }
        const body = act === 'reset' ? { reset: true } : act === 'admin' ? { admin: !a.admin } : act === 'demo' ? { demo: !a.demo } : act === 'jury' ? { jury: !a.jury } : act === 'resetDemo' ? { resetDemo: true } : { disabled: !a.disabled };
        const d = await api(url, { method: 'POST', body });
        haptic();
        if (act === 'resetDemo') toast('Demo-Daten zurückgesetzt');
        openAdmin(d);
        openAcc(d.accounts.find((x) => x.id === a.id), d.password);
      } catch (x) { toast(x.message); }
    };
  });
}

// Ohne Schulsoftware: Stunden selbst eintragen, jede Woche gleich
function ownPlan() {
  const ls = D.db.lessons || [];
  const rows = WEEKDAYS.flatMap(([n, name]) => ls.filter((l) => l.day === n).sort((a, b) => a.start.localeCompare(b.start)).map((l, i) =>
    `<button class="row" data-lesson="${esc(l.id)}"><div class="main"><div class="title">${esc(l.subject)}</div><div class="sub">${i ? '' : `${name} · `}${esc(l.start)}–${esc(l.end)}${l.room ? ` · ${esc(room(l.room))}` : ''}${l.teacher ? ` · ${esc(l.teacher)}` : ''}</div></div>${ICON.chev}</button>`));
  return `${group(...rows, '<button class="row" data-new-lesson><span class="btn-plain">Stunde hinzufügen</span></button>')}
    <p class="footnote" style="margin-top:8px;text-align:left">Jede Woche gleich. In den Ferien bleibt der Plan leer (Bundesland unter „Ferien“).</p>`;
}
function lessonForm(l) {
  const last = (D.db.lessons || []).at(-1); // neue Stunde: gleicher Tag wie zuletzt, beginnt nach deren Ende
  formSheet('lessons', l, l ? l.subject : 'Neue Stunde', `
    ${group(fText('subject', 'Fach', l?.subject, 'required list="subjects" maxlength="80"'), fText('room', 'Raum (optional)', l?.room, 'maxlength="40"'), fText('teacher', 'Lehrkraft (optional)', l?.teacher, 'maxlength="80"'))}
    ${group(fRow('Tag', `<select name="day">${WEEKDAYS.map(([n, name]) => `<option value="${n}"${(l?.day ?? last?.day ?? 1) === n ? ' selected' : ''}>${name}</option>`).join('')}</select>`),
      fRow('Beginn', `<input type="time" name="start" required value="${esc(l?.start || last?.end || '08:00')}">`),
      fRow('Ende', `<input type="time" name="end" required value="${esc(l?.end || '')}">`))}`, () => load().then(openSettings));
}

// Home Assistant: verbinden, Einkaufsliste wählen, freigegebene Knöpfe (nur diese darf die App auslösen)
function haSection() {
  const h = D.ha || {};
  if (!h.connected) {
    return `<form class="form" id="ha-form" autocomplete="off">
      ${group(fText('url', 'Adresse, z. B. https://xyz.ui.nabu.casa', '', 'inputmode="url" autocapitalize="off" spellcheck="false" required'), fText('token', 'Langlebiges Zugriffstoken', '', 'type="password" autocomplete="off" required'))}
      <p class="form-error" role="alert"></p>
      <button class="btn-primary pressable" type="submit">Verbinden</button>
      <p class="footnote" style="text-align:left">Für Einkaufsliste (z. B. Cookidoo) und PC-Knöpfe. Token: In Home Assistant unten links auf dein Profil → Sicherheit → „Langlebige Zugriffstoken“ → Erstellen. Die Adresse muss aus dem Internet erreichbar sein (z. B. Nabu Casa) – „homeassistant.local“ reicht nicht.</p></form>`;
  }
  return `${group(`<div class="row"><div class="main"><div class="title">Verbunden</div><div class="sub">${esc(h.url)}</div></div></div>`,
      fRow('Einkaufsliste', `<select id="ha-todo"><option value="${esc(h.todo)}">${esc(h.todo || 'Lädt …')}</option></select>`),
      '<button class="row" id="ha-off" type="button"><span class="btn-plain danger">Trennen</span></button>')}
    <p class="label-sm">Knöpfe auf „Heute“</p>
    <div class="list card" id="ha-pc"><div class="row"><div class="spinner"></div></div></div>
    <p class="footnote" style="margin-top:8px;text-align:left">Nur was du hier einschaltest, kann die App auslösen. PC einschalten: Integration „Wake on LAN“. Programme öffnen, sperren, herunterfahren: HASS.Agent auf dem PC – dessen Befehle erscheinen hier als Knöpfe.</p>`;
}
function wireHa() {
  const f = $('#ha-form');
  if (f) {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', f), err = $('.form-error', f);
      btn.disabled = true;
      btn.textContent = 'Verbinde …';
      err.textContent = '';
      try { setData(await api('/api/ha', { method: 'POST', body: Object.fromEntries(new FormData(f)) })); haptic(); $('#ha-section').innerHTML = haSection(); wireHa(); }
      catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Verbinden'; }
    };
    return;
  }
  $('#ha-off').onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = '1'; $('span', b).textContent = 'Wirklich trennen?'; return; }
    try { setData(await api('/api/ha', { method: 'DELETE' })); $('#ha-section').innerHTML = haSection(); wireHa(); } catch (x) { toast(x.message); }
  };
  api('/api/ha/entities').then((list) => {
    const sel = $('#ha-todo'), box = $('#ha-pc');
    if (!sel || !box) return;
    const todos = list.filter((x) => x.id.startsWith('todo.')), pcs = list.filter((x) => !x.id.startsWith('todo.'));
    sel.innerHTML = `<option value="">Keine</option>${todos.map((x) => `<option value="${esc(x.id)}"${x.id === D.ha.todo ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}`;
    sel.onchange = async () => { try { setData(await api('/api/settings', { method: 'POST', body: { haTodo: sel.value } })); shop = { items: null, error: '', at: 0 }; haptic(); } catch (x) { toast(x.message); } };
    box.innerHTML = pcs.length ? pcs.map((x) => `<label class="row"><div class="main"><div class="title">${esc(x.name)}</div><div class="sub">${esc(x.id)}</div></div>
        <input type="checkbox" class="switch" value="${esc(x.id)}"${D.ha.pc.includes(x.id) ? ' checked' : ''} aria-label="${esc(x.name)} auf Heute zeigen"></label>`).join('')
      : '<div class="row"><div class="main"><div class="sub">Keine Knöpfe, Skripte oder Schalter gefunden.</div></div></div>';
    $$('input', box).forEach((c) => {
      c.onchange = async () => {
        try { setData(await api('/api/settings', { method: 'POST', body: { haPc: $$('input:checked', box).map((x) => x.value) } })); pcState = { list: null, at: 0 }; haptic(); } catch (x) { c.checked = !c.checked; toast(x.message); }
      };
    });
  }).catch((x) => { const box = $('#ha-pc'); if (box) box.innerHTML = `<div class="row"><div class="main"><div class="sub warn-text">${esc(x.message)}</div></div></div>`; });
}

// Ort (Wetter) oder Haltestelle suchen und übernehmen
function openChooser(kind) {
  const place = kind === 'place', cur = place ? D.place : D.stops?.[kind];
  openSheet(place ? 'Ort fürs Wetter' : kind === 'home' ? 'Haltestelle zu Hause' : 'Haltestelle Schule', `
    ${group(`<label class="field"><input id="choose-q" type="search" placeholder="${place ? 'Ort, z. B. Sonthofen' : 'Haltestelle, z. B. Sonthofen Bahnhof'}" autocomplete="off" enterkeyhint="search"></label>`)}
    <div id="choose-list" style="margin-top:12px"></div>
    ${cur ? `<button class="btn-plain danger" id="choose-clear" type="button" style="margin-top:12px">„${esc(cur.name)}“ entfernen</button>` : ''}
    <button class="btn-plain" id="choose-back" type="button" style="margin-top:8px">Zurück</button>`);
  const q = $('#choose-q'), list = $('#choose-list');
  let timer, seq = 0;
  const choose = async (r) => {
    const body = place ? { place: r && { name: r.name, lat: r.lat, lon: r.lon } } : { stops: { [kind]: r && { id: r.id, name: r.name } } };
    try { setData(await api('/api/settings', { method: 'POST', body })); haptic(); openSettings(); } catch (x) { toast(x.message); }
  };
  q.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const n = ++seq, text = q.value.trim();
      if (text.length < 2) { list.innerHTML = ''; return; }
      list.innerHTML = '<div class="card row"><div class="spinner"></div></div>';
      try {
        const rows = await api(`/api/${place ? 'places' : 'stops'}?q=${encodeURIComponent(text)}`);
        if (n !== seq) return;
        list.innerHTML = rows.length ? `<div class="list card">${rows.map((r) => `<button class="row"><div class="main"><div class="title">${esc(r.name)}</div>${r.region ? `<div class="sub">${esc(r.region)}</div>` : ''}</div></button>`).join('')}</div>`
          : '<p class="footnote">Nichts gefunden.</p>';
        $$('button', list).forEach((b, i) => { b.onclick = () => choose(rows[i]); });
      } catch (x) { if (n === seq) list.innerHTML = `<p class="footnote warn-text">${esc(x.message)}</p>`; }
    }, 300);
  };
  if (matchMedia('(hover: hover)').matches) q.focus();
  $('#choose-back').onclick = openSettings;
  if (cur) $('#choose-clear').onclick = () => choose(null);
}

function wireUntisPick() {
  const box = $('#untis-pick');
  if (!box) return;
  const redraw = () => { box.innerHTML = untisPick(); wireUntisPick(); };
  const search = async () => {
    const q = $('#untis-q').value.trim(), out = $('#untis-results'), err = $('#edu-form .form-error');
    err.textContent = '';
    if (q.length < 3) { err.textContent = 'Bitte mindestens 3 Zeichen eingeben.'; return; }
    out.innerHTML = '<p class="footnote">Suche …</p>';
    try {
      untisFound = (await api(`/api/untis/schools?q=${encodeURIComponent(q)}`)).schools;
      if (!untisFound.length) { out.innerHTML = '<p class="footnote">Keine Schule gefunden. Versuch es mit dem Ort oder einem Teil des Namens.</p>'; return; }
      redraw();
      $('#untis-q').value = q;
    } catch (x) { out.innerHTML = ''; err.textContent = x.message; }
  };
  const q = $('#untis-q');
  if (q) q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
  const btn = $('[data-untis-search]', box);
  if (btn) btn.onclick = search;
  $$('[data-untis-school]', box).forEach((b) => { b.onclick = () => { untisChoice = untisFound[Number(b.dataset.untisSchool)]; untisFound = []; redraw(); haptic(); }; });
  const change = $('[data-untis-change]', box);
  if (change) change.onclick = () => { untisChoice = null; redraw(); $('#untis-q').focus(); };
}
function wireEduForm() {
  const f = $('#edu-form');
  if (!f) return;
  wireUntisPick();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', f), err = $('.form-error', f);
    if ($('#untis-pick') && !untisChoice) { err.textContent = 'Bitte such zuerst deine Schule und wähl sie aus.'; return; }
    btn.disabled = true;
    btn.textContent = `Verbinde mit ${linkName()} …`;
    err.textContent = '';
    try {
      setData(await api(eduLike() ? '/api/edupage' : '/api/link', { method: 'POST', body: Object.fromEntries(new FormData(f)) }));
      untisChoice = null;
      delete sheet.dataset.editEdu;
      haptic();
      $('#edu-section').innerHTML = edupageSection();
    } catch (x) {
      err.textContent = x.message;
      btn.disabled = false;
      btn.textContent = D.link.connected ? 'Sichern' : 'Verbinden';
    }
  };
}

async function logout() {
  const r = await api('/api/logout', { method: 'POST' }).catch(() => ({}));
  for (const k of await caches.keys().catch(() => [])) (await caches.open(k)).delete('/api/data');
  if (r.accountsUrl) { location.href = `${r.accountsUrl}/abmelden`; return; } // auch auf der Konto-Seite abmelden
  closeSheet();
  D = null;
  showLogin();
}

/* ---------------------------------------------------------------- Anmelden: private App mit Passwort, öffentliche Version über die Konto-Seite */
let info = null; // Demo? Konten? Adresse der Konto-Seite (vom Server, ohne Anmeldung lesbar)
const SCHOOL_OPTS = [['edupage', 'EduPage'], ['untis', 'WebUntis'], ['schulmanager', 'Schulmanager'], ['none', 'Keine']];
function loginMode() {
  const f = $('#login form'), acc = !!info?.accounts;
  $('.login-fields', f).hidden = acc;
  f.password.required = !acc;
  $('button[type=submit]', f).hidden = acc;
  $('.konto-links', f)?.remove();
  if (acc && info.accountsUrl) { // Anmelden und Registrieren auf accounts.alltag-app.de, danach kommt man hierher zurück
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    $('.login-error', f).insertAdjacentHTML('beforebegin', `<div class="konto-links">
      <a class="btn-primary pressable" href="${esc(info.accountsUrl)}/weiter?next=${next}">Anmelden</a>
      <a class="btn-plain" href="${esc(info.accountsUrl)}/registrieren">Neu hier? Mit Einladungscode registrieren</a></div>`);
  }
  $('#login [data-demo]').hidden = !(acc && info?.demo);
  const note = $('.login-note', f);
  note.hidden = !info?.demo || acc;
  if (info?.demo && !acc) { note.textContent = 'Das ist die Demo mit Beispieldaten. Das Passwort ist „demo“.'; f.password.value ||= 'demo'; }
  $('.login-error', f).textContent = '';
}
async function showLogin() {
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
  info = await fetch('/api/info').then((r) => r.json()).catch(() => info);
  loginMode();
  if (info?.accounts && info.demo && location.hash === '#demo') return startDemo();
  if (!info?.accounts) setTimeout(() => $('#login [name=password]').focus(), 60);
}
async function startDemo() {
  try {
    await api('/api/demo', { method: 'POST' });
    $('#login').hidden = true;
    boot('Lade die Demo …');
    await load();
  } catch (x) { $('#login .login-error').textContent = x.message; }
}
$('#login [data-demo]').onclick = startDemo;
$('#login form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget, btn = $('button[type=submit]', f), err = $('.login-error', f);
  if (info?.accounts) return;
  btn.disabled = true;
  err.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: f.password.value } });
    f.password.value = '';
    $('#login').hidden = true;
    boot('Lade Daten …');
    await load();
  } catch (x) {
    err.textContent = x.status === 401 ? 'Das Passwort ist falsch.' : [400, 403, 429].includes(x.status) ? x.message : 'Server nicht erreichbar.';
    f.classList.remove('shake');
    void f.offsetWidth;
    f.classList.add('shake');
    haptic();
  } finally { btn.disabled = false; }
});

/* ---------------------------------------------------------------- Tab-Leiste mit Glas-Linse
   Antippen: Linse springt beim Aufsetzen unter den Finger, Wechsel beim Loslassen.
   Ziehen: Linse folgt dem Finger, Schwung bestimmt den Ziel-Tab. */
const tabbar = $('#tabbar'), lens = $('.lens', tabbar), tabs = $$('button', tabbar);
const VIEWS = tabs.map((b) => b.dataset.tab);
const tabIndex = (name) => Math.max(0, VIEWS.indexOf(name));
let tabGeo = [[0, 0]], lensX = 0, lensAnim = null, tdrag = null;

function measureTabs() {
  tabGeo = tabs.map((b) => [b.offsetLeft, b.offsetWidth]);
  lens.style.width = `${tabGeo[0][1]}px`;
}
function lensSet(x) { lensX = x; lens.style.transform = `translateX(${x}px)`; }
function lensTo(x, { velocity, damping = 1, response = 0.4 } = {}) {
  const v = velocity ?? (lensAnim?.running ? lensAnim.velocity : 0);
  lensAnim?.stop();
  lensAnim = spring({ from: lensX, to: x, velocity: v, damping, response, onUpdate: lensSet });
}
const tabAt = (bx) => clamp(Math.floor((bx - tabGeo[0][0]) / tabGeo[0][1]), 0, tabs.length - 1);
function follow(clientX, response, damping) {
  const w = tabGeo[0][1], min = tabGeo[0][0], max = tabGeo.at(-1)[0];
  let x = clientX - tdrag.left - w / 2;
  if (x < min) x = min - rubberband(min - x, w); else if (x > max) x = max + rubberband(x - max, w);
  lensTo(x, { response, damping });
}

tabbar.addEventListener('pointerdown', (e) => {
  if (e.button) return;
  measureTabs();
  tabbar.setPointerCapture(e.pointerId);
  tdrag = { left: tabbar.getBoundingClientRect().left, x0: e.clientX, moved: false, tr: tracker() };
  tdrag.tr.add(e.clientX);
  lens.classList.add('lifted');
  follow(e.clientX, 0.3, 0.86);
});
tabbar.addEventListener('pointermove', (e) => {
  if (!tdrag) return;
  if (!tdrag.moved && Math.abs(e.clientX - tdrag.x0) < 8) return; // Hysterese: erst ab 8 px ist es ein Ziehen
  tdrag.moved = true;
  tdrag.tr.add(e.clientX);
  follow(e.clientX, 0.14, 1);
});
const tabRelease = (e) => {
  if (!tdrag) return;
  const v = tdrag.tr.velocity(), bx = e.clientX - tdrag.left;
  const i = tabAt(tdrag.moved ? bx + project(v, 0.99) : bx);
  const moved = tdrag.moved;
  tdrag = null;
  lens.classList.remove('lifted');
  lensTo(tabGeo[i][0], { velocity: moved ? v : undefined, damping: 0.8, response: 0.36 });
  if (e.type === 'pointerup') selectTab(VIEWS[i], { fromBar: true });
};
tabbar.addEventListener('pointerup', tabRelease);
tabbar.addEventListener('pointercancel', tabRelease);
tabs.forEach((b) => b.addEventListener('click', (e) => { if (e.detail === 0) selectTab(b.dataset.tab); })); // Tastatur

function selectTab(name, { fromBar = false } = {}) {
  if (!VIEWS.includes(name)) return;
  const view = $(`#view-${name}`);
  if (name === tab) { if (fromBar) view.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); return; }
  tab = name;
  tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.view').forEach((v) => { const on = v === view; v.hidden = !on; v.classList.toggle('enter', on); });
  history.replaceState(null, '', name === 'heute' ? location.pathname + location.search : `#${name}`);
  if (!fromBar) lensTo(tabGeo[tabIndex(name)][0], { damping: 0.86, response: 0.38 });
  updateEdge();
  updateAdd();
  if (name === 'kalender') syncPlan();
  if (name === 'aufgaben') { taskSeg.measure(); taskSeg.track(FILTERS.findIndex(([k]) => k === taskFilter)); }
  if (name === 'schule') { schoolSegCtl.measure(); schoolSegCtl.track(schoolSegs().findIndex(([k]) => k === schoolSeg)); }
  if (name === 'notizen') { notesSegCtl.measure(); notesSegCtl.track(NOTES.findIndex(([k]) => k === notesSeg)); }
}

/* Kompakter Titel + Scroll-Kante erscheinen, sobald der große Titel unter die Leiste rutscht */
const topbar = $('#topbar');
function updateEdge() {
  const v = $(`#view-${tab}`);
  topbar.style.setProperty('--edge', clamp((v.scrollTop - 28) / 22, 0, 1).toFixed(3));
  $('#compact-title').textContent = v.dataset.title;
}
$$('.view').forEach((v) => v.addEventListener('scroll', () => { if (v.id === `view-${tab}`) updateEdge(); }, { passive: true }));

/* ---------------------------------------------------------------- Klicks (delegiert) */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('#me,#add,#search,[data-week],[data-bells],[data-screen],[data-bday],[data-bdays],[data-photo],[data-new-photo],[data-timer],[data-pc],[data-shop],[data-shop-clear],[data-like],[data-confirm],[data-star],[data-teacher],[data-pick],[data-unpick],[data-goto],[data-i],[data-msg],[data-open-key],.check,[data-toggle-key],[data-subject],[data-grade],[data-new-grade],[data-plan-day],[data-refresh],[data-toggle-done],[data-event],[data-new-event],[data-edu-task],[data-note],[data-new],[data-settings],[data-edit-edu],[data-disconnect]');
  if (!el || !D) return;
  const ds = el.dataset;
  if (el.id === 'me' || 'settings' in ds) return openSettings();
  if (el.id === 'add') return ADD[tab]();
  if (el.id === 'search') return openSearch();
  if (ds.week !== undefined) return shiftWeek(Number(ds.week));
  if ('bells' in ds) return openBells();
  if ('screen' in ds) return openScreen();
  if (ds.bday) return birthdayForm(D.db.birthdays.find((x) => x.id === ds.bday));
  if ('bdays' in ds) return openBirthdays();
  if (ds.shop) return toggleShop(ds.shop);
  if ('shopClear' in ds) return clearShop();
  if (ds.photo) return openPhoto(ds.photo);
  if (ds.newPhoto !== undefined) return pickPhoto({ subject: ds.newPhoto, date: ds.date });
  if ('timer' in ds) return openTimer();
  if (ds.pc) return runPc(ds.pc, el);
  if (ds.star) return toggleStar(ds.star, el);
  if (ds.like) return toggleLike(ds.like);
  if (ds.confirm) return confirmRead(ds.confirm, el);
  if (ds.teacher) return openTeacher(ds.teacher);
  if (ds.pick) { composeTo.set(ds.pick, (S().people || []).find((p) => p.id === ds.pick)?.name || ''); return drawRecipients(); }
  if (ds.unpick) { composeTo.delete(ds.unpick); return drawRecipients(); }
  if (el.matches('.check')) return toggleTask(el.closest('.task').dataset.key, el);
  if (ds.toggleKey) { toggleTask(ds.toggleKey); return closeSheet(); }
  if (ds.openKey) {
    const x = tasks().find((t) => t.key === ds.openKey);
    return x?.src === 'edu' ? openEduTask(x.id) : reminderForm(D.db.reminders.find((r) => r.id === x?.id));
  }
  if (ds.goto) return selectTab(ds.goto);
  if (ds.i !== undefined) return openLesson(ds.day, Number(ds.i));
  if (ds.msg) return openMessage(ds.msg);
  if (ds.event) return eventForm(D.db.events.find((x) => x.id === ds.event));
  if (ds.newEvent) return eventForm(null, ds.newEvent);
  if (ds.eduTask) return openEduTask(ds.eduTask);
  if (ds.note) return noteForm(D.db.notes.find((x) => x.id === ds.note));
  if (ds.new) return NEW[ds.new]();
  if (ds.subject) return openSubject(ds.subject);
  if (ds.grade) return gradeForm(D.db.grades.find((x) => x.id === ds.grade));
  if (ds.newGrade) return gradeForm(null, ds.newGrade);
  if (ds.planDay) { closeSheet(); planDay = ds.planDay; weekStart = mondayOf(ds.planDay); renderKalender(); selectTab('kalender'); return syncPlan(); }
  if ('toggleDone' in ds) { showDone = !showDone; return renderTaskList(); }
  if ('editEdu' in ds) { sheet.dataset.editEdu = '1'; $('#edu-section').innerHTML = edupageSection(); return wireEduForm(); }
  if ('disconnect' in ds) {
    if (!ds.sure) { ds.sure = '1'; $('span', el).textContent = 'Wirklich trennen?'; return; }
    setData(await api('/api/link', { method: 'DELETE' }));
    $('#edu-section').innerHTML = edupageSection();
    return wireEduForm();
  }
  if ('refresh' in ds) {
    el.disabled = true;
    (el.querySelector('span') || el).textContent = 'Aktualisiere …';
    await load(true);
    if (sheetOpen && $('#edu-section')) { $('#edu-section').innerHTML = edupageSection(); wireEduForm(); }
  }
});

/* ---------------------------------------------------------------- Deep-Links (#kalender/2026-11-17, #schule/123) */
function route() {
  if (!D) return;
  const [name, arg] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (name === 'kalender' && /^\d{4}-\d{2}-\d{2}$/.test(arg || '')) { planDay = arg; weekStart = mondayOf(arg); renderKalender(); }
  if (VIEWS.includes(name)) selectTab(name);
  if (name === 'kalender') syncPlan();
  if (name === 'schule' && arg) { schoolSeg = 'nachrichten'; renderSchule(); openMessage(arg); }
}
addEventListener('hashchange', route);

/* ---------------------------------------------------------------- Start */
document.addEventListener('touchstart', () => {}, { passive: true }); // aktiviert :active auf iOS
addEventListener('resize', () => {
  if (!D) return;
  measureTabs();
  lensSet(tabGeo[tabIndex(tab)][0]);
  syncPlan();
});
addEventListener('online', () => D && load());
addEventListener('offline', () => D && renderHeute());
document.addEventListener('visibilitychange', () => { if (!document.hidden && D) load(); });
setInterval(() => { if (!document.hidden && D) load(); }, 5 * 60e3);
setInterval(() => { if (!document.hidden && D && tab === 'heute' && !sheetOpen) renderHeute(); }, 30e3);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.url) { location.hash = new URL(e.data.url, location.origin).hash; route(); }
  });
}
boot('');
load();
