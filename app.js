'use strict';
// Alltag – Server und Plesk-Startdatei (Node.js; unter Plesk/Passenger oder lokal mit `node app.js`).
// Liefert die Web-App aus, speichert eigene Einträge, gleicht EduPage ab und verschickt Push-Mitteilungen.
process.env.TZ ||= 'Europe/Berlin'; // Plesk-Server laufen oft in UTC – "heute" soll deutsche Zeit sein

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateVapidKeys, sendPush } = require('./push');
const { Edupage, EduError, snapshot, schoolDay, regularDay, SNAPSHOT_VERSION, isoDay, addDays } = require('./edupage');
const demo = require('./demo');
const { occursOn, birthdayOn, ageOn } = require('./public/recur');

const APP = 'Alltag';
const DEMO = process.env.DEMO === '1';
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, DEMO ? 'data-demo' : 'data');
const PASSWORD = DEMO ? 'demo' : process.env.APP_PASSWORD;
if (!PASSWORD) {
  console.error('APP_PASSWORD fehlt. In Plesk unter Node.js → „Benutzerdefinierte Umgebungsvariablen“ setzen.');
  process.exit(1);
}

/* ------------------------------------------------------------------ Dateien (außerhalb von public/) */
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const file = (n) => path.join(DATA, n);
const load = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const save = (n, v) => { // atomar: ein Absturz beim Schreiben zerstört die alte Datei nicht
  const tmp = `${file(n)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
  fs.renameSync(tmp, file(n));
};
const once = (n, make) => { let v = load(n, null); if (v == null) { v = make(); save(n, v); } return v; };
const token = () => crypto.randomBytes(24).toString('base64url');

const SECRET = once('secret.json', () => crypto.randomBytes(32).toString('hex'));
const TOKENS = once('tokens.json', () => ({ widget: token(), cron: token() }));
if (!TOKENS.screen) { TOKENS.screen = token(); save('tokens.json', TOKENS); } // Schlüssel für das Fernsteuerungs-Programm auf dem PC
const VAPID = once('vapid.json', generateVapidKeys);
if (DEMO && !load('db.json', null)) save('db.json', demo.db());

const state = () => ({ seen: [], subs: [], done: {}, eduSeeded: false, ...load('state.json', {}) });
const db = () => ({ reminders: [], events: [], notes: [], grades: [], birthdays: [], photos: [], sessions: [], ...load('db.json', {}) });
const PHOTOS = path.join(DATA, 'photos'); // Tafelbilder als JPEG, nur angemeldet abrufbar
fs.mkdirSync(PHOTOS, { recursive: true, mode: 0o700 });

/* ------------------------------------------------------------------ Hilfen */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers,
  });
  res.end(json ? JSON.stringify(body) : body);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error('zu groß'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 200e3);
  try { return buf.length ? JSON.parse(buf) : {}; } catch { throw Object.assign(new Error('kein JSON'), { status: 400 }); }
}

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k));
const https = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
function loggedIn(req) {
  const [exp, sig] = (cookies(req).sid || '').split('.');
  return !!sig && Number(exp) > Date.now() && same(sig, sign(exp));
}
function sessionCookie(req, maxAge) {
  const exp = String(Date.now() + maxAge * 1000);
  return `sid=${maxAge ? `${exp}.${sign(exp)}` : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https(req) ? '; Secure' : ''}`;
}
const failures = []; // Bremse gegen Passwort-Raten: max. 10 Fehlversuche je 15 Minuten

/* ------------------------------------------------------------------ Eigene Einträge: erlaubte Felder */
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const F = {
  text: (max, required) => (v) => { const s = String(v ?? '').trim().slice(0, max); if (required && !s) throw bad('Pflichtfeld fehlt'); return s; },
  date: (required) => (v) => { const s = String(v ?? ''); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; if (required) throw bad('Datum fehlt'); return ''; },
  time: () => (v) => (/^\d{2}:\d{2}$/.test(String(v ?? '')) ? String(v) : ''),
  bool: () => (v) => v === true,
  num: (min, max, def) => (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; },
  pick: (...opts) => (v) => (opts.includes(v) ? v : opts[0]),
};
const REPEAT = F.pick('', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly');
const KINDS = {
  reminders: { title: F.text(200, true), notes: F.text(4000), due: F.date(), time: F.time(), category: F.pick('privat', 'schule'), subject: F.text(80), done: F.bool(), repeat: REPEAT, until: F.date() },
  events: { title: F.text(200, true), date: F.date(true), start: F.time(), end: F.time(), location: F.text(120), notes: F.text(4000), category: F.pick('privat', 'schule'), repeat: REPEAT, until: F.date() },
  notes: { title: F.text(200), body: F.text(50000), subject: F.text(80), pinned: F.bool() },
  grades: { subject: F.text(80, true), value: F.text(12, true), weight: F.num(0, 10, 1), title: F.text(120), date: F.date() },
  birthdays: { name: F.text(120, true), date: F.date(true), before: F.num(0, 30, 3), notes: F.text(1000) },
  photos: { subject: F.text(80), date: F.date(), caption: F.text(300) }, // anlegen nur über POST /api/photos (mit Bild)
};
const clean = (kind, body) => Object.fromEntries(Object.entries(KINDS[kind]).map(([k, f]) => [k, f(body[k])]));

/* ------------------------------------------------------------------ Push */
async function push(payload) {
  const subs = state().subs;
  let sent = 0; const dead = [];
  for (const s of subs) {
    try { await sendPush(s, JSON.stringify(payload), VAPID); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); else console.warn('Push fehlgeschlagen:', e.message); }
  }
  if (dead.length) { const st = state(); st.subs = st.subs.filter((s) => !dead.includes(s.endpoint)); save('state.json', st); }
  return sent;
}

const dayLabel = (iso, now) => {
  const n = Math.round((new Date(`${iso}T00:00`) - new Date(isoDay(now) + 'T00:00')) / 864e5);
  return n === 0 ? 'Heute' : n === 1 ? 'Morgen' : `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${iso}T00:00`).getDay()]}., ${iso.slice(8)}.${iso.slice(5, 7)}.`;
};

// Alles, worüber eine Mitteilung gehen soll – jeweils mit eindeutigem Schlüssel
function news(snap, data, done, now) {
  const out = [];
  const today = isoDay(now), tomorrow = isoDay(addDays(now, 1)), hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  {
    for (const d of snap?.days || []) for (const c of d.changes) {
      out.push([`sub|${d.date}|${c.label}|${c.text}`, { title: `Vertretung · ${dayLabel(d.date, now)}`, body: c.label ? `${c.label} Std. · ${c.text}` : c.text, url: `/#kalender/${d.date}`, tag: `sub-${d.date}-${c.label}` }]);
    }
  }
  for (const m of snap?.messages || []) for (const x of [m, ...m.replies]) {
    out.push([`msg|${x.id}`, { title: `${x.important ? 'Wichtig · ' : ''}${x.author || 'Neue Nachricht'}`, body: x.text.slice(0, 180), url: `/#schule/${m.id}`, tag: `msg-${x.id}` }]);
  }
  if (load('config.json', {}).lessonPush) { // kurz vor jeder Stunde: Fach, Zeit, Raum, Lehrkraft
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const l of snap?.days.find((d) => d.date === today)?.lessons || []) {
      if (l.cancelled || l.allday || !l.start) continue;
      const mins = toMin(l.start) - nowMin;
      if (mins >= 0 && mins <= 6) {
        out.push([`les|${today}|${l.start}|${l.subject}`, { title: `Gleich: ${l.subject}`, tag: 'lesson', url: `/#kalender/${today}`,
          body: [l.start, l.rooms.join(', '), l.teachers.join(', '), ...l.changes].filter(Boolean).join(' · ') }]);
      }
    }
  }
  for (const r of data.reminders) { // eigene Erinnerung zur eingestellten Uhrzeit
    if (!r.done && r.due && r.time && (r.due < today || (r.due === today && r.time <= hm))) {
      out.push([`rem|${r.id}|${r.due}|${r.time}`, { title: 'Erinnerung', body: r.title, url: '/#aufgaben', tag: `rem-${r.id}` }]);
    }
  }
  for (const e of data.events) { // Termin (auch wiederkehrend): etwa 30 Minuten vorher
    if (occursOn(e, today) && e.start) {
      const mins = toMin(e.start) - (now.getHours() * 60 + now.getMinutes());
      if (mins >= 0 && mins <= 35) out.push([`evt|${e.id}|${today}|${e.start}`, { title: `${e.title} · ${e.start} Uhr`, body: e.location || 'Gleich geht’s los', url: `/#kalender/${today}`, tag: `evt-${e.id}` }]);
    }
  }
  if (now.getHours() >= 8) for (const b of data.birthdays) {
    for (const n of new Set([0, b.before || 0])) {
      const d = isoDay(addDays(now, n)), age = ageOn(b, d);
      if (!birthdayOn(b, d)) continue;
      out.push([`bday|${b.id}|${d}|${n}`, n
        ? { title: `Bald Geburtstag: ${b.name}`, body: `${dayLabel(d, now)}${age ? ` · wird ${age}` : ''} – an ein Geschenk denken?`, url: '/#heute', tag: `bday-${b.id}` }
        : { title: `${b.name} hat heute Geburtstag`, body: age ? `wird ${age} – Glückwünsche nicht vergessen!` : 'Glückwünsche nicht vergessen!', url: '/#heute', tag: `bday-${b.id}` }]);
    }
  }
  const ticket = load('config.json', {}).ticket;
  if (ticket?.until && now.getHours() >= 9) for (const n of [7, 1, 0]) {
    if (isoDay(addDays(now, n)) === ticket.until) out.push([`tkt|${ticket.until}|${n}`, { title: `${ticket.name || 'Ticket'} läuft ${n ? (n === 1 ? 'morgen' : `in ${n} Tagen`) : 'heute'} ab`, body: 'Rechtzeitig verlängern, damit du morgens nicht ohne dastehst.', url: '/#heute', tag: 'ticket' }]);
  }
  if (now.getHours() >= 17) { // Abendübersicht für morgen
    const due = [...(snap?.tasks || []).filter((t) => t.kind !== 'event' && t.due === tomorrow && !(done[t.id] ?? t.done)),
      ...data.reminders.filter((r) => r.due === tomorrow && !r.done)];
    const evs = data.events.filter((e) => occursOn(e, tomorrow));
    if (due.length || evs.length) {
      out.push([`eve|${tomorrow}`, { title: 'Morgen', url: '/#heute', tag: 'evening',
        body: [due.length && `${due.length} fällig: ${due.slice(0, 3).map((t) => t.subject || t.title).join(', ')}`, evs.length && `${evs.length} Termin${evs.length > 1 ? 'e' : ''}: ${evs.slice(0, 2).map((e) => e.title).join(', ')}`].filter(Boolean).join(' · ') }]);
    }
  }
  return out;
}
const pad2 = (n) => String(n).padStart(2, '0');
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

async function notify(snap) {
  const st = state();
  const items = news(snap && { ...snap, tasks: [...snap.tasks, ...study(snap, st.done)] }, db(), st.done, new Date());
  const seen = new Set(st.seen), quiet = !st.eduSeeded; // erster EduPage-Abgleich: Bestand still übernehmen
  let fresh = items.filter(([k]) => !seen.has(k));
  const timer = st.timer && Date.now() >= st.timer.end ? st.timer : null;
  if (timer) delete st.timer;
  const changed = fresh.length || (snap && !st.eduSeeded) || timer;
  st.seen = [...st.seen, ...fresh.map(([k]) => k)].slice(-4000);
  if (snap) st.eduSeeded = true;
  if (changed) save('state.json', st); // läuft minütlich – nur schreiben, wenn sich etwas tut
  if (quiet) fresh = fresh.filter(([k]) => !k.startsWith('sub|') && !k.startsWith('msg|'));
  const subs = fresh.filter(([k]) => k.startsWith('sub|'));
  if (subs.length > 3) { // Sammelmeldung statt Mitteilungsflut
    fresh = fresh.filter(([k]) => !k.startsWith('sub|'));
    fresh.push(['', { title: `${subs.length} neue Vertretungen`, body: `${subs.slice(0, 3).map(([, p]) => p.body).join(' · ')} …`, url: '/#kalender', tag: 'subs' }]);
  }
  for (const [, p] of fresh) await push(p);
  if (timer) {
    logSession(timer.subject, timer.minutes, timer.start);
    await push({ title: 'Lernzeit geschafft', body: `${timer.subject || 'Lernen'} · ${timer.minutes} Min. – Zeit für eine Pause.`, url: '/#heute', tag: 'timer' });
  }
}
const logSession = (subject, minutes, start) => {
  const d = db();
  d.sessions = [...d.sessions, { id: crypto.randomUUID(), subject, minutes, date: isoDay(new Date(start)) }].slice(-1000);
  save('db.json', d);
};

/* ------------------------------------------------------------------ Home Assistant (Einkaufsliste, PC-Knöpfe) */
const HA_PC = /^(button|input_button|script|switch)\.[a-z0-9_]+$/;
async function ha(pathname, body, cfg = load('config.json', {}).ha) {
  if (!cfg?.url || !cfg?.token) throw bad('Home Assistant ist nicht verbunden');
  if (DEMO) return demo.ha(pathname, body);
  const r = await fetch(`${cfg.url}${pathname}`, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body), signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' } }).catch(() => { throw bad('Home Assistant nicht erreichbar'); });
  if (r.status === 401) throw bad('Home Assistant: Token ungültig');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw bad(`Home Assistant: ${j.message || `Fehler ${r.status}`}`);
  return j;
}
async function shopItems() {
  const todo = load('config.json', {}).ha?.todo;
  if (!todo) throw bad('Keine Einkaufsliste gewählt');
  const j = await ha('/api/services/todo/get_items?return_response', { entity_id: todo });
  return (j.service_response?.[todo]?.items || []).map((i) => ({ uid: i.uid, summary: i.summary, status: i.status }));
}

/* ------------------------------------------------------------------ Abgleich mit EduPage */
let running = null;
// Gespeicherte Sitzung weiterverwenden, nur wenn sie abgelaufen ist neu einloggen (Captcha-Schutz)
async function connect(cfg) {
  const ep = new Edupage(cfg.school, load('session.json', {}));
  try { await ep.refresh(); } catch (e) { if (!(e instanceof EduError) && !(e instanceof SyntaxError)) throw e; await ep.login(cfg.user, cfg.pass); }
  save('session.json', Object.fromEntries(ep.cookies));
  return ep;
}


async function edupageDo(fn) {
  const cfg = load('config.json', {}).edupage;
  if (!cfg) throw bad('EduPage ist nicht verbunden');
  try { return await fn(await connect(cfg)); } catch (e) { throw e.status ? e : bad(e.message); }
}

// Lernplan: zu jeder anstehenden Prüfung Lern-Erinnerungen 7, 3 und 1 Tag vorher
function study(snap, done, now = new Date()) {
  const today = isoDay(now), out = [];
  for (const t of snap?.tasks || []) {
    if (t.kind !== 'exam' || !t.due) continue;
    for (const n of [7, 3, 1]) {
      const due = isoDay(addDays(new Date(`${t.due}T12:00`), -n)), id = `learn:${t.id}:${n}`;
      if (due >= today) out.push({ id, kind: 'study', label: 'Lernen', title: `${n === 1 ? 'Wiederholen' : 'Lernen'}: ${t.title}`, subject: t.subject, due, created: t.created, author: '', done: !!done[id], exam: t.id });
    }
  }
  return out;
}

// Für Siri: Schul-Kürzel ausschreiben (in der App bleiben die Kürzel stehen)
const SPOKEN = [[/\bSchA\b/g, 'Schulaufgabe'], [/\bPLN\b/g, 'praktischer Leistungsnachweis'], [/\bStEx\b|\bEx\b/g, 'Stegreifaufgabe'],
  [/\bKA\b/g, 'Kurzarbeit'], [/\bHA\b/g, 'Hausaufgabe'], [/\bStd\.(?=\s|$)/g, 'Stunde'], [/(\d)\.(?=[A-Za-zÄÖÜäöü])/g, '$1. ']];
const speakable = (t) => SPOKEN.reduce((s, [re, w]) => s.replace(re, w), t);

// Kurzbefehle/Siri: der Tag in zwei, drei Sätzen
function summary(which) {
  const p = payload(), date = isoDay(addDays(new Date(), which === 'morgen' ? 1 : 0)), name = which === 'morgen' ? 'Morgen' : 'Heute';
  const lessons = p.snap?.days.find((d) => d.date === date)?.lessons || [];
  const active = lessons.filter((l) => !l.cancelled && !l.allday && l.start);
  const lines = [active.length ? `${name} hast du ${active.length} Stunden, von ${active[0].start} bis ${active.at(-1).end} Uhr.` : `${name} hast du keinen Unterricht.`];
  const ch = lessons.filter((l) => l.cancelled || l.changes?.length);
  if (ch.length) lines.push(`Änderungen: ${ch.map((l) => (l.cancelled ? `${l.subject} entfällt` : `${l.subject}, ${l.changes.join(', ')}`)).join('; ')}.`);
  const special = lessons.filter((l) => l.allday || l.event).map((l) => l.subject);
  if (special.length) lines.push(`Außerdem: ${[...new Set(special)].join(', ')}.`);
  const evs = p.db.events.filter((e) => occursOn(e, date));
  if (evs.length) lines.push(`Termine: ${evs.map((e) => `${e.start ? `${e.start} ` : ''}${e.title}`).join(', ')}.`);
  const due = [...(p.snap?.tasks || []).filter((t) => !t.done && t.due === date), ...p.db.reminders.filter((r) => !r.done && r.due === date)];
  if (due.length) lines.push(`Fällig: ${due.map((t) => t.subject ? `${t.subject} (${t.title})` : t.title).join(', ')}.`);
  const cd = which === 'morgen' ? null : holidayCountdown(p.holidays);
  if (cd && !cd.during && cd.days <= 30) lines.push(`Noch ${cd.days} Schultage bis zu den ${cd.name}.`);
  return speakable(lines.join(' '));
}

/* ------------------------------------------------------------------ Schulweg: Wetter (Open-Meteo) und Fahrplan (EFA Bayern, mit Echtzeit) */
const getJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Alltag' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
async function refreshWeather(force) {
  const place = load('config.json', {}).place, cached = load('weather.json', null);
  if (!place || DEMO || (!force && cached?.lat === place.lat && cached?.lon === place.lon && Date.now() - cached.at < 3600e3)) return;
  try {
    const h = (await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=3&timezone=Europe%2FBerlin`)).hourly;
    save('weather.json', { lat: place.lat, lon: place.lon, at: Date.now(),
      hours: h.time.map((t, i) => ({ t, temp: Math.round(h.temperature_2m[i]), rain: h.precipitation_probability[i] ?? 0, code: h.weather_code[i] })) });
  } catch (e) { console.warn('Wetter nicht abrufbar:', e.message); }
}

const EFA = 'https://bahnland-bayern.de/efa';
const hhmm = (iso) => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
// Verbindungen von Haltestelle zu Haltestelle; mode 'arr' = ankommen bis time, 'dep' = abfahren ab time
async function trips(from, to, date, time, mode) {
  if (DEMO) return demo.trips(time, mode);
  const q = new URLSearchParams({ outputFormat: 'rapidJSON', type_origin: 'any', name_origin: from, type_destination: 'any', name_destination: to,
    calcNumberOfTrips: '4', useRealtime: '1', itdDate: date.replace(/-/g, ''), itdTime: time.replace(':', ''), itdTripDateTimeDepArr: mode });
  const list = ((await getJson(`${EFA}/XML_TRIP_REQUEST2?${q}`)).journeys || []).map((x) => {
    const first = x.legs[0].origin, last = x.legs.at(-1).destination;
    return {
      dep: hhmm(first.departureTimePlanned), depRt: hhmm(first.departureTimeEstimated || first.departureTimePlanned),
      arr: hhmm(last.arrivalTimePlanned), arrRt: hhmm(last.arrivalTimeEstimated || last.arrivalTimePlanned),
      legs: x.legs.filter((l) => !(l.transportation?.product?.class >= 97)).map((l) => ({ // ohne Fußwege
        line: String(l.transportation?.number || l.transportation?.name || ''), kind: l.transportation?.product?.name || '', dir: l.transportation?.destination?.name || '',
        from: l.origin?.name || '', plat: l.origin?.properties?.platform || '', dep: hhmm(l.origin.departureTimePlanned),
        depRt: hhmm(l.origin.departureTimeEstimated || l.origin.departureTimePlanned), cancelled: /CANCEL/.test(JSON.stringify(l.realtimeStatus || '')),
      })),
    };
  }).filter((x) => x.legs.length);
  return mode === 'arr' ? list.filter((x) => x.arr <= time).slice(-3) : list.filter((x) => x.dep >= time).slice(0, 3);
}
const tripCache = new Map();
async function cachedTrips(dir, date, time) {
  const s = load('config.json', {}).stops || {};
  if (!s.home || !s.school) return null;
  const [from, to, mode] = dir === 'school' ? [s.home.id, s.school.id, 'arr'] : [s.school.id, s.home.id, 'dep'];
  const key = `${dir}|${date}|${time}`, hit = tripCache.get(key);
  if (hit && Date.now() - hit.at < 60e3) return hit.list;
  const list = await trips(from, to, date, time, mode);
  if (tripCache.size > 50) tripCache.clear();
  tripCache.set(key, { at: Date.now(), list });
  return list;
}

// Erste und letzte Stunde eines Tages (ohne Entfall und Ganztägiges)
function schoolTimes(date) {
  const ls = (load('snapshot.json', null)?.days.find((d) => d.date === date)?.lessons || []).filter((l) => !l.cancelled && !l.allday && l.start && l.end);
  return ls.length ? { start: ls.map((l) => l.start).sort()[0], end: ls.map((l) => l.end).sort().at(-1) } : null;
}
// Wecker: Abfahrt der passenden Verbindung (sonst Unterrichtsbeginn) minus Vorlauf – leer, wenn keine Schule ist
async function wakeTime(date) {
  const t = schoolTimes(date);
  if (!t) return '';
  let base = t.start;
  try { const list = await cachedTrips('school', date, t.start); if (list?.length) base = list.at(-1).dep; } catch (e) { console.warn('Fahrplan:', e.message); }
  const m = toMin(base) - (load('config.json', {}).wakeLead ?? 60);
  return m < 0 ? '00:00' : `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

const STATES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'];
async function refreshHolidays(force) {
  const state = load('config.json', {}).state || 'BY', cached = load('holidays.json', null);
  if (!force && cached?.state === state && Date.now() - cached.at < 864e5) return;
  try {
    const today = isoDay(new Date()), until = isoDay(addDays(new Date(), 400));
    const r = await fetch(`https://openholidaysapi.org/SchoolHolidays?countryIsoCode=DE&subdivisionCode=DE-${state}&languageIsoCode=DE&validFrom=${today}&validTo=${until}`, { signal: AbortSignal.timeout(10000) });
    const list = (await r.json()).map((h) => ({ start: String(h.startDate).slice(0, 10), end: String(h.endDate).slice(0, 10), name: String((h.name || []).find((n) => n.language === 'DE')?.text || h.name?.[0]?.text || 'Ferien') }))
      .filter((h) => h.end >= today).sort((a, b) => a.start.localeCompare(b.start));
    if (!list.length) throw new Error('keine Ferien geliefert');
    save('holidays.json', { state, at: Date.now(), list });
  } catch (e) { console.warn('Ferien nicht abrufbar:', e.message); }
}
const holidayName = (n) => n || 'Ferien';
// Schultage bis zu den nächsten Ferien (Werktage ohne Ferientage; heute zählt mit)
function holidayCountdown(list, now = new Date()) {
  const today = isoDay(now), off = (d) => list.some((h) => h.start <= d && d <= h.end);
  const cur = list.find((h) => h.start <= today && today <= h.end);
  if (cur) return { during: true, name: holidayName(cur.name), end: cur.end };
  const next = list.find((h) => h.start > today && (new Date(`${h.end}T12:00`) - new Date(`${h.start}T12:00`)) / 864e5 >= 2);
  if (!next) return null;
  let days = 0;
  for (let d = new Date(`${today}T12:00`); isoDay(d) < next.start; d.setDate(d.getDate() + 1)) if (d.getDay() % 6 && !off(isoDay(d))) days++;
  return { during: false, name: holidayName(next.name), start: next.start, days };
}

async function syncEdupage() {
  if (DEMO) { const s = demo.snapshot(); save('snapshot.json', s); return s; }
  const cfg = load('config.json', {}).edupage;
  if (!cfg) return null;
  const status = load('status.json', {});
  if (status.blockedUntil > Date.now()) return load('snapshot.json', null); // nach Captcha eine Stunde Ruhe
  try {
    const s = await snapshot(await connect(cfg), { school: cfg.school });
    save('snapshot.json', s);
    save('status.json', { ok: true, at: s.updated, error: null });
    s.errors.forEach((e) => console.warn('Teilfehler:', e));
    return s;
  } catch (e) {
    // Captcha: 1 h Pause; falsches Passwort: nicht weiter probieren, bis es in der App neu eingetragen wird
    const pause = { captcha: 3600e3, credentials: 365 * 864e5, twofactor: 365 * 864e5 }[e.code] || 0;
    save('status.json', { ok: false, at: new Date().toISOString(), error: e.message, blockedUntil: pause && Date.now() + pause });
    if (e.code) save('session.json', {});
    console.error('EduPage-Abgleich fehlgeschlagen:', e.message);
    return load('snapshot.json', null);
  }
}

function sync(minAgeMs) {
  if (running) return running;
  if (Date.now() - load('lastrun.json', 0) < minAgeMs) return Promise.resolve();
  running = (async () => {
    save('lastrun.json', Date.now());
    await refreshHolidays();
    await refreshWeather();
    await notify(await syncEdupage());
  })().catch((e) => console.error('Abgleich:', e)).finally(() => { running = null; });
  return running;
}
// Läuft der Prozess dauerhaft, gleicht er selbst ab; unter Plesk weckt ihn zusätzlich die geplante Aufgabe (/api/cron)
setInterval(() => { const h = new Date().getHours(); sync(h >= 5 && h < 22 ? 14 * 60e3 : 55 * 60e3); }, 5 * 60e3);

// Plesk/Passenger beendet die App nach einigen Minuten ohne Aufruf – dann gäbe es keinen Abgleich und keine Mitteilungen.
// Ohne geplante Aufgabe hält sie sich deshalb selbst wach: alle 2 Minuten ein Aufruf der eigenen Adresse.
// Die Adresse stammt nur aus angemeldeten Aufrufen, damit kein fremder Host-Header sie umlenken kann.
setInterval(() => {
  const origin = load('origin.json', null);
  if (origin) fetch(`${origin}/api/ping`, { signal: AbortSignal.timeout(10000) }).catch(() => {});
}, 2 * 60e3);
setInterval(() => { if (!running) notify(load('snapshot.json', null)).catch((e) => console.error('Mitteilungen:', e)); }, 60e3);
// nach einem Update mit neuer Auswertung sofort neu abgleichen, sonst nur wenn der letzte Abgleich älter als 10 Min. ist
setTimeout(() => sync(load('snapshot.json', null)?.v === SNAPSHOT_VERSION ? 10 * 60e3 : 0), 3000);

/* ------------------------------------------------------------------ API */
function settings() {
  const c = load('config.json', {});
  return { state: c.state || 'BY', lessonPush: !!c.lessonPush, place: c.place || null, stops: c.stops || {}, wakeLead: c.wakeLead ?? 60, ticket: c.ticket || null,
    ha: c.ha ? { connected: true, url: c.ha.url, todo: c.ha.todo || '', pc: c.ha.pc || [] } : { connected: false } }; // Token bleibt auf dem Server
}
function payload() {
  const st = state(), snap = load('snapshot.json', null), cfg = load('config.json', {}).edupage;
  return {
    app: APP, demo: DEMO, status: load('status.json', {}),
    ...settings(), holidays: load('holidays.json', null)?.list || [],
    weather: DEMO ? demo.weather() : load('weather.json', null)?.hours || [],
    timer: st.timer || null,
    edupage: DEMO ? { connected: true, school: 'demo', user: 'demo' } : cfg ? { connected: true, school: cfg.school, user: cfg.user } : { connected: false },
    snap: snap && {
      ...snap,
      tasks: [...snap.tasks.map((t) => ({ ...t, done: st.done[t.id] ?? t.done })), ...study(snap, st.done)],
      messages: (snap.messages || []).map((m) => {
        const liked = st.liked?.[m.id] ?? m.liked;
        return { ...m, starred: st.starred?.[m.id] ?? m.starred, confirmed: m.confirmed || st.confirmed?.[m.id] || null,
          liked, likes: Math.max(0, (m.likes || 0) + (liked === !!m.liked ? 0 : liked ? 1 : -1)) };
      }),
    },
    db: db(),
  };
}

/* ------------------------------------------------------------------ PC-Bildschirm: Server reicht Bild (PC → App) und Eingaben (App → PC) durch */
// shortcut: alles im Speicher eines Prozesses – passt für Plesk/Passenger mit einer Node-Instanz; bei mehreren Instanzen bräuchte es einen gemeinsamen Speicher
const screen = { frame: null, seq: 0, n: 1, s: 0, locked: false, agentAt: 0, viewerAt: 0, events: [], viewers: [], agents: [] };
const waitFor = (list, ms) => new Promise((resolve) => {
  const done = () => { clearTimeout(t); const i = list.indexOf(done); if (i >= 0) list.splice(i, 1); resolve(); };
  const t = setTimeout(done, ms);
  list.push(done);
});
const wake = (list) => [...list].forEach((f) => f());
const viewing = () => Date.now() - screen.viewerAt < 12e3;
const agentOnline = () => screen.agents.length > 0 || Date.now() - screen.agentAt < 10e3;
const SCREEN_KEYS = ['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'F5',
  'Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Alt+Tab', 'Alt+F4', 'Win'];
function screenEvent(e) { // nur bekannte Eingaben in festen Grenzen an den PC weitergeben
  const n01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  switch (e?.t) {
    case 'move': return { t: 'move', x: n01(e.x), y: n01(e.y) };
    case 'down': case 'up': return { t: e.t, b: [0, 1, 2].includes(e.b) ? e.b : 0 };
    case 'wheel': return { t: 'wheel', d: Math.max(-1200, Math.min(1200, Math.round(Number(e.d) || 0))) };
    case 'text': { const s = String(e.s ?? '').slice(0, 200); return s ? { t: 'text', s } : null; }
    case 'key': return SCREEN_KEYS.includes(e.k) ? { t: 'key', k: e.k } : null;
    case 'screen': return { t: 'screen', i: Math.max(-1, Math.min(8, Math.trunc(Number(e.i) || 0))) };
    default: return null;
  }
}
async function screenAgent(req, res, q) {
  const buf = await readBody(req, 6e6);
  Object.assign(screen, { agentAt: Date.now(), n: Math.min(9, Math.max(1, Math.trunc(Number(q.get('n')) || 1))), s: Math.trunc(Number(q.get('s')) || 0), locked: q.get('locked') === '1' });
  if (buf.length) {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return send(res, 400, { error: 'kein JPEG' });
    screen.frame = buf; screen.seq++;
    wake(screen.viewers);
  }
  if (!viewing()) { // niemand schaut zu: Bild verwerfen und warten, bis jemand die Ansicht öffnet
    screen.frame = null;
    await waitFor(screen.agents, 25e3);
    screen.agentAt = Date.now();
  }
  send(res, 200, { active: viewing(), events: screen.events.splice(0) });
}

const teacherCache = new Map(), weekCache = new Map();
const routes = {
  'POST /api/login': async (req, res) => {
    const now = Date.now();
    while (failures.length && failures[0] < now - 15 * 60e3) failures.shift();
    if (failures.length >= 10) return send(res, 429, { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut.' });
    const { password } = await readJson(req);
    if (!same(password ?? '', PASSWORD)) {
      failures.push(now);
      await new Promise((r) => setTimeout(r, 800));
      return send(res, 401, { error: 'Falsches Passwort' });
    }
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, 365 * 86400) });
  },
  'POST /api/logout': (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, 0) }),
  'GET /api/data': (req, res) => {
    const origin = `${https(req) ? 'https' : 'http'}://${req.headers.host}`;
    if (loggedIn(req) && /^[\w.:-]+$/.test(req.headers.host || '') && load('origin.json', null) !== origin) save('origin.json', origin);
    send(res, 200, payload());
  },
  'POST /api/refresh': async (req, res) => { await sync(60e3); send(res, 200, payload()); },

  'POST /api/tasks/:id': async (req, res, id) => {
    const { done } = await readJson(req);
    const st = state(); st.done[id] = done === true; save('state.json', st);
    // Hausaufgabe auch in EduPage abhaken (wie der Haken im EduPage-Webclient)
    const t = load('snapshot.json', null)?.tasks.find((x) => x.id === id);
    const synced = t?.tid && !DEMO ? await edupageDo((ep) => ep.setProp(t.tid, 'done', done === true ? '1' : '0')).then(() => true, () => false) : false;
    send(res, 200, { ok: true, synced });
  },

  // Nachrichten – gehen an echte Lehrkräfte, die App fragt vorher nach
  'POST /api/messages': async (req, res) => {
    const { to, text } = await readJson(req);
    const known = new Set((load('snapshot.json', null)?.people || []).map((p) => p.id));
    const ids = [].concat(to || []).map(String).filter((x) => known.has(x));
    if (!ids.length || !String(text || '').trim()) throw bad('Bitte Empfänger und Text angeben.');
    if (DEMO) return send(res, 200, { ...payload(), demo: true });
    await edupageDo((ep) => ep.sendMessage(ids.map((x) => `Ucitel${x}`), String(text).trim().slice(0, 5000)));
    await sync(0);
    send(res, 200, payload());
  },
  'POST /api/messages/:id/reply': async (req, res, id) => {
    const { text } = await readJson(req);
    if (!String(text || '').trim()) throw bad('Bitte einen Text eingeben.');
    if (!(load('snapshot.json', null)?.messages || []).some((m) => m.id === id)) throw bad('Nachricht nicht gefunden');
    if (DEMO) return send(res, 200, { ...payload(), demo: true });
    await edupageDo((ep) => ep.reply(id, String(text).trim().slice(0, 5000)));
    await sync(0);
    send(res, 200, payload());
  },
  'POST /api/messages/:id/star': async (req, res, id) => {
    const { starred } = await readJson(req);
    const st = state(); st.starred = { ...st.starred, [id]: starred === true }; save('state.json', st);
    const synced = DEMO ? false : await edupageDo((ep) => ep.setProp(id, 'starred', starred === true ? '1' : '0')).then(() => true, () => false);
    send(res, 200, { ok: true, synced });
  },

  'POST /api/messages/:id/like': async (req, res, id) => {
    const { liked } = await readJson(req);
    if (!DEMO) await edupageDo((ep) => ep.confirm(id, 'like', liked === true ? '1' : '0'));
    const st = state(); st.liked = { ...st.liked, [id]: liked === true }; save('state.json', st);
    send(res, 200, { ok: true });
  },
  'POST /api/messages/:id/confirm': async (req, res, id) => {
    if (!DEMO) await edupageDo((ep) => ep.confirm(id, 'receipt', ''));
    const st = state(); st.confirmed = { ...st.confirmed, [id]: new Date().toISOString() }; save('state.json', st);
    send(res, 200, { ok: true });
  },

  // Wo ist Lehrkraft X gerade? (Stundenplan der Lehrkraft für heute, 5 Minuten zwischengespeichert)
  'GET /api/teacher/:id': async (req, res, id) => {
    const date = isoDay(new Date()), key = `${id}|${date}`, hit = teacherCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60e3) return send(res, 200, { date, lessons: hit.lessons, source: hit.source });
    let lessons, source = 'live';
    if (DEMO) {
      const name = (load('snapshot.json', null)?.people || []).find((p) => p.id === id)?.name;
      lessons = (demo.snapshot().days[0]?.lessons || []).filter((l) => l.teachers.includes(name)).map((l) => ({ ...l, classes: ['8b'] }));
    } else {
      lessons = await edupageDo(async (ep) => {
        try { return await ep.teacherPlan(id, date); } catch (e) {
          if (!/erlaubt|insuf/i.test(e.message)) throw e;
          // Schülerkonten dürfen den Lehrer-Stundenplan oft nicht sehen → regulärer Gesamtstundenplan (einen Tag zwischengespeichert)
          source = 'regular';
          let tables = load('regular.json', null);
          if (!tables || Date.now() - tables.at > 864e5) { tables = { at: Date.now(), data: await ep.regularTables() }; save('regular.json', tables); }
          return regularDay(tables.data, id, date);
        }
      });
    }
    teacherCache.set(key, { at: Date.now(), lessons, source });
    send(res, 200, { date, lessons, source });
  },
  // Kalender: beliebige Woche (Mo–Fr). Was schon im Abgleich steckt, kommt ohne EduPage-Anfrage; Rest 10 Min. zwischengespeichert
  'GET /api/week': async (req, res) => {
    const start = new URL(req.url, 'http://x').searchParams.get('start') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || new Date(`${start}T12:00`).getDay() !== 1) throw bad('start muss ein Montag sein');
    const dates = [0, 1, 2, 3, 4].map((n) => isoDay(addDays(new Date(`${start}T12:00`), n)));
    const known = load('snapshot.json', null)?.days || [], hit = weekCache.get(start);
    if (DEMO) return send(res, 200, { days: demo.snapshot(new Date(`${start}T08:00`)).days });
    if (dates.every((d) => known.some((x) => x.date === d))) return send(res, 200, { days: dates.map((d) => known.find((x) => x.date === d)) });
    if (hit && Date.now() - hit.at < 10 * 60e3) return send(res, 200, { days: hit.days });
    if (!load('config.json', {}).edupage) return send(res, 200, { days: [] });
    const days = await edupageDo(async (ep) => {
      const out = [];
      for (const d of dates) out.push(known.find((x) => x.date === d) || schoolDay(d, await ep.plan(d).then((p) => ep.lessons(p), () => [])));
      return out;
    });
    weekCache.set(start, { at: Date.now(), days });
    send(res, 200, { days });
  },
  'GET /api/summary': (req, res) => send(res, 200, summary(new URL(req.url, 'http://x').searchParams.get('day'))),

  'POST /api/items/:kind': async (req, res, kind) => {
    if (!KINDS[kind]) return send(res, 404, { error: 'unbekannt' });
    if (kind === 'photos') throw bad('Fotos bitte über /api/photos hochladen');
    const item = { id: crypto.randomUUID(), ...clean(kind, await readJson(req)), updated: new Date().toISOString() };
    const d = db(); d[kind].push(item); save('db.json', d);
    send(res, 200, item);
  },
  'PUT /api/items/:kind/:id': async (req, res, kind, id) => {
    if (!KINDS[kind]) return send(res, 404, { error: 'unbekannt' });
    const body = await readJson(req), d = db(), i = d[kind].findIndex((x) => x.id === id);
    if (i < 0) return send(res, 404, { error: 'nicht gefunden' });
    d[kind][i] = { id, ...clean(kind, { ...d[kind][i], ...body }), updated: new Date().toISOString() };
    save('db.json', d);
    send(res, 200, d[kind][i]);
  },
  'DELETE /api/items/:kind/:id': (req, res, kind, id) => {
    if (!KINDS[kind]) return send(res, 404, { error: 'unbekannt' });
    const d = db();
    if (kind === 'photos' && d.photos.some((x) => x.id === id)) fs.rmSync(path.join(PHOTOS, `${id}.jpg`), { force: true }); // id stammt vom Server
    d[kind] = d[kind].filter((x) => x.id !== id); save('db.json', d);
    send(res, 200, { ok: true });
  },

  'POST /api/edupage': async (req, res) => {
    if (DEMO) return send(res, 400, { error: 'Im Demo-Modus nicht möglich' });
    const b = await readJson(req);
    const cfg = {
      school: String(b.school || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.edupage\.org.*$/, ''),
      user: String(b.user || '').trim(), pass: String(b.pass || ''),
    };
    const old = load('config.json', {}).edupage;
    if (!/^[a-z0-9-]{2,63}$/.test(cfg.school) || !cfg.user || !cfg.pass) return send(res, 400, { error: 'Bitte Schul-Adresse, Benutzername und Passwort angeben.' });
    try {
      const ep = new Edupage(cfg.school);
      await ep.login(cfg.user, cfg.pass);
      save('session.json', Object.fromEntries(ep.cookies));
    } catch (e) {
      return send(res, 400, { error: e instanceof EduError ? e.message : `EduPage nicht erreichbar (${e.message})` });
    }
    save('config.json', { ...load('config.json', {}), edupage: cfg });
    save('status.json', {});
    const st = state(); st.eduSeeded = false; save('state.json', st); // neues Konto: Bestand nicht als neu melden
    await sync(0);
    send(res, 200, payload());
  },
  'DELETE /api/edupage': (req, res) => {
    const c = load('config.json', {}); delete c.edupage; save('config.json', c);
    for (const n of ['snapshot.json', 'session.json', 'status.json']) fs.rmSync(file(n), { force: true });
    const st = state(); st.eduSeeded = false; save('state.json', st);
    send(res, 200, payload());
  },

  'POST /api/settings': async (req, res) => {
    const b = await readJson(req), c = load('config.json', {});
    if (b.state !== undefined) { if (!STATES.includes(b.state)) throw bad('Unbekanntes Bundesland'); c.state = b.state; }
    if (typeof b.lessonPush === 'boolean') c.lessonPush = b.lessonPush;
    if (b.place !== undefined) {
      const lat = Number(b.place?.lat), lon = Number(b.place?.lon);
      if (b.place && !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw bad('Ungültiger Ort');
      c.place = b.place ? { name: F.text(120, true)(b.place.name), lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 } : null;
    }
    for (const k of ['home', 'school']) {
      const s = b.stops?.[k];
      if (s === undefined) continue;
      if (s && !/^[\w:.-]{1,80}$/.test(String(s.id))) throw bad('Ungültige Haltestelle');
      c.stops = { ...c.stops, [k]: s ? { id: String(s.id), name: F.text(120, true)(s.name) } : null };
    }
    if (b.wakeLead !== undefined) c.wakeLead = F.num(0, 240, 60)(b.wakeLead);
    if (b.haTodo !== undefined && c.ha) {
      if (b.haTodo && !/^todo\.[a-z0-9_]+$/.test(b.haTodo)) throw bad('Ungültige Liste');
      c.ha.todo = b.haTodo || '';
    }
    if (b.haPc !== undefined && c.ha) {
      if (!Array.isArray(b.haPc) || b.haPc.length > 12 || !b.haPc.every((x) => HA_PC.test(x))) throw bad('Ungültige Auswahl');
      c.ha.pc = b.haPc;
    }
    if (b.ticket !== undefined) {
      const t = { name: F.text(80)(b.ticket?.name), url: F.text(1000)(b.ticket?.url), until: F.date()(b.ticket?.until) };
      if (t.url && (!/^[a-z][a-z0-9+.-]*:\S+$/i.test(t.url) || /^(javascript|data|vbscript|file|blob):/i.test(t.url))) throw bad('Bitte einen gültigen Link eintragen');
      c.ticket = t.name || t.url || t.until ? t : null;
    }
    save('config.json', c);
    if (b.state) await refreshHolidays(true);
    if (b.place) await refreshWeather(true);
    send(res, 200, payload());
  },
  'GET /api/places': async (req, res) => {
    const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return send(res, 200, []);
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=de`).catch(() => { throw bad('Ortssuche gerade nicht erreichbar'); });
    send(res, 200, (j.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country_code !== 'DE' && r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude })));
  },
  'GET /api/stops': async (req, res) => {
    const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return send(res, 200, []);
    const j = await getJson(`${EFA}/XML_STOPFINDER_REQUEST?outputFormat=rapidJSON&type_sf=any&name_sf=${encodeURIComponent(q)}`).catch(() => { throw bad('Haltestellensuche gerade nicht erreichbar'); });
    send(res, 200, (j.locations || []).filter((l) => l.type === 'stop').slice(0, 8).map((l) => ({ id: l.id, name: l.name })));
  },
  'GET /api/trips': async (req, res) => {
    const u = new URL(req.url, 'http://x').searchParams, dir = u.get('to') === 'home' ? 'home' : 'school';
    const date = u.get('date') || isoDay(new Date()), time = u.get('time') || hhmm(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw bad('Datum/Uhrzeit ungültig');
    const list = await cachedTrips(dir, date, time).catch(() => { throw bad('Fahrplan gerade nicht erreichbar'); });
    send(res, 200, { trips: list || [], configured: !!list });
  },
  // Kurzbefehle: nur die Uhrzeit als Text (leer = keine Schule) – für „Wecker erstellen“ bzw. „Fokus … bis“
  'GET /api/wake': async (req, res) => send(res, 200, await wakeTime(isoDay(addDays(new Date(), new URL(req.url, 'http://x').searchParams.get('day') === 'heute' ? 0 : 1)))),
  'GET /api/focus': (req, res) => send(res, 200, schoolTimes(isoDay(addDays(new Date(), new URL(req.url, 'http://x').searchParams.get('day') === 'morgen' ? 1 : 0)))?.end || ''),
  // Tafelbilder: Bild als JPEG im Body, Angaben in der Adresse
  'POST /api/photos': async (req, res) => {
    const u = new URL(req.url, 'http://x').searchParams, buf = await readBody(req, 8e6);
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw bad('Bitte ein Foto (JPEG) senden');
    const item = { id: crypto.randomUUID(), ...clean('photos', { subject: u.get('subject'), date: u.get('date'), caption: u.get('caption') }), updated: new Date().toISOString() };
    fs.writeFileSync(path.join(PHOTOS, `${item.id}.jpg`), buf, { mode: 0o600 });
    const d = db(); d.photos.push(item); save('db.json', d);
    send(res, 200, item);
  },
  'GET /api/photos/:id': (req, res, id) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return send(res, 404, { error: 'nicht gefunden' });
    fs.readFile(path.join(PHOTOS, `${id}.jpg`), (err, buf) => {
      if (err) return send(res, 404, { error: 'nicht gefunden' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      res.end(buf);
    });
  },

  // Lernzeit (Fokus-Timer): Ende meldet der Server per Mitteilung, auch wenn die App zu ist
  'POST /api/timer': async (req, res) => {
    const b = await readJson(req), st = state(), minutes = F.num(1, 180, 25)(b.minutes);
    st.timer = { subject: F.text(80)(b.subject), minutes, start: Date.now(), end: Date.now() + minutes * 60e3 };
    save('state.json', st);
    send(res, 200, payload());
  },
  'POST /api/timer/stop': (req, res) => {
    const st = state(), t = st.timer;
    if (t) {
      delete st.timer; save('state.json', st);
      const m = Math.min(t.minutes, Math.round((Date.now() - t.start) / 60e3));
      if (m >= 1) logSession(t.subject, m, t.start);
    }
    send(res, 200, payload());
  },

  // Home Assistant verbinden (Adresse + langlebiges Zugriffstoken), Liste und Knöpfe wählen
  'POST /api/ha': async (req, res) => {
    const b = await readJson(req), old = load('config.json', {}).ha;
    const url = String(b.url || '').trim().replace(/\/+$/, ''), token = String(b.token || '').trim() || old?.token || '';
    if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url) || !token) throw bad('Bitte Adresse und Zugriffstoken angeben.');
    await ha('/api/', null, { url, token });
    save('config.json', { ...load('config.json', {}), ha: { url, token, todo: old?.todo || '', pc: old?.pc || [] } });
    send(res, 200, payload());
  },
  'DELETE /api/ha': (req, res) => {
    const c = load('config.json', {}); delete c.ha; save('config.json', c);
    send(res, 200, payload());
  },
  'GET /api/ha/entities': async (req, res) => {
    const list = await ha('/api/states');
    send(res, 200, list.filter((e) => /^todo\./.test(e.entity_id) || HA_PC.test(e.entity_id))
      .map((e) => ({ id: e.entity_id, name: e.attributes?.friendly_name || e.entity_id, state: e.state })).sort((a, b) => a.name.localeCompare(b.name, 'de')));
  },
  'GET /api/ha/pc': async (req, res) => {
    const ids = load('config.json', {}).ha?.pc || [];
    send(res, 200, await Promise.all(ids.map((id) => ha(`/api/states/${id}`).then((e) => ({ id, name: e.attributes?.friendly_name || id, state: e.state }), () => ({ id, name: id, state: 'unavailable' })))));
  },
  'POST /api/ha/pc/:id': async (req, res, id) => {
    if (!(load('config.json', {}).ha?.pc || []).includes(id)) throw bad('Dieser Knopf ist nicht freigegeben'); // nur vorher gewählte Aktionen
    const domain = id.split('.')[0], service = { button: 'press', input_button: 'press', script: 'turn_on', switch: 'toggle' }[domain];
    await ha(`/api/services/${domain}/${service}`, { entity_id: id });
    send(res, 200, { ok: true });
  },
  'GET /api/shop': async (req, res) => send(res, 200, await shopItems()),
  'POST /api/shop': async (req, res) => {
    const text = F.text(200, true)((await readJson(req)).text);
    await ha('/api/services/todo/add_item', { entity_id: load('config.json', {}).ha?.todo, item: text });
    send(res, 200, await shopItems());
  },
  'POST /api/shop/:uid': async (req, res, uid) => {
    const { done } = await readJson(req);
    await ha('/api/services/todo/update_item', { entity_id: load('config.json', {}).ha?.todo, item: uid, status: done === true ? 'completed' : 'needs_action' });
    send(res, 200, await shopItems());
  },
  'DELETE /api/shop/done': async (req, res) => {
    await ha('/api/services/todo/remove_completed_items', { entity_id: load('config.json', {}).ha?.todo });
    send(res, 200, await shopItems());
  },
  'GET /api/screen/frame': async (req, res) => { // wartet bis zu 8 s auf ein neues Bild
    const after = Number(new URL(req.url, 'http://x').searchParams.get('after')) || 0, fresh = () => screen.seq > after && screen.frame;
    screen.viewerAt = Date.now();
    wake(screen.agents);
    if (!fresh() && agentOnline()) await waitFor(screen.viewers, 8e3);
    screen.viewerAt = Date.now();
    if (!fresh()) return send(res, 204, '', { 'X-Agent': agentOnline() ? '1' : '0', 'X-Locked': screen.locked ? '1' : '0' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Seq': String(screen.seq), 'X-Screens': String(screen.n), 'X-Screen': String(screen.s) });
    res.end(screen.frame);
  },
  'POST /api/screen/input': async (req, res) => {
    const { events } = await readJson(req);
    if (!Array.isArray(events)) throw bad('events fehlt');
    screen.events = [...screen.events, ...events.slice(0, 60).map(screenEvent).filter(Boolean)].slice(-300);
    send(res, 200, { ok: true });
  },
  'GET /api/push/key': (req, res) => send(res, 200, { key: VAPID.publicKey }),
  'POST /api/push/subscribe': async (req, res) => {
    const s = await readJson(req);
    if (!/^https:\/\//.test(s.endpoint || '') || !s.keys?.p256dh || !s.keys?.auth) return send(res, 400, { error: 'ungültiges Abo' });
    const st = state();
    st.subs = [...st.subs.filter((x) => x.endpoint !== s.endpoint), { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }];
    save('state.json', st);
    send(res, 200, { ok: true });
  },
  'POST /api/push/unsubscribe': async (req, res) => {
    const { endpoint } = await readJson(req), st = state();
    st.subs = st.subs.filter((x) => x.endpoint !== endpoint); save('state.json', st);
    send(res, 200, { ok: true });
  },
  'POST /api/push/test': async (req, res) => {
    const sent = await push({ title: 'Mitteilungen sind aktiv', body: 'So erfährst du ab jetzt von Vertretungen, Nachrichten und Erinnerungen.', url: '/', tag: 'test' });
    send(res, 200, { ok: sent > 0, sent });
  },
  'GET /api/tokens': (req, res) => send(res, 200, TOKENS),
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch { return send(res, 400, 'Bad Request'); }
  const fp = path.join(PUBLIC, rel);
  if (!fp.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not Found');
  fs.readFile(fp, (err, buf) => {
    if (err) return send(res, 404, 'Not Found');
    const type = TYPES[path.extname(fp)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {}) });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
      return serveStatic(req, res, url.pathname);
    }
    if (url.pathname === '/api/ping') return send(res, 200, 'ok'); // Selbst-Wachhalten, verrät nichts
    if (url.pathname === '/api/screen/agent') { // Fernsteuerungs-Programm auf dem PC, eigener Schlüssel statt Anmeldung
      if (req.method !== 'POST' || !same(url.searchParams.get('key') || '', TOKENS.screen)) return send(res, 403, { error: 'falscher Schlüssel' });
      return await screenAgent(req, res, url.searchParams);
    }
    if (url.pathname === '/api/cron') { // geplante Aufgabe in Plesk bzw. cron-job.org ("URL abrufen")
      if (!same(url.searchParams.get('key') || '', TOKENS.cron)) return send(res, 403, { error: 'falscher Schlüssel' });
      await sync(10 * 60e3);
      return send(res, 200, { ok: true, status: load('status.json', {}) });
    }
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('key') || '';
    const widgetRead = req.method === 'GET' && ['/api/data', '/api/summary', '/api/wake', '/api/focus'].includes(url.pathname) && bearer && same(bearer, TOKENS.widget);
    if (url.pathname !== '/api/login' && !loggedIn(req) && !widgetRead) return send(res, 401, { error: 'login' });
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'items', 'notes', '<id>']
    for (const [key, fn] of Object.entries(routes)) {
      const [method, pattern] = key.split(' '), p = pattern.split('/').filter(Boolean);
      if (method !== req.method || p.length !== parts.length) continue;
      const args = [];
      if (p.every((seg, i) => (seg.startsWith(':') ? (args.push(decodeURIComponent(parts[i])), true) : seg === parts[i]))) return await fn(req, res, ...args);
    }
    send(res, 404, { error: 'unbekannt' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Serverfehler' });
    if (!e.status) console.error(e);
  }
});
server.listen(process.env.PORT || 3000, () => console.log(`${APP} läuft auf http://localhost:${process.env.PORT || 3000}${DEMO ? ' (Demo, Passwort "demo")' : ''}`));
