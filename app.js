'use strict';
// Alltag – Server und Plesk-Startdatei (Node.js; unter Plesk/Passenger oder lokal mit `node app.js`).
// Liefert die Web-App aus, speichert eigene Einträge, gleicht EduPage ab und verschickt Push-Mitteilungen.
process.env.TZ ||= 'Europe/Berlin'; // Plesk-Server laufen oft in UTC – "heute" soll deutsche Zeit sein

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateVapidKeys, sendPush } = require('./push');
const { Edupage, EduError, snapshot, SNAPSHOT_VERSION, isoDay, addDays } = require('./edupage');
const demo = require('./demo');

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
const VAPID = once('vapid.json', generateVapidKeys);
if (DEMO && !load('db.json', null)) save('db.json', demo.db());

const state = () => ({ seen: [], subs: [], done: {}, eduSeeded: false, ...load('state.json', {}) });
const db = () => ({ reminders: [], events: [], notes: [], grades: [], ...load('db.json', {}) });

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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 200e3) { reject(Object.assign(new Error('zu groß'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(Object.assign(new Error('kein JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
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
const KINDS = {
  reminders: { title: F.text(200, true), notes: F.text(4000), due: F.date(), time: F.time(), category: F.pick('privat', 'schule'), subject: F.text(80), done: F.bool() },
  events: { title: F.text(200, true), date: F.date(true), start: F.time(), end: F.time(), location: F.text(120), notes: F.text(4000), category: F.pick('privat', 'schule') },
  notes: { title: F.text(200), body: F.text(50000), subject: F.text(80), pinned: F.bool() },
  grades: { subject: F.text(80, true), value: F.text(12, true), weight: F.num(0, 10, 1), title: F.text(120), date: F.date() },
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
    out.push([`msg|${x.id}`, { title: x.author || 'Neue Nachricht', body: x.text.slice(0, 180), url: `/#schule/${m.id}`, tag: `msg-${x.id}` }]);
  }
  for (const r of data.reminders) { // eigene Erinnerung zur eingestellten Uhrzeit
    if (!r.done && r.due && r.time && (r.due < today || (r.due === today && r.time <= hm))) {
      out.push([`rem|${r.id}|${r.due}|${r.time}`, { title: 'Erinnerung', body: r.title, url: '/#aufgaben', tag: `rem-${r.id}` }]);
    }
  }
  for (const e of data.events) { // Termin: etwa 30 Minuten vorher
    if (e.date === today && e.start) {
      const mins = toMin(e.start) - (now.getHours() * 60 + now.getMinutes());
      if (mins >= 0 && mins <= 35) out.push([`evt|${e.id}|${e.date}|${e.start}`, { title: `${e.title} · ${e.start} Uhr`, body: e.location || 'Gleich geht’s los', url: `/#kalender/${e.date}`, tag: `evt-${e.id}` }]);
    }
  }
  if (now.getHours() >= 17) { // Abendübersicht für morgen
    const due = [...(snap?.tasks || []).filter((t) => t.kind !== 'event' && t.due === tomorrow && !(done[t.id] ?? t.done)),
      ...data.reminders.filter((r) => r.due === tomorrow && !r.done)];
    const evs = data.events.filter((e) => e.date === tomorrow);
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
  const items = news(snap, db(), st.done, new Date());
  const seen = new Set(st.seen), quiet = !st.eduSeeded; // erster EduPage-Abgleich: Bestand still übernehmen
  let fresh = items.filter(([k]) => !seen.has(k));
  st.seen = [...st.seen, ...fresh.map(([k]) => k)].slice(-4000);
  if (snap) st.eduSeeded = true;
  save('state.json', st);
  if (quiet) fresh = fresh.filter(([k]) => !k.startsWith('sub|') && !k.startsWith('msg|'));
  const subs = fresh.filter(([k]) => k.startsWith('sub|'));
  if (subs.length > 3) { // Sammelmeldung statt Mitteilungsflut
    fresh = fresh.filter(([k]) => !k.startsWith('sub|'));
    fresh.push(['', { title: `${subs.length} neue Vertretungen`, body: `${subs.slice(0, 3).map(([, p]) => p.body).join(' · ')} …`, url: '/#kalender', tag: 'subs' }]);
  }
  for (const [, p] of fresh) await push(p);
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
// nach einem Update mit neuer Auswertung sofort neu abgleichen, sonst nur wenn der letzte Abgleich älter als 10 Min. ist
setTimeout(() => sync(load('snapshot.json', null)?.v === SNAPSHOT_VERSION ? 10 * 60e3 : 0), 3000);

/* ------------------------------------------------------------------ API */
function payload() {
  const st = state(), snap = load('snapshot.json', null), cfg = load('config.json', {}).edupage;
  return {
    app: APP, demo: DEMO, status: load('status.json', {}),
    edupage: DEMO ? { connected: true, school: 'demo', user: 'demo' } : cfg ? { connected: true, school: cfg.school, user: cfg.user } : { connected: false },
    snap: snap && { ...snap, tasks: snap.tasks.map((t) => ({ ...t, done: st.done[t.id] ?? t.done })) },
    db: db(),
  };
}

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
    send(res, 200, { ok: true });
  },

  'POST /api/items/:kind': async (req, res, kind) => {
    if (!KINDS[kind]) return send(res, 404, { error: 'unbekannt' });
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
    const d = db(); d[kind] = d[kind].filter((x) => x.id !== id); save('db.json', d);
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
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

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
    if (url.pathname === '/api/cron') { // geplante Aufgabe in Plesk bzw. cron-job.org ("URL abrufen")
      if (!same(url.searchParams.get('key') || '', TOKENS.cron)) return send(res, 403, { error: 'falscher Schlüssel' });
      await sync(10 * 60e3);
      return send(res, 200, { ok: true, status: load('status.json', {}) });
    }
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    const widgetRead = req.method === 'GET' && url.pathname === '/api/data' && bearer && same(bearer, TOKENS.widget);
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
