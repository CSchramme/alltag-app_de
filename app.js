'use strict';
// Alltag – Server und Plesk-Startdatei (Node.js; unter Plesk/Passenger oder lokal mit `node app.js`).
// Liefert die Web-App aus, speichert eigene Einträge, gleicht EduPage ab und verschickt Push-Mitteilungen.
process.env.TZ ||= 'Europe/Berlin'; // Plesk-Server laufen oft in UTC – "heute" soll deutsche Zeit sein

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { generateVapidKeys, sendPush } = require('./push');
const { Edupage, EduError, snapshot, schoolDay, regularDay, SNAPSHOT_VERSION, isoDay, addDays } = require('./edupage');
const { Untis, UntisError, searchSchools, SERVER_RE } = require('./untis');
const { Schulmanager } = require('./schulmanager');
const demo = require('./demo');
const { occursOn, birthdayOn, ageOn } = require('./public/recur');
const Ical = require('./ical');
const { PLANS, FEATURES, SOON } = require('./plaene');
const Formulare = require('./public/formulare');

// Einstellungen auch aus der Datei .env im App-Ordner (NAME=Wert je Zeile, # = Kommentar). Echte Umgebungsvariablen
// (z. B. aus Plesk) haben Vorrang. Die Datei enthält Geheimnisse und kommt nie ins Git (.gitignore); Vorlage: .env.beispiel
const ENV_FILE = process.env.ENV_FILE ?? path.join(__dirname, '.env');
if (ENV_FILE && fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

const APP = 'Alltag';
const DEMO = process.env.DEMO === '1';
// Betriebsarten: ohne Angabe die eigene, private App (ein Passwort). ACCOUNTS=1: öffentliche Version mit Konten und Einladungscodes.
const ACCOUNTS = !DEMO && process.env.ACCOUNTS === '1';
const PRIVATE = process.env.PRIVATE === '1' || (!ACCOUNTS && !DEMO); // Home Assistant und PC-Fernsteuerung nur in der privaten App
const OPEN_DEMO = DEMO && !PRIVATE; // öffentliche Demo: keine Fotos und Mitteilungen von Fremden, Daten setzen sich zurück
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, DEMO ? 'data-demo' : 'data');
const PASSWORD = DEMO ? 'demo' : process.env.APP_PASSWORD; // private App: das eine Passwort
if (!PASSWORD && !ACCOUNTS) {
  console.error('APP_PASSWORD fehlt. In Plesk unter Node.js → „Benutzerdefinierte Umgebungsvariablen“ setzen.');
  process.exit(1);
}
// Mit Konten: Registrieren, Anmelden, E-Mail und Passwort laufen über den eigenen Konto-Dienst (accounts.alltag-app.de, eigenes Git).
// Die App bekommt nach dem Anmelden einen Einmal-Code und tauscht ihn mit dem gemeinsamen Schlüssel gegen die Kontodaten.
const ACCOUNTS_URL = String(process.env.ACCOUNTS_URL || '').replace(/\/+$/, '');
const ACCOUNTS_SECRET = process.env.ACCOUNTS_SECRET || '';
if (ACCOUNTS && (!/^https?:\/\/[^/]+$/.test(ACCOUNTS_URL) || ACCOUNTS_SECRET.length < 32)) {
  console.error('Mit Konten braucht die App ACCOUNTS_URL (Adresse des Konto-Dienstes, z. B. https://accounts.alltag-app.de) und ACCOUNTS_SECRET (mindestens 32 Zeichen, derselbe Wert wie dort).');
  process.exit(1);
}
// Verwaltung als eigene Seite (Ordner admin/, z. B. https://admin.alltag-app.de). Nur sie darf die Admin-API aus dem Browser nutzen.
// Sie muss zur selben Website gehören wie die App (Subdomain), sonst schickt der Browser das Sitzungs-Cookie (SameSite=Lax) nicht mit.
const ADMIN_URL = ACCOUNTS ? String(process.env.ADMIN_URL || '').replace(/\/+$/, '') : '';
if (ADMIN_URL && !/^https?:\/\/[^/]+$/.test(ADMIN_URL)) {
  console.error('ADMIN_URL muss eine Adresse ohne Pfad sein, z. B. https://admin.alltag-app.de');
  process.exit(1);
}
if (ACCOUNTS && String(process.env.DATA_KEY || '').length < 32) { // Schulpasswörter fremder Leute nie mit einem Schlüssel, der neben den Daten liegt
  console.error('DATA_KEY fehlt oder ist kürzer als 32 Zeichen. Mit Konten ist er Pflicht (Umgebungsvariable, zufällig, nie ändern).');
  process.exit(1);
}

/* ------------------------------------------------------------------ Dateien (außerhalb von public/) */
// Mit Konten hat jedes Konto einen eigenen Ordner (DATA/users/<id>). Welcher gerade gilt, steht im Kontext der Anfrage
// bzw. des Hintergrund-Abgleichs – so bleiben load()/save() überall gleich.
const ctx = new AsyncLocalStorage();
const home = () => ctx.getStore()?.dir || DATA;
const atRoot = (fn) => ctx.exit(fn); // Dateien der ganzen Instanz: Konten, Einladungen, eigene Adresse
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const file = (n) => path.join(home(), n);
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
function userTokens() { // mit Konten: Lese-Schlüssel je Konto; Kalender-Abo hat einen eigenen (die Adresse liegt beim Kalender-Anbieter)
  const t = ACCOUNTS && me() ? once('tokens.json', () => ({ widget: token() })) : TOKENS;
  if (!t.calendar) { t.calendar = token(); save('tokens.json', t); }
  return t;
}
// Lese-Schlüssel (Widget/Kurzbefehle bzw. Kalender) → Konto; ohne Konten genügt der eine Schlüssel
function readerFor(key, kind = 'widget') {
  if (!key) return null;
  if (!ACCOUNTS) return (!!TOKENS[kind] && same(key, TOKENS[kind])) || null;
  return accounts().find((a) => !a.disabled && same(key, asUser(a, () => load('tokens.json', {}))[kind] || '')) || null;
}
const VAPID = once('vapid.json', generateVapidKeys);
if (DEMO && !load('db.json', null)) save('db.json', demo.db());

const state = () => ({ seen: [], subs: [], done: {}, eduSeeded: false, ...load('state.json', {}) });
const db = () => ({ reminders: [], events: [], notes: [], grades: [], birthdays: [], photos: [], sessions: [], lessons: [], ...load('db.json', {}) });
const photoDir = () => { const p = path.join(home(), 'photos'); fs.mkdirSync(p, { recursive: true, mode: 0o700 }); return p; }; // Tafelbilder als JPEG, nur angemeldet abrufbar

/* ------------------------------------------------------------------ Hilfen */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
// Schul-Passwörter verschlüsselt ablegen. DATA_KEY (Umgebungsvariable) liegt nicht bei den Daten; ohne ihn gilt der Server-Schlüssel.
const KEY = sha(process.env.DATA_KEY || SECRET);
function seal(s) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv), enc = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return `enc:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}
function unseal(s) { // ältere, unverschlüsselte Einträge kommen unverändert zurück
  if (!String(s).startsWith('enc:')) return s;
  const b = Buffer.from(s.slice(4), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

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
// Bilder kommen als Formular-Datei mit Base64-Inhalt: die Firewall des Hosters (ModSecurity/Comodo) wertet image/jpeg als Angriff
// und sperrt danach die IP; Base64 verhindert, dass zufällige Bytes im Bild wie eine Formular-Grenze aussehen.
async function readImage(req, max) {
  const buf = await readBody(req, max);
  if (!buf.length) return buf;
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(req.headers['content-type'] || ''), s = buf.toString('latin1');
  const i = s.indexOf('\r\n\r\n'), j = m ? s.indexOf(`\r\n--${m[1] || m[2]}`, i) : -1;
  const img = i >= 0 && j > i ? Buffer.from(s.slice(i + 4, j), 'base64') : Buffer.alloc(0);
  if (img.length < 4 || img[0] !== 0xff || img[1] !== 0xd8 || img[2] !== 0xff) throw bad('Bitte ein Foto (JPEG) senden');
  return img;
}

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k));
const https = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
/* ------------------------------------------------------------------ Konten (nur mit ACCOUNTS=1) */
const userDir = (id) => path.join(DATA, 'users', id);
const accounts = () => atRoot(() => load('konten.json', [])); // Abbild der Konten vom Konto-Dienst, ohne Passwörter
const seenAt = () => atRoot(() => load('seen.json', {})); // zuletzt in der App aktiv, je Konto
async function accountsApi(p, method = 'GET', body) {
  const r = await fetch(`${ACCOUNTS_URL}${p}`, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${ACCOUNTS_SECRET}`, 'Content-Type': 'application/json' } })
    .catch(() => { throw Object.assign(new Error('Der Konto-Dienst ist gerade nicht erreichbar.'), { status: 503 }); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Konto-Dienst: Fehler ${r.status}`), { status: r.status >= 500 ? 502 : 400, code: r.status });
  return j;
}
// Abbild neu laden. Daten löscht die App nur bei einer ausdrücklichen Löschnotiz, nie weil ein Konto in der Liste fehlt.
async function refreshAccounts() {
  const { accounts: list, deleted = [] } = await accountsApi('/api/accounts');
  if (!Array.isArray(list)) return;
  atRoot(() => save('konten.json', list));
  for (const d of deleted) if (/^[0-9a-f-]{36}$/i.test(d.id) && !list.some((a) => a.id === d.id)) fs.rmSync(userDir(d.id), { recursive: true, force: true });
}
const keepAccount = (a) => atRoot(() => save('konten.json', [...accounts().filter((x) => x.id !== a.id), a]));
// Umzug: Konten aus der Zeit vor dem Konto-Dienst einmal dorthin übergeben (Passwörter bleiben gültig, E-Mail wird beim ersten Anmelden nachgetragen)
async function migrateAccounts() {
  const old = atRoot(() => load('accounts.json', null));
  if (!Array.isArray(old) || !old.length) return;
  const r = await accountsApi('/api/import', 'POST', { accounts: old, invites: atRoot(() => load('invites.json', [])) }).catch((e) => e);
  if (r instanceof Error && r.code !== 409) throw r; // 409: dort gibt es schon Konten, dann gilt deren Stand
  atRoot(() => {
    save('seen.json', { ...Object.fromEntries(old.filter((a) => a.lastSeen).map((a) => [a.id, a.lastSeen])), ...load('seen.json', {}) });
    for (const n of ['accounts.json', 'invites.json']) if (fs.existsSync(file(n))) fs.renameSync(file(n), file(n.replace('.json', '-vor-konto-dienst.json')));
  });
  console.log(r instanceof Error ? 'Konto-Dienst hatte schon Konten, alte Liste nur gesichert.' : `${r.imported} Konten an den Konto-Dienst übergeben.`);
}
const SCHOOLS = ['edupage', 'untis', 'schulmanager', 'none'];
const SCHOOL_NAMES = { edupage: 'EduPage', untis: 'WebUntis', schulmanager: 'Schulmanager' };
const asUser = (a, fn) => ctx.run({ dir: userDir(a.id), account: a }, fn);
const me = () => ctx.getStore()?.account || null;
const isDemo = () => DEMO || !!me()?.demo; // Beispieldaten statt Schulsoftware
const limited = () => OPEN_DEMO || (!!me()?.demo && !me()?.jury); // öffentliche Demo: keine Fotos, keine Mitteilungen, setzt sich zurück. Jugend-forscht-Konto: alles frei, Zurücksetzen per Admin
// Abo-Plan des Kontos (plaene.js): private App, Admins und Demo-Konten haben alles, sonst setzt der Admin den Plan
const planOf = (a) => (!ACCOUNTS || a?.admin || a?.demo ? 'familie' : PLANS[a?.plan] ? a.plan : a?.pro ? 'pro' : 'free');
const has = (f) => PLANS[planOf(me())].features.includes(f);
const isPro = () => planOf(me()) !== 'free';
const plansVisible = () => !!siteSettings().plansVisible; // Plan-Auswahl für Nutzer: schaltet der Admin frei, sonst nur Vorschau für Admins
const supportId = (a) => a.id.replace(/-/g, '').slice(0, 8).toUpperCase().replace(/^(.{4})/, '$1-'); // zum Nennen bei Fragen
const school = () => me()?.school || 'edupage';
function admin() { if (!me()?.admin) throw Object.assign(new Error('Nur für Admins'), { status: 403 }); }
const demoAccount = () => accounts().find((a) => a.demo && !a.disabled);
async function adminData(extra = {}) { // Konten aus dem Abbild, Einladungscodes direkt vom Konto-Dienst
  const seen = seenAt();
  return { me: me()?.id || null, accountsUrl: ACCOUNTS_URL, accounts: accounts().map((a) => pubAccount(a, seen)), site: process.env.PUBLIC_URL || '',
    legal: legalInfo(), // Impressum-Angaben: Formular in der Verwaltung und Flyer
    plans: { list: PLANS, features: FEATURES, soon: SOON, visible: plansVisible() }, // Abo-Pläne für die Verwaltung
    invites: extra.invites || (await accountsApi('/api/invites')).invites, ...extra };
}
// Beta-Test: Anmeldungen, Rückmeldungen und Einstellungen der Instanz (Abschlussumfrage offen?)
const betaList = () => atRoot(() => load('beta.json', []));
const feedbackList = () => atRoot(() => load('feedback.json', []));
const siteSettings = () => atRoot(() => load('site.json', {}));
const tellAdmins = (p) => { // kurze Mitteilung an alle Admins (neue Anmeldung, neue Rückmeldung)
  if (ACCOUNTS) for (const a of accounts().filter((x) => x.admin && !x.disabled)) asUser(a, () => push(p)).catch(() => {});
};
const pubAccount = (a, seen = seenAt()) => ({ id: a.id, support: supportId(a), name: a.name, email: a.email || '', emailOk: !!a.emailOk, school: a.school, admin: !!a.admin,
  disabled: !!a.disabled, demo: !!a.demo, jury: !!a.jury, pro: !!a.pro, plan: planOf(a), created: a.created, lastSeen: seen[a.id] || null });
/* ------------------------------------------------------------------ Eigene Statistik (nur mit Konten): ohne Cookies, ohne fremde Dienste */
// Besucher = Hash aus IP, Browserkennung und einem Tages-Salz. Das Salz und die Hashes gibt es nur am selben Tag,
// danach bleiben nur Zahlen. Aktive Konten zählen über das Laden der App-Daten (die App selbst kommt oft aus dem Cache).
const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python|httpclient|monitor|uptime|headless|preview|facebookexternalhit|lighthouse/i;
const platformOf = (ua) => (/iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : 'Andere');
const count = (x) => (Array.isArray(x) ? x.length : x || 0);
function track(fn) {
  if (!ACCOUNTS) return;
  atRoot(() => {
    const s = load('stats.json', { days: {} }), today = isoDay(new Date()), fresh = s.salt?.day !== today;
    if (fresh) {
      s.salt = { day: today, v: crypto.randomBytes(16).toString('hex') };
      for (const [d, x] of Object.entries(s.days)) {
        if (d < isoDay(addDays(new Date(), -400))) delete s.days[d];
        else if (d < today) Object.assign(x, { visitors: count(x.visitors), active: count(x.active) });
      }
    }
    const t = (s.days[today] ||= { views: 0, visitors: [], active: [], logins: 0, signups: 0, demo: 0, platforms: {} });
    if (fn(t, s.salt.v) !== false || fresh) save('stats.json', s);
  });
}
function trackView(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ACCOUNTS || !ua || BOT_RE.test(ua) || sessionUser(req)?.admin) return; // eigene Besuche als Admin zählen nicht
  track((t, salt) => {
    t.views++;
    const h = crypto.createHash('sha256').update(`${salt}|${clientIp(req)}|${ua}`).digest('hex').slice(0, 16);
    if (t.visitors.includes(h) || t.visitors.length >= 50000) return;
    t.visitors.push(h);
    t.platforms[platformOf(ua)] = (t.platforms[platformOf(ua)] || 0) + 1;
  });
}
const trackCount = (k) => track((t) => { t[k] = (t[k] || 0) + 1; });
const trackActive = (a) => track((t) => (a.admin || t.active.includes(a.id) ? false : void t.active.push(a.id)));
function statsData() {
  track(() => false); // neuer Tag: Hashes von gestern zu Zahlen machen
  const s = atRoot(() => load('stats.json', { days: {} })), list = accounts().filter((a) => !a.demo), now = Date.now(), last = seenAt();
  const days = [];
  for (let i = 29; i >= 0; i--) { // neue Konten zählt der Konto-Dienst mit (Anlegedatum), alles andere die App
    const date = isoDay(addDays(new Date(), -i)), x = s.days[date] || {};
    days.push({ date, visitors: count(x.visitors), views: x.views || 0, active: count(x.active), logins: x.logins || 0, signups: list.filter((a) => isoDay(new Date(a.created)) === date).length, demo: x.demo || 0 });
  }
  const platforms = {};
  for (const d of days) for (const [k, v] of Object.entries(s.days[d.date]?.platforms || {})) platforms[k] = (platforms[k] || 0) + v;
  const seen = (ms) => list.filter((a) => last[a.id] && now - Date.parse(last[a.id]) < ms).length;
  const schools = {}, use = { link: 0, push: 0, events: 0, reminders: 0, grades: 0, notes: 0, photos: 0 };
  for (const a of list) {
    schools[a.school] = (schools[a.school] || 0) + 1;
    asUser(a, () => { // nur ob etwas genutzt wird, nie was drinsteht
      const c = load('config.json', {}), d = load('db.json', {});
      if (a.school === 'none' ? (d.lessons || []).length : c[a.school || 'edupage']) use.link++;
      if ((load('state.json', {}).subs || []).length) use.push++;
      for (const k of ['events', 'reminders', 'grades', 'notes', 'photos']) if ((d[k] || []).length) use[k]++;
    });
  }
  return { days, platforms, schools, use, accounts: list.length, active: { day: seen(864e5), week: seen(7 * 864e5), month: seen(30 * 864e5) } };
}

// Hintergrund-Aufgaben nacheinander für jedes aktive Konto (ohne Konten: einmal für die App)
async function eachUser(fn) {
  if (!ACCOUNTS) return fn();
  // neue, noch unbestätigte Konten haben noch keinen Datenordner; umgezogene Konten ohne bestätigte E-Mail gleichen weiter ab
  for (const a of accounts().filter((x) => !x.disabled && (x.emailOk || x.demo || fs.existsSync(userDir(x.id))))) {
    try { await asUser(a, fn); } catch (e) { console.error(`Konto ${a.name}:`, e); }
  }
}

// Sitzung: ohne Konten „Ablauf.Signatur“, mit Konten „Konto.Ablauf.Signatur“. Die Signatur enthält die Version des Kontos –
// Passwort zurücksetzen oder Sperren erhöht sie und beendet damit alle alten Sitzungen.
function sessionUser(req) {
  const sid = cookies(req).sid || '';
  if (!ACCOUNTS) { const [exp, sig] = sid.split('.'); return !!sig && Number(exp) > Date.now() && same(sig, sign(exp)); }
  const [id, exp, sig] = sid.split('.');
  const a = sig && Number(exp) > Date.now() && accounts().find((x) => x.id === id);
  return a && !a.disabled && same(sig, sign(`${id}.${exp}.${a.ver || 0}`)) ? a : null;
}
const loggedIn = (req) => !!sessionUser(req);
function sessionCookie(req, maxAge, a) {
  const exp = String(Date.now() + maxAge * 1000);
  const v = !maxAge ? '' : a ? `${a.id}.${exp}.${sign(`${a.id}.${exp}.${a.ver || 0}`)}` : `${exp}.${sign(exp)}`;
  return `sid=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https(req) ? '; Secure' : ''}`;
}
// Bremse gegen Passwort- und Code-Raten: je Gerät (IP) und je Konto höchstens 10 Fehlversuche in 15 Minuten.
// So kann ein Fremder mit falschen Versuchen nur sich selbst bzw. das angegriffene Konto bremsen, nicht alle.
const clientIp = (req) => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',').pop() || req.socket.remoteAddress || '').trim();
const tries = new Map(); // Schlüssel → Zeitpunkte der Fehlversuche
function throttled(...keys) {
  const since = Date.now() - 15 * 60e3;
  return keys.some((k) => { const l = (tries.get(k) || []).filter((t) => t > since); tries.set(k, l); return l.length >= 10; });
}
async function fail(res, status, error, ...keys) {
  if (tries.size > 20000) tries.clear(); // Speicher begrenzen
  for (const k of keys) tries.set(k, [...(tries.get(k) || []), Date.now()]);
  await new Promise((r) => setTimeout(r, 800));
  send(res, status, { error });
}
const TOO_MANY = { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut.' };
/* ------------------------------------------------------------------ Eigene Einträge: erlaubte Felder */
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const F = {
  text: (max, required) => (v) => { const s = String(v ?? '').trim().slice(0, max); if (required && !s) throw bad('Pflichtfeld fehlt'); return s; },
  date: (required) => (v) => { const s = String(v ?? ''); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; if (required) throw bad('Datum fehlt'); return ''; },
  time: (required) => (v) => { const s = String(v ?? ''); if (/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s; if (required) throw bad('Uhrzeit fehlt'); return ''; },
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
  lessons: { day: (v) => Math.min(6, Math.max(1, Math.round(Number(v)) || 1)), start: F.time(true), end: F.time(true), subject: F.text(80, true), room: F.text(40), teacher: F.text(80) }, // eigener Stundenplan (ohne Schulsoftware), Mo = 1
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
const saveSession = (cookies) => save('session.json', seal(JSON.stringify(cookies)));
function loadSession() { // passt der Schlüssel nicht (mehr), einfach neu anmelden
  const v = load('session.json', {});
  try { return typeof v === 'string' ? JSON.parse(unseal(v)) : v; } catch { return {}; }
}
// Gespeicherte Sitzung weiterverwenden, nur wenn sie abgelaufen ist neu einloggen (Captcha-Schutz)
async function connect(cfg) {
  const ep = new Edupage(cfg.school, loadSession());
  try { await ep.refresh(); } catch (e) { if (!(e instanceof EduError) && !(e instanceof SyntaxError)) throw e; await ep.login(cfg.user, unseal(cfg.pass)); }
  saveSession(Object.fromEntries(ep.cookies));
  return ep;
}


async function edupageDo(fn) {
  if (school() !== 'edupage') throw bad('Das geht nur mit EduPage.');
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
  if (!place || isDemo() || (!force && cached?.lat === place.lat && cached?.lon === place.lon && Date.now() - cached.at < 3600e3)) return;
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
  if (isDemo()) return demo.trips(time, mode);
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
  const key = `${home()}|${dir}|${date}|${time}`, hit = tripCache.get(key);
  if (hit && Date.now() - hit.at < 60e3) return hit.list;
  const list = await trips(from, to, date, time, mode);
  if (tripCache.size > 50) tripCache.clear();
  tripCache.set(key, { at: Date.now(), list });
  return list;
}

// Erste und letzte Stunde eines Tages (ohne Entfall und Ganztägiges)
function schoolTimes(date) {
  const ls = (snapNow()?.days.find((d) => d.date === date)?.lessons || []).filter((l) => !l.cancelled && !l.allday && l.start && l.end);
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

// Ohne Schulsoftware: Stundenplan aus den selbst eingetragenen Stunden, jede Woche gleich, in den Ferien frei
function ownSnapshot(from = new Date()) {
  const own = db().lessons.slice().sort((a, b) => a.start.localeCompare(b.start)), off = load('holidays.json', null)?.list || [];
  const bells = [...new Map(own.map((l) => [l.start, l.end])).entries()].map(([start, end], i) => ({ name: String(i + 1), start, end }));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i), date = isoDay(d), free = off.some((h) => h.start <= date && date <= h.end);
    const lessons = free ? [] : own.filter((l) => l.day === d.getDay()).map((l) => ({
      period: bells.findIndex((b) => b.start === l.start) + 1, start: l.start, end: l.end, subject: l.subject, short: l.subject.slice(0, 2),
      teachers: l.teacher ? [l.teacher] : [], rooms: l.room ? [l.room] : [], groups: [], topic: null, cancelled: false, event: false, online: null, changes: [] }));
    if (lessons.length || (d.getDay() >= 1 && d.getDay() <= 5)) days.push({ date, lessons, changes: [] });
  }
  return { v: SNAPSHOT_VERSION, updated: new Date().toISOString(), student: { name: me()?.name || '', class: '' }, days, tasks: [], messages: [], missing: [], bells, people: [], errors: [] };
}
const snapNow = () => (me()?.demo ? demo.snapshot() : school() === 'none' ? ownSnapshot() : load('snapshot.json', null));

// Private Kalender (Pro): Google/iCloud/Outlook per iCalendar-Link lesen. Link verschlüsselt, Termine (−2 Wochen bis +4 Monate)
// im Zwischenspeicher, alle 30 Min. im Hintergrund neu. Nicht in Demo-Konten (die teilen sich alle Besucher).
const calsOn = () => !isDemo() && has('calendars');
const CAL_COLORS = ['orange', 'green', 'purple', 'teal', 'pink'];
const calList = () => load('calendars.json', []);
const calCache = () => load('calendars-cache.json', {});
async function refreshCal(c) {
  let entry;
  try {
    const now = new Date(), events = Ical.expand(Ical.parseIcs(await Ical.fetchIcs(unseal(c.url))), isoDay(addDays(now, -14)), isoDay(addDays(now, 120)));
    entry = { at: now.toISOString(), events, error: null };
  } catch (e) { entry = { ...calCache()[c.id], at: new Date().toISOString(), error: e.message || 'Fehler beim Abrufen' }; }
  save('calendars-cache.json', { ...calCache(), [c.id]: entry });
  return entry;
}
const calBusy = new Set();
function refreshCals() { // beim Öffnen der App, höchstens alle 30 Min. je Kalender, ohne darauf zu warten
  if (!calsOn() || calBusy.has(home())) return;
  const cache = calCache(), due = calList().filter((c) => !cache[c.id] || Date.now() - Date.parse(cache[c.id].at) > 30 * 60e3);
  if (!due.length) return;
  const key = home();
  calBusy.add(key);
  (async () => { for (const c of due) await refreshCal(c); })().catch(() => {}).finally(() => calBusy.delete(key));
}
function calPayload() {
  if (!calsOn()) return { calendars: [], ical: [] };
  const cache = calCache(), list = calList();
  return {
    calendars: list.map((c) => ({ id: c.id, name: c.name, color: c.color, at: cache[c.id]?.at || null, error: cache[c.id]?.error || null, count: cache[c.id]?.events?.length || 0 })),
    ical: list.flatMap((c) => (cache[c.id]?.events || []).map((e, i) => ({ ...e, id: `${c.id}-${i}`, cal: c.id }))),
  };
}

// Kalender-Abo (Pro): Stundenplan, Prüfungen, eigene Termine und Geburtstage als iCalendar (RFC 5545)
// shortcut: Zeiten ohne Zeitzone (floating + X-WR-TIMEZONE Europe/Berlin), passt für Nutzer in Deutschland; für andere Zeitzonen VTIMEZONE ergänzen.
// shortcut: Stunden nur für die Tage im Abgleich (EduPage/WebUntis/Schulmanager: heute + 6), vergangene fallen raus; bei Bedarf Tage sammeln.
const RRULE = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY' };
function icsFeed(now = new Date()) {
  const esc = (v) => String(v || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
  const d8 = (date) => date.replace(/-/g, ''), uid = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 24);
  const stamp = now.toISOString().replace(/[-:]|\.\d+/g, '');
  const allDay = (date) => [`DTSTART;VALUE=DATE:${d8(date)}`, `DTEND;VALUE=DATE:${d8(isoDay(addDays(new Date(`${date}T12:00`), 1)))}`];
  const timed = (date, start, end) => [`DTSTART:${d8(date)}T${start.replace(':', '')}00`, end ? `DTEND:${d8(date)}T${end.replace(':', '')}00` : 'DURATION:PT1H'];
  const out = [];
  const ev = (id, start, end, summary, extra = []) => out.push('BEGIN:VEVENT', `UID:${uid(id)}@alltag`, `DTSTAMP:${stamp}`, start, end, `SUMMARY:${esc(summary)}`, ...extra.filter(Boolean), 'END:VEVENT');
  const own = isDemo() || school() === 'none'; // eigener Stundenplan bzw. Demo: gleich vier Wochen
  const days = new Map((own ? [0, 7, 14, 21].flatMap((n) => (isDemo() ? demo.snapshot(addDays(now, n)) : ownSnapshot(addDays(now, n))).days) : snapNow()?.days || []).map((d) => [d.date, d]));
  for (const day of days.values()) for (const l of day.lessons || []) {
    ev(`stunde|${day.date}|${l.start}|${l.subject}`, ...(l.start && l.end ? timed(day.date, l.start, l.end) : allDay(day.date)), `${l.cancelled ? 'Entfällt: ' : ''}${l.subject}`,
      [l.rooms?.length && `LOCATION:${esc(l.rooms.join(', '))}`, `DESCRIPTION:${esc([l.teachers?.join(', '), ...(l.changes || []), l.topic].filter(Boolean).join('\n'))}`]);
  }
  for (const t of snapNow()?.tasks || []) if (t.kind === 'exam' && t.due) ev(`pruefung|${t.id}`, ...allDay(t.due), [t.label, t.subject].filter(Boolean).join(' '), [t.title && `DESCRIPTION:${esc(t.title)}`]);
  const d = db();
  for (const e of d.events) {
    const until = e.until ? `;UNTIL=${d8(e.until)}${e.start ? 'T235959' : ''}` : '';
    ev(`termin|${e.id}`, ...(e.start ? timed(e.date, e.start, e.end) : allDay(e.date)), e.title,
      [e.location && `LOCATION:${esc(e.location)}`, e.notes && `DESCRIPTION:${esc(e.notes)}`, RRULE[e.repeat] && `RRULE:${RRULE[e.repeat]}${until}`]);
  }
  for (const b of d.birthdays) { // 29.2. = letzter Februartag, wie birthdayOn in recur.js
    const y = Number(b.date.slice(0, 4)), md = b.date.slice(5);
    ev(`geburtstag|${b.id}`, ...allDay(`${y > 1900 ? y : 2000}-${md}`), `Geburtstag: ${b.name}`, [`RRULE:FREQ=YEARLY${md === '02-29' ? ';BYMONTH=2;BYMONTHDAY=-1' : ''}`]);
  }
  const fold = (line) => { // höchstens 75 Byte je Zeile, Fortsetzung beginnt mit Leerzeichen
    const parts = []; let cur = '';
    for (const ch of line) { if (Buffer.byteLength(cur + ch) > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; } cur += ch; }
    return [...parts, cur].join('\r\n ');
  };
  return `${['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alltag//Kalender-Abo//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Alltag', 'X-WR-TIMEZONE:Europe/Berlin',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...out, 'END:VCALENDAR'].map(fold).join('\r\n')}\r\n`;
}

// WebUntis und Schulmanager: gleiche Form wie der EduPage-Snapshot, damit Mitteilungen, Lernplan und Ansichten gleich bleiben
const LINKS = { untis: Untis, schulmanager: Schulmanager };
const linkClient = (cfg) => new LINKS[school()]({ ...cfg, pass: unseal(cfg.pass) }, loadSession());
async function linkSnapshot(cfg, now = new Date()) {
  const c = linkClient(cfg), errors = [], today = isoDay(now), until = isoDay(addDays(now, 28));
  const part = async (label, fn, fallback) => {
    try { return await fn(); } catch (e) { if (e.code) throw e; errors.push(`${label}: ${e.message}`); return fallback; }
  };
  const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(now, i)).filter((d) => d.getDay() % 6).map(isoDay);
  try {
    const plan = await c.lessons(dates[0], dates.at(-1)); // ohne Stundenplan kein neuer Stand, der alte bleibt
    const days = dates.map((d) => schoolDay(d, plan.get(d) || []));
    const tasks = [...await part('Hausaufgaben', () => c.homework(today, until), []), ...await part('Prüfungen', () => c.exams(today, until), [])];
    for (const t of tasks) { // Schulmanager: fällig in der nächsten Stunde des Fachs
      t.due ||= days.find((d) => d.date > t.created.slice(0, 10) && d.lessons.some((l) => !l.cancelled && (l.subject === t.subject || l.short === t.subject)))?.date || null;
    }
    return {
      v: SNAPSHOT_VERSION, updated: new Date().toISOString(), student: await part('Name', () => c.student(), { name: '', class: '' }),
      days, tasks, missing: [], people: [], bells: await part('Klingelzeiten', () => c.bells(), []),
      messages: (await part('Mitteilungen', () => c.messages(today), [])).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 100), errors,
    };
  } finally { saveSession(c.session); }
}
async function linkWeek(cfg, dates, known) {
  const c = linkClient(cfg);
  try {
    const plan = await c.lessons(dates[0], dates.at(-1));
    return dates.map((d) => known.find((x) => x.date === d) || schoolDay(d, plan.get(d) || []));
  } catch (e) { throw e.status ? e : bad(e.message); } finally { saveSession(c.session); }
}

async function syncEdupage() {
  if (isDemo()) { const s = demo.snapshot(); save('snapshot.json', s); return s; }
  if (school() === 'none') return ownSnapshot();
  const cfg = load('config.json', {})[school()];
  if (!cfg) return null;
  const status = load('status.json', {});
  if (status.blockedUntil > Date.now()) return load('snapshot.json', null); // nach Captcha eine Stunde Ruhe
  try {
    const s = school() === 'edupage' ? await snapshot(await connect(cfg), { school: cfg.school, prev: load('snapshot.json', null) }) : await linkSnapshot(cfg);
    if (s.sample) { save('edupage-muster.json', s.sample); delete s.sample; } // Aufbau der Einträge (für den Nachbau von Umfragen), nicht für die App
    save('snapshot.json', s);
    save('status.json', { ok: true, at: s.updated, error: null });
    s.errors.forEach((e) => console.warn('Teilfehler:', e));
    return s;
  } catch (e) {
    // Captcha: 1 h Pause; falsches Passwort: nicht weiter probieren, bis es in der App neu eingetragen wird
    const pause = { captcha: 3600e3, credentials: 365 * 864e5, twofactor: 365 * 864e5 }[e.code] || 0;
    save('status.json', { ok: false, at: new Date().toISOString(), error: e.message, blockedUntil: pause && Date.now() + pause });
    if (e.code) saveSession({});
    console.error(`${SCHOOL_NAMES[school()]}-Abgleich fehlgeschlagen:`, e.message);
    return load('snapshot.json', null);
  }
}

const runs = new Map(); // laufender Abgleich je Datenordner (= je Konto)
function sync(minAgeMs) {
  const key = home();
  if (runs.has(key)) return runs.get(key);
  if (Date.now() - load('lastrun.json', 0) < minAgeMs) return Promise.resolve();
  const run = (async () => {
    save('lastrun.json', Date.now());
    await refreshHolidays();
    await refreshWeather();
    await notify(await syncEdupage());
  })().catch((e) => console.error('Abgleich:', e)).finally(() => { runs.delete(key); });
  runs.set(key, run);
  return run;
}
// Läuft der Prozess dauerhaft, gleicht er selbst ab; unter Plesk weckt ihn zusätzlich die geplante Aufgabe (/api/cron)
setInterval(() => { const h = new Date().getHours(); eachUser(() => sync(h >= 5 && h < 22 ? 14 * 60e3 : 55 * 60e3)); }, 5 * 60e3);

// Plesk/Passenger beendet die App nach einigen Minuten ohne Aufruf – dann gäbe es keinen Abgleich und keine Mitteilungen.
// Ohne geplante Aufgabe hält sie sich deshalb selbst wach: alle 2 Minuten ein Aufruf der eigenen Adresse.
// Die Adresse stammt nur aus angemeldeten Aufrufen, damit kein fremder Host-Header sie umlenken kann.
setInterval(() => {
  const origin = atRoot(() => load('origin.json', null));
  if (origin) fetch(`${origin}/api/ping`, { signal: AbortSignal.timeout(10000) }).catch(() => {});
}, 2 * 60e3);
setInterval(() => eachUser(() => { if (!runs.has(home())) return notify(snapNow()).catch((e) => console.error('Mitteilungen:', e)); }), 60e3);
// nach einem Update mit neuer Auswertung sofort neu abgleichen, sonst nur wenn der letzte Abgleich älter als 10 Min. ist
setTimeout(() => eachUser(() => sync(snapNow()?.v === SNAPSHOT_VERSION ? 10 * 60e3 : 0)), 3000);
// Öffentliche Demo (Instanz oder Demo-Konto): nach 15 Minuten ohne Besuch wieder auf die Beispieldaten zurücksetzen
const demoUse = new Map(); // Datenordner → { at, dirty }
function demoTouch(req) {
  const u = demoUse.get(home()) || { at: 0, dirty: false };
  u.at = Date.now();
  if (req.method !== 'GET') u.dirty = true;
  demoUse.set(home(), u);
}
function demoReset() {
  save('db.json', demo.db());
  for (const n of ['state.json', 'config.json', 'snapshot.json', 'session.json', 'status.json']) fs.rmSync(file(n), { force: true });
  fs.rmSync(path.join(home(), 'photos'), { recursive: true, force: true });
  demoUse.delete(home());
}
setInterval(() => eachUser(() => {
  const u = demoUse.get(home());
  if (limited() && u?.dirty && Date.now() - u.at > 15 * 60e3) demoReset();
}), 60e3);

/* ------------------------------------------------------------------ API */
function settings() {
  const c = load('config.json', {});
  return { state: c.state || 'BY', lessonPush: !!c.lessonPush, place: c.place || null, stops: c.stops || {}, wakeLead: c.wakeLead ?? 60, ticket: c.ticket || null,
    ha: c.ha ? { connected: true, url: c.ha.url, todo: c.ha.todo || '', pc: c.ha.pc || [] } : { connected: false } }; // Token bleibt auf dem Server
}
function payload() {
  const st = state(), snap = snapNow(), cfg = load('config.json', {})[school()];
  return {
    app: APP, demo: isDemo(), status: load('status.json', {}),
    features: { ha: PRIVATE, screen: PRIVATE, accounts: ACCOUNTS, photos: !limited() && has('photos'), calendar: !limited() && has('calendar'), wallpaper: !limited() && has('wallpaper'), calendars: calsOn(), push: !limited() }, accountsUrl: ACCOUNTS ? ACCOUNTS_URL : '',
    beta: ACCOUNTS && !limited() ? { feedback: true, umfrage: !!siteSettings().umfrage && !st.umfrage } : null,
    account: me() && pubAccount(me()), school: school(),
    ...settings(), holidays: load('holidays.json', null)?.list || [],
    weather: isDemo() ? demo.weather() : load('weather.json', null)?.hours || [],
    timer: st.timer || null,
    // Verbindung zur Schulsoftware des Kontos (EduPage, WebUntis oder Schulmanager), ohne Passwort
    link: isDemo() ? { connected: true, school: 'demo', user: 'demo' } : cfg && school() !== 'none' ? { connected: true, school: cfg.school || '', name: cfg.name || '', server: cfg.server || '', user: cfg.user } : { connected: false },
    snap: snap && {
      ...snap,
      tasks: [...snap.tasks.map((t) => ({ ...t, done: st.done[t.id] ?? t.done })), ...study(snap, st.done)],
      messages: (snap.messages || []).map((m) => {
        const liked = st.liked?.[m.id] ?? m.liked;
        return { ...m, starred: st.starred?.[m.id] ?? m.starred, confirmed: m.confirmed || st.confirmed?.[m.id] || null,
          liked, likes: Math.max(0, (m.likes || 0) + (liked === !!m.liked ? 0 : liked ? 1 : -1)),
          poll: m.poll && st.votes?.[m.id] ? { ...m.poll, mine: m.poll.answers.filter((a) => st.votes[m.id][a.id] ?? m.poll.mine.includes(a.id)).map((a) => a.id) } : m.poll };
      }),
    },
    db: db(), ...calPayload(),
    plans: ACCOUNTS && !isDemo() && (plansVisible() || me()?.admin) ? { list: PLANS, features: FEATURES, soon: SOON, current: planOf(me()), preview: !plansVisible() } : null,
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
  const buf = await readImage(req, 8e6);
  Object.assign(screen, { agentAt: Date.now(), n: Math.min(9, Math.max(1, Math.trunc(Number(q.get('n')) || 1))), s: Math.trunc(Number(q.get('s')) || 0), locked: q.get('locked') === '1' });
  if (buf.length) {
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
  // private App: ein Passwort. Mit Konten meldet man sich beim Konto-Dienst an (siehe /auth/callback).
  'POST /api/login': async (req, res) => {
    if (ACCOUNTS) return send(res, 404, { error: 'Anmelden geht über die Konto-Seite.' });
    const { password } = await readJson(req), ip = `ip:${clientIp(req)}`;
    if (throttled(ip)) return send(res, 429, TOO_MANY);
    if (!same(password ?? '', PASSWORD)) return fail(res, 401, 'Falsches Passwort', ip);
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, 365 * 86400) });
  },
  'POST /api/logout': (req, res) => send(res, 200, { ok: true, accountsUrl: ACCOUNTS ? ACCOUNTS_URL : '' }, { 'Set-Cookie': sessionCookie(req, 0) }),
  // Demo ansehen ohne Passwort (Knopf auf der Startseite, QR-Code mit #demo)
  'POST /api/demo': (req, res) => {
    const a = ACCOUNTS && demoAccount();
    if (!a) return send(res, 404, { error: 'Gerade gibt es keine Demo.' });
    trackCount('demo');
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, 7 * 86400, a) });
  },
  // Eigenes Konto: hier nur die Schulsoftware. E-Mail, Passwort, Geräte und Löschen gibt es auf der Konto-Seite.
  'POST /api/account': async (req, res) => {
    const b = await readJson(req), a = me();
    if (!a) return send(res, 404, { error: 'unbekannt' });
    if (a.demo) throw bad('Im Demo-Konto lässt sich das nicht ändern.');
    if (b.school !== undefined && b.school !== a.school) {
      if (!SCHOOLS.includes(b.school)) throw bad('Unbekannte Schulsoftware');
      const { account } = await accountsApi(`/api/accounts/${a.id}`, 'PATCH', { school: b.school });
      keepAccount(account);
      for (const n of ['snapshot.json', 'session.json', 'status.json']) fs.rmSync(file(n), { force: true }); // Stand der alten Schulsoftware gilt nicht mehr
      const st = state(); st.eduSeeded = false; save('state.json', st);
      return send(res, 200, asUser(account, payload));
    }
    send(res, 200, payload());
  },
  // Admin: Einladungscodes und Konten verwalten. Gespeichert wird beides beim Konto-Dienst.
  'GET /api/admin': async (req, res) => { admin(); send(res, 200, { ...await adminData(), stats: statsData() }); },
  'GET /api/admin/health': async (req, res) => { // Konto-Dienst erreichbar? Mailversand eingerichtet?
    admin();
    const app = { node: process.version, since: new Date(Date.now() - process.uptime() * 1000).toISOString(), memory: Math.round(process.memoryUsage().rss / 1e6) }; // Passenger startet nach Leerlauf neu
    try { send(res, 200, { ok: true, app, ...await accountsApi('/api/health') }); } catch (e) { send(res, 200, { ok: false, app, error: e.message }); }
  },
  // Anmelden mit Alltag: Apps liegen beim Konto-Dienst; den Schlüssel gibt es nur in der Antwort beim Anlegen bzw. Erneuern
  'GET /api/admin/clients': async (req, res) => { admin(); send(res, 200, await accountsApi('/api/clients')); },
  'POST /api/admin/clients': async (req, res) => { admin(); const b = await readJson(req); send(res, 200, await accountsApi('/api/clients', 'POST', { name: b.name, redirects: b.redirects })); },
  'POST /api/admin/clients/:id': async (req, res, id) => {
    admin();
    const b = await readJson(req);
    send(res, 200, await accountsApi(`/api/clients/${encodeURIComponent(id)}`, 'PATCH', Object.fromEntries(['name', 'redirects', 'disabled', 'newSecret'].filter((k) => k in b).map((k) => [k, b[k]]))));
  },
  'DELETE /api/admin/clients/:id': async (req, res, id) => { admin(); send(res, 200, await accountsApi(`/api/clients/${encodeURIComponent(id)}`, 'DELETE')); },
  'POST /api/admin/invites': async (req, res) => {
    admin();
    const b = await readJson(req);
    const r = await accountsApi('/api/invites', 'POST', { note: F.text(80)(b.note), days: Number(b.days) || 0, uses: Number(b.uses) || 0, count: Number(b.count) || 1,
      forever: b.days === 'unbegrenzt', unlimited: b.uses === 'unbegrenzt' });
    send(res, 200, await adminData({ invites: r.invites, created: r.created }));
  },
  'DELETE /api/admin/invites/:code': async (req, res, code) => {
    admin();
    send(res, 200, await adminData({ invites: (await accountsApi(`/api/invites/${encodeURIComponent(code)}`, 'DELETE')).invites }));
  },
  'POST /api/admin/accounts/:id': async (req, res, id) => {
    admin();
    const b = await readJson(req), a = accounts().find((x) => x.id === id);
    if (!a) return send(res, 404, { error: 'nicht gefunden' });
    if (a.id === me().id && (b.disabled || b.admin === false)) throw bad('Dein eigenes Konto kannst du hier nicht sperren oder herabstufen.');
    if (b.resetDemo === true) { // Beispieldaten liegen in der App
      if (!a.demo) throw bad('Nur Demo-Konten lassen sich zurücksetzen.');
      asUser(a, demoReset);
      return send(res, 200, await adminData());
    }
    const patch = Object.fromEntries(['reset', 'disabled', 'admin', 'demo', 'jury', 'pro'].filter((k) => typeof b[k] === 'boolean').map((k) => [k, b[k]]));
    if (PLANS[b.plan]) patch.plan = b.plan;
    const r = await accountsApi(`/api/accounts/${id}`, 'PATCH', patch);
    if (typeof b.demo === 'boolean' && b.demo !== !!a.demo) { // Demo an: Beispieldaten statt eigener Daten. Demo aus: Konto ist danach leer.
      fs.rmSync(userDir(a.id), { recursive: true, force: true });
      fs.mkdirSync(userDir(a.id), { recursive: true, mode: 0o700 });
      if (b.demo) asUser(r.account, demoReset);
    }
    keepAccount(r.account);
    send(res, 200, await adminData({ password: r.password })); // neues Passwort nur in dieser einen Antwort
  },
  'DELETE /api/admin/accounts/:id': async (req, res, id) => {
    admin();
    const a = accounts().find((x) => x.id === id);
    if (!a) return send(res, 404, { error: 'nicht gefunden' });
    if (a.id === me().id) throw bad('Dein eigenes Konto löschst du auf der Konto-Seite.');
    await accountsApi(`/api/accounts/${id}`, 'DELETE');
    fs.rmSync(userDir(a.id), { recursive: true, force: true });
    await refreshAccounts();
    send(res, 200, await adminData());
  },

  // Beta-Test (statt Google Forms): Anmeldung auf /beta, Rückmeldungen und Abschlussumfrage in der App
  'POST /api/beta': async (req, res) => { // öffentlich, ohne Anmeldung
    if (!ACCOUNTS) return send(res, 404, { error: 'unbekannt' });
    const key = `beta:${clientIp(req)}`;
    if (throttled(key)) return send(res, 429, TOO_MANY);
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true, id: 'BETA-0000' }); // Feld nur für Bots sichtbar
    const { values, error } = Formulare.check('beta', b);
    if (error) throw bad(error);
    tries.set(key, [...(tries.get(key) || []), Date.now()]); // höchstens 10 Anmeldungen je Gerät in 15 Minuten
    const list = betaList();
    if (list.length >= 3000) throw bad('Die Anmeldung ist gerade voll. Bitte versuch es später noch einmal.');
    const email = values.email.toLowerCase(), old = list.find((x) => x.email.toLowerCase() === email);
    if (old) return send(res, 200, { ok: true, id: old.id, again: true });
    const n = Math.max(0, ...list.map((x) => Number(x.id.slice(5)) || 0)) + 1;
    const item = { id: `BETA-${String(n).padStart(4, '0')}`, at: new Date().toISOString(), ...values, email, status: 'neu', code: null, invitedAt: null };
    atRoot(() => save('beta.json', [...list, item]));
    tellAdmins({ title: 'Neue Beta-Anmeldung', body: `${item.vorname} ${item.nachname} (${item.id})`, url: '/admin', tag: 'beta' });
    send(res, 200, { ok: true, id: item.id });
  },
  'GET /api/admin/beta': (req, res) => { admin(); send(res, 200, { list: betaList().slice().reverse() }); },
  'POST /api/admin/beta/:id/invite': async (req, res, id) => { // Einladungscode erstellen und per Mail schicken (Konto-Dienst)
    admin();
    const list = betaList(), x = list.find((y) => y.id === id);
    if (!x) return send(res, 404, { error: 'nicht gefunden' });
    const r = await accountsApi('/api/invites', 'POST', { note: `${x.id} ${x.vorname} ${x.nachname}`.slice(0, 80), days: 30, email: x.email, name: x.vorname, betaId: x.id });
    Object.assign(x, { status: 'eingeladen', code: r.created?.[0] || null, invitedAt: new Date().toISOString(), mailed: !!r.mailed });
    atRoot(() => save('beta.json', list));
    send(res, 200, { list: list.slice().reverse(), invites: r.invites });
  },
  'DELETE /api/admin/beta/:id': (req, res, id) => {
    admin();
    atRoot(() => save('beta.json', betaList().filter((x) => x.id !== id)));
    send(res, 200, { list: betaList().slice().reverse() });
  },
  // Rückmeldung: Bildschirmfoto zuerst (wie Tafelbilder als Formular-Datei mit Base64), dann der Text
  'POST /api/feedback/shot': async (req, res) => {
    if (limited()) throw bad('In der Demo geht das nicht.');
    const buf = await readImage(req, 8e6);
    if (!buf.length) throw bad('Bitte ein Bild (JPEG) senden');
    const shot = crypto.randomUUID();
    atRoot(() => { fs.mkdirSync(file('feedback'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(file('feedback'), `${me()?.id || 'app'}--${shot}.jpg`), buf, { mode: 0o600 }); });
    send(res, 200, { shot });
  },
  'POST /api/feedback': async (req, res) => {
    if (limited()) throw bad('In der Demo geht das nicht.');
    const b = await readJson(req), a = me(), { values, error } = Formulare.check('feedback', b);
    if (error) throw bad(error);
    const mine = feedbackList().filter((x) => x.account?.id === (a?.id || null) && Date.now() - Date.parse(x.at) < 864e5);
    if (mine.length >= 20) throw bad('Du hast heute schon 20 Rückmeldungen geschickt. Danke! Morgen geht es weiter.');
    const shot = /^[0-9a-f-]{36}$/.test(String(b.shot || '')) && atRoot(() => fs.existsSync(path.join(file('feedback'), `${a?.id || 'app'}--${b.shot}.jpg`))) ? `${a?.id || 'app'}--${b.shot}.jpg` : null;
    const invite = ACCOUNTS && a ? (await accountsApi('/api/invites').catch(() => ({ invites: [] }))).invites.find((i) => i.usedBy === a.id) : null;
    const item = {
      id: crypto.randomUUID(), at: new Date().toISOString(), ...values, status: 'neu', note: '', shot,
      account: a ? { id: a.id, name: a.name, support: supportId(a) } : null, betaId: (/BETA-\d{4}/.exec(invite?.note || '') || [null])[0],
      school: school(), version: F.text(40)(b.version), view: F.text(40)(b.view), device: F.text(300)(req.headers['user-agent']),
    };
    atRoot(() => save('feedback.json', [...feedbackList(), item].slice(-2000)));
    tellAdmins({ title: `${item.art}: ${item.titel}`, body: `${a?.name || 'App'}${item.betaId ? ` · ${item.betaId}` : ''}`, url: '/admin', tag: `fb-${item.id}` });
    send(res, 200, { ok: true });
  },
  'GET /api/admin/feedback': (req, res) => { admin(); send(res, 200, { list: feedbackList().slice().reverse() }); },
  'POST /api/admin/feedback/:id': async (req, res, id) => {
    admin();
    const b = await readJson(req), list = feedbackList(), x = list.find((y) => y.id === id);
    if (!x) return send(res, 404, { error: 'nicht gefunden' });
    if (['neu', 'in Arbeit', 'erledigt'].includes(b.status)) x.status = b.status;
    if (b.note !== undefined) x.note = F.text(1000)(b.note);
    atRoot(() => save('feedback.json', list));
    send(res, 200, { list: list.slice().reverse() });
  },
  'GET /api/admin/feedback/:id/shot': (req, res, id) => {
    admin();
    const x = feedbackList().find((y) => y.id === id);
    if (!x?.shot) return send(res, 404, { error: 'nicht gefunden' });
    atRoot(() => fs.readFile(path.join(file('feedback'), x.shot), (err, buf) => {
      if (err) return send(res, 404, { error: 'nicht gefunden' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(buf);
    }));
  },
  // Abschlussumfrage: wirklich anonym. Gespeichert wird die Antwort ohne Konto (nur der Tag), am Konto nur „beantwortet“.
  'POST /api/umfrage': async (req, res) => {
    if (limited() || !siteSettings().umfrage) throw bad('Die Umfrage ist gerade nicht geöffnet.');
    const st = state();
    if (st.umfrage) throw bad('Du hast schon mitgemacht. Danke!');
    const { values, error } = Formulare.check('umfrage', await readJson(req));
    if (error) throw bad(error);
    atRoot(() => save('umfrage.json', [...load('umfrage.json', []), { id: crypto.randomUUID(), day: isoDay(new Date()), ...values }].slice(-5000)));
    st.umfrage = true; save('state.json', st);
    send(res, 200, payload());
  },
  'POST /api/admin/legal': async (req, res) => { // Impressum-Angaben (z. B. Anschrift eines Impressum-Dienstes), gelten sofort
    admin();
    const b = await readJson(req);
    const l = { name: F.text(120, true)(b.name), address: F.text(300, true)(b.address).replace(/\r/g, '').replace(/\n{2,}/g, '\n'), email: F.text(120, true)(b.email), phone: F.text(40)(b.phone) };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) throw bad('Bitte eine gültige E-Mail-Adresse eintragen.');
    atRoot(() => save('site.json', { ...siteSettings(), legal: l }));
    send(res, 200, await adminData());
  },
  'POST /api/admin/plans': async (req, res) => { // Plan-Auswahl im Profil für alle zeigen (kaufen geht noch nicht)
    admin();
    const b = await readJson(req);
    atRoot(() => save('site.json', { ...siteSettings(), plansVisible: b.visible === true }));
    send(res, 200, await adminData());
  },
  'GET /api/admin/umfrage': (req, res) => { admin(); send(res, 200, { open: !!siteSettings().umfrage, answers: atRoot(() => load('umfrage.json', [])) }); },
  'POST /api/admin/umfrage': async (req, res) => {
    admin();
    const b = await readJson(req);
    atRoot(() => save('site.json', { ...siteSettings(), umfrage: b.open === true }));
    send(res, 200, { open: !!siteSettings().umfrage, answers: atRoot(() => load('umfrage.json', [])) });
  },
  'GET /api/data': (req, res) => {
    const origin = `${https(req) ? 'https' : 'http'}://${req.headers.host}`;
    if (loggedIn(req) && /^[\w.:-]+$/.test(req.headers.host || '') && atRoot(() => load('origin.json', null)) !== origin) atRoot(() => save('origin.json', origin));
    const a = me();
    refreshCals();
    if (a && !a.demo) trackActive(a);
    if (a && Date.now() - Date.parse(seenAt()[a.id] || 0) > 3600e3) { // „zuletzt aktiv“ für die Konten-Übersicht, höchstens stündlich schreiben
      atRoot(() => save('seen.json', { ...load('seen.json', {}), [a.id]: new Date().toISOString() }));
    }
    send(res, 200, payload());
  },
  'POST /api/refresh': async (req, res) => { await sync(60e3); send(res, 200, payload()); },

  'POST /api/tasks/:id': async (req, res, id) => {
    const { done } = await readJson(req);
    const st = state(); st.done[id] = done === true; save('state.json', st);
    // Hausaufgabe auch in EduPage abhaken (wie der Haken im EduPage-Webclient)
    const t = snapNow()?.tasks.find((x) => x.id === id);
    const synced = t?.tid && !isDemo() ? await edupageDo((ep) => ep.setProp(t.tid, 'done', done === true ? '1' : '0')).then(() => true, () => false) : false;
    send(res, 200, { ok: true, synced });
  },

  // Nachrichten – gehen an echte Lehrkräfte, die App fragt vorher nach
  'POST /api/messages': async (req, res) => {
    const { to, text } = await readJson(req);
    const known = new Set((snapNow()?.people || []).map((p) => p.id));
    const ids = [].concat(to || []).map(String).filter((x) => known.has(x));
    if (!ids.length || !String(text || '').trim()) throw bad('Bitte Empfänger und Text angeben.');
    if (isDemo()) return send(res, 200, { ...payload(), demo: true });
    await edupageDo((ep) => ep.sendMessage(ids.map((x) => `Ucitel${x}`), String(text).trim().slice(0, 5000)));
    await sync(0);
    send(res, 200, payload());
  },
  'POST /api/messages/:id/reply': async (req, res, id) => {
    const { text } = await readJson(req);
    if (!String(text || '').trim()) throw bad('Bitte einen Text eingeben.');
    if (!(snapNow()?.messages || []).some((m) => m.id === id)) throw bad('Nachricht nicht gefunden');
    if (isDemo()) return send(res, 200, { ...payload(), demo: true });
    await edupageDo((ep) => ep.reply(id, String(text).trim().slice(0, 5000)));
    await sync(0);
    send(res, 200, payload());
  },
  'POST /api/messages/:id/star': async (req, res, id) => {
    const { starred } = await readJson(req);
    const st = state(); st.starred = { ...st.starred, [id]: starred === true }; save('state.json', st);
    const synced = isDemo() ? false : await edupageDo((ep) => ep.setProp(id, 'starred', starred === true ? '1' : '0')).then(() => true, () => false);
    send(res, 200, { ok: true, synced });
  },

  'POST /api/messages/:id/like': async (req, res, id) => {
    const { liked } = await readJson(req);
    if (!isDemo()) await edupageDo((ep) => ep.confirm(id, 'like', liked === true ? '1' : '0'));
    const st = state(); st.liked = { ...st.liked, [id]: liked === true }; save('state.json', st);
    send(res, 200, { ok: true });
  },
  // Umfrage: eine Antwort an- oder abwählen (EduPage: Bestätigung vote<id> mit '1'/'0', wie im Webclient)
  'POST /api/messages/:id/vote': async (req, res, id) => {
    const { answer, on } = await readJson(req);
    const a = (snapNow()?.messages || []).find((m) => m.id === id)?.poll?.answers.find((x) => x.id === String(answer));
    if (!a) throw bad('Antwort nicht gefunden');
    if (!isDemo()) await edupageDo((ep) => ep.confirm(id, `vote${a.id}`, on === true ? '1' : '0'));
    const st = state(); st.votes = { ...st.votes, [id]: { ...st.votes?.[id], [a.id]: on === true } }; save('state.json', st);
    send(res, 200, { ok: true });
  },
  'POST /api/messages/:id/confirm': async (req, res, id) => {
    if (!isDemo()) await edupageDo((ep) => ep.confirm(id, 'receipt', ''));
    const st = state(); st.confirmed = { ...st.confirmed, [id]: new Date().toISOString() }; save('state.json', st);
    send(res, 200, { ok: true });
  },

  // Wo ist Lehrkraft X gerade? (Stundenplan der Lehrkraft für heute, 5 Minuten zwischengespeichert)
  'GET /api/teacher/:id': async (req, res, id) => {
    const date = isoDay(new Date()), key = `${home()}|${id}|${date}`, hit = teacherCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60e3) return send(res, 200, { date, lessons: hit.lessons, source: hit.source });
    let lessons, source = 'live';
    if (isDemo()) {
      const name = (snapNow()?.people || []).find((p) => p.id === id)?.name;
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
    const known = snapNow()?.days || [], hit = weekCache.get(`${home()}|${start}`);
    if (isDemo()) return send(res, 200, { days: demo.snapshot(new Date(`${start}T08:00`)).days });
    if (school() === 'none') { const own = ownSnapshot(new Date(`${start}T08:00`)).days; return send(res, 200, { days: dates.map((d) => own.find((x) => x.date === d)) }); }
    if (dates.every((d) => known.some((x) => x.date === d))) return send(res, 200, { days: dates.map((d) => known.find((x) => x.date === d)) });
    if (hit && Date.now() - hit.at < 10 * 60e3) return send(res, 200, { days: hit.days });
    const cfg = load('config.json', {})[school()];
    if (!cfg) return send(res, 200, { days: [] });
    const days = LINKS[school()] ? await linkWeek(cfg, dates, known) : await edupageDo(async (ep) => {
      const out = [];
      for (const d of dates) out.push(known.find((x) => x.date === d) || schoolDay(d, await ep.plan(d).then((p) => ep.lessons(p), () => [])));
      return out;
    });
    weekCache.set(`${home()}|${start}`, { at: Date.now(), days });
    send(res, 200, { days });
  },
  'GET /api/summary': (req, res) => send(res, 200, summary(new URL(req.url, 'http://x').searchParams.get('day'))),

  'POST /api/items/:kind': async (req, res, kind) => {
    if (!KINDS[kind]) return send(res, 404, { error: 'unbekannt' });
    if (kind === 'photos') throw bad('Fotos bitte über /api/photos hochladen');
    const item = { id: crypto.randomUUID(), ...clean(kind, await readJson(req)), updated: new Date().toISOString() };
    const d = db();
    if (d[kind].length >= (kind === 'lessons' ? 100 : 5000)) throw bad('Hier sind schon zu viele Einträge.');
    d[kind].push(item); save('db.json', d);
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
    if (kind === 'photos' && d.photos.some((x) => x.id === id)) fs.rmSync(path.join(photoDir(), `${id}.jpg`), { force: true }); // id stammt vom Server
    d[kind] = d[kind].filter((x) => x.id !== id); save('db.json', d);
    send(res, 200, { ok: true });
  },

  'POST /api/edupage': async (req, res) => {
    if (isDemo()) return send(res, 400, { error: 'Im Demo-Modus nicht möglich' });
    if (school() !== 'edupage') throw bad('Dein Konto ist auf eine andere Schulsoftware eingestellt.');
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
      saveSession(Object.fromEntries(ep.cookies));
    } catch (e) {
      return send(res, 400, { error: e instanceof EduError ? e.message : `EduPage nicht erreichbar (${e.message})` });
    }
    save('config.json', { ...load('config.json', {}), edupage: { ...cfg, pass: seal(cfg.pass) } });
    save('status.json', {});
    const st = state(); st.eduSeeded = false; save('state.json', st); // neues Konto: Bestand nicht als neu melden
    await sync(0);
    send(res, 200, payload());
  },
  // WebUntis und Schulmanager verbinden: erst anmelden, nur bei Erfolg den Zugang (verschlüsselt) speichern
  'POST /api/link': async (req, res) => {
    if (isDemo()) return send(res, 400, { error: 'Im Demo-Modus nicht möglich' });
    const kind = school(), Link = LINKS[kind];
    if (!Link) throw bad('Dein Konto ist auf eine andere Schulsoftware eingestellt.');
    const b = await readJson(req), cfg = { user: String(b.user || '').trim().slice(0, 200), pass: String(b.pass || '') };
    if (kind === 'untis') Object.assign(cfg, { server: String(b.server || '').trim().toLowerCase(), school: String(b.school || '').trim().slice(0, 100), name: F.text(160, true)(b.name) });
    if (kind === 'untis' && (!SERVER_RE.test(cfg.server) || !cfg.school)) throw bad('Bitte such zuerst deine Schule und wähl sie aus.');
    if (!cfg.user || !cfg.pass) throw bad('Bitte Benutzername und Passwort angeben.');
    try {
      const c = new Link(cfg);
      await c.login();
      saveSession(c.session);
    } catch (e) {
      return send(res, 400, { error: e.code ? e.message : `${SCHOOL_NAMES[kind]} nicht erreichbar (${e.message})` });
    }
    save('config.json', { ...load('config.json', {}), [kind]: { ...cfg, pass: seal(cfg.pass) } });
    save('status.json', {});
    const st = state(); st.eduSeeded = false; save('state.json', st); // neuer Zugang: Bestand nicht als neu melden
    await sync(0);
    send(res, 200, payload());
  },
  'GET /api/untis/schools': async (req, res) => {
    const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
    if (q.length < 3 || q.length > 80) throw bad('Bitte mindestens 3 Zeichen eingeben.');
    try { send(res, 200, { schools: await searchSchools(q) }); } catch (e) { throw bad(e instanceof UntisError ? e.message : 'Die Schulsuche von WebUntis antwortet gerade nicht.'); }
  },
  'DELETE /api/link': (req, res) => {
    const c = load('config.json', {}); delete c[school()]; save('config.json', c);
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
  // Tafelbilder: Bild als Formular-Datei (Base64, siehe readImage), Angaben in der Adresse
  'POST /api/photos': async (req, res) => {
    if (limited()) throw bad('In der Demo kannst du keine Fotos hochladen.');
    if (!has('photos')) throw bad('Tafelbilder gibt es mit Alltag Pro.');
    if (ACCOUNTS && db().photos.length >= 300) throw bad('Du hast schon 300 Tafelbilder. Lösch ein paar alte, dann ist wieder Platz.');
    const u = new URL(req.url, 'http://x').searchParams, buf = await readImage(req, 11e6);
    if (!buf.length) throw bad('Bitte ein Foto (JPEG) senden');
    const item = { id: crypto.randomUUID(), ...clean('photos', { subject: u.get('subject'), date: u.get('date'), caption: u.get('caption') }), updated: new Date().toISOString() };
    fs.writeFileSync(path.join(photoDir(), `${item.id}.jpg`), buf, { mode: 0o600 });
    const d = db(); d.photos.push(item); save('db.json', d);
    send(res, 200, item);
  },
  'GET /api/photos/:id': (req, res, id) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return send(res, 404, { error: 'nicht gefunden' });
    fs.readFile(path.join(photoDir(), `${id}.jpg`), (err, buf) => {
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
    if (limited()) throw bad('In der Demo gibt es keine Mitteilungen.');
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
  // Lese-Schlüssel fürs Widget und fürs Kalender-Abo gibt es je Konto; Cron nur für Admin bzw. die private App, PC-Schlüssel nur privat
  'POST /api/tokens/:kind': (req, res, kind) => {
    if (!['widget', 'calendar'].includes(kind)) return send(res, 404, { error: 'unbekannt' });
    if (me()?.demo) throw bad('Im Demo-Konto lässt sich das nicht ändern.');
    const t = userTokens(); t[kind] = token(); save('tokens.json', t);
    send(res, 200, { ok: true });
  },
  'GET /api/tokens': (req, res) => send(res, 200, { widget: userTokens().widget, ...(!limited() && has('calendar') ? { calendar: userTokens().calendar } : {}),
    ...(!ACCOUNTS || me()?.admin ? { cron: TOKENS.cron } : {}), ...(PRIVATE ? { screen: TOKENS.screen } : {}) }),
  'POST /api/calendars': async (req, res) => { // gleich einmal abrufen: ein falscher Link fällt sofort auf
    if (!calsOn()) throw bad('Private Kalender gibt es mit Alltag Pro.');
    const b = await readJson(req), list = calList();
    if (list.length >= 5) throw bad('Du kannst höchstens 5 Kalender verbinden.');
    const c = { id: crypto.randomBytes(4).toString('hex'), name: F.text(40, true)(b.name), url: seal(F.text(2000, true)(b.url)), color: CAL_COLORS[list.length % CAL_COLORS.length], added: new Date().toISOString() };
    const r = await refreshCal(c);
    if (r.error) { const cc = calCache(); delete cc[c.id]; save('calendars-cache.json', cc); throw bad(r.error); }
    save('calendars.json', [...calList(), c]);
    send(res, 200, payload());
  },
  'DELETE /api/calendars/:id': (req, res, id) => {
    if (!calsOn()) throw bad('Private Kalender gibt es mit Alltag Pro.');
    save('calendars.json', calList().filter((c) => c.id !== id));
    const cc = calCache(); delete cc[id]; save('calendars-cache.json', cc);
    send(res, 200, payload());
  },
  'GET /api/calendar.ics': (req, res) => { // Kalender-Abo, gelesen mit dem Kalender-Schlüssel (?key=)
    if (limited() || !has('calendar')) return send(res, 404, { error: 'unbekannt' });
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-cache', 'Content-Disposition': 'inline; filename="alltag.ics"' });
    res.end(icsFeed());
  },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// Impressum und Datenschutz: persönliche Angaben nie im Code auf GitHub. Anbieter-Angaben aus der Verwaltung (site.json),
// solange dort nichts gesichert ist aus Umgebungsvariablen (Plesk); Hoster und Protokoll-Tage nur aus der Umgebung
const LEGAL_FIELDS = { LEGAL_NAME: 'name', LEGAL_ADDRESS: 'address', LEGAL_EMAIL: 'email', LEGAL_PHONE: 'phone' };
const LEGAL_DEFAULTS = { LEGAL_HOSTER: 'PEIN GbR' };
const legalValue = (k) => { const s = siteSettings().legal; return (s && LEGAL_FIELDS[k] ? s[LEGAL_FIELDS[k]] : process.env[k] || LEGAL_DEFAULTS[k]) || ''; };
const legalInfo = () => Object.fromEntries(Object.entries(LEGAL_FIELDS).map(([k, f]) => [f, legalValue(k)]));
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const legal = (html) => html.replace(/\{\{(LEGAL_[A-Z_]+)\}\}/g, (m, k) => {
  const v = legalValue(k);
  if (k === 'LEGAL_PHONE') return v ? `<br>Telefon: ${escHtml(v)}` : ''; // freiwillig
  return v ? escHtml(v).replace(/\n/g, '<br>') : `<mark>noch eintragen: ${k}</mark>`;
});

// Gefunden werden (Google, Bing, KI-Assistenten): nur die öffentliche Version, nicht die private App oder die Demo-Instanz.
// robots.txt, sitemap.xml und llms.txt liegen bewusst nicht in public/, damit sie je Instanz passen.
const indexable = () => ACCOUNTS && !DEMO;
const siteUrl = (req) => (process.env.PUBLIC_URL || `${https(req) ? 'https' : 'http'}://${req.headers.host}`).replace(/\/+$/, '');
const SITE_PAGES = ['/', '/funktionen', '/beta', '/impressum.html', '/datenschutz.html'];
function seoFile(req, res, pathname) {
  const site = siteUrl(req), txt = (type, body) => { res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=3600' }); res.end(body); };
  if (pathname === '/robots.txt') {
    return txt('text/plain', indexable() ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /poll/\nAllow: /poll/anmeldung\n\nSitemap: ${site}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
  }
  if (!indexable()) return send(res, 404, 'Not Found');
  if (pathname === '/sitemap.xml') {
    return txt('application/xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITE_PAGES.map((p) => `  <url><loc>${site}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
  }
  return txt('text/markdown', `# Alltag

> Kostenlose Schul-App (Web-App) für Schülerinnen und Schüler: Stundenplan, Vertretungen, Hausaufgaben, Prüfungen, Termine und Noten in einer App. Funktioniert mit EduPage, WebUntis und Schulmanager Online oder mit selbst eingetragenem Stundenplan. Unabhängiges Schülerprojekt für Jugend forscht 2027, zurzeit in der Beta (Zugang mit Einladungscode).

## Seiten
- [Funktionen und häufige Fragen](${site}/funktionen): Was Alltag kann, welche Schulsoftware unterstützt wird, Antworten auf häufige Fragen
- [Beta-Tester werden](${site}/beta): Anmeldung für den Beta-Test, danach kommt ein Einladungscode per Mail
- [Datenschutz](${site}/datenschutz.html) und [Impressum](${site}/impressum.html)

## Kurz erklärt
- Stundenplan mit Vertretungen, Raumwechseln und Entfall; Mitteilung aufs Handy, wenn sich etwas ändert
- Hausaufgaben zum Abhaken, Lernplan 7, 3 und 1 Tag vor Prüfungen, Lernzeit-Timer
- Eigene Termine, Erinnerungen, Geburtstage und selbst eingetragene Noten mit Schnitt und Wunschnoten-Rechner
- Nachrichten der Schule (bei EduPage auch antworten und abstimmen)
- Web-App für iPhone, Android und PC (über „Zum Home-Bildschirm“), Widget und Siri-Kurzbefehle fürs iPhone
- Kostenlos und ohne Werbung; Schulpasswörter werden verschlüsselt gespeichert
- Alltag gehört nicht zu EduPage, Untis oder Schulmanager Online
`);
}

// Die HTML-Seiten liegen in pages/, nicht in public/: Plesk liefert alles in public/ direkt über nginx aus, an der App vorbei.
// Dann fehlten Look, Impressum-Angaben und Sicherheits-Header. Nur die App liefert sie deshalb aus.
const PAGES = path.join(__dirname, 'pages');
const PAGE_FILES = { '/': 'index.html', '/index.html': 'index.html', '/impressum.html': 'impressum.html', '/datenschutz.html': 'datenschutz.html', '/beta': 'beta.html', '/funktionen': 'funktionen.html',
  // Kurz-Links für den Beta-Test (Flyer, Gruppen-Chat): Anmeldung ohne Konto, der Rest öffnet das Formular in der App
  '/poll/anmeldung': 'beta.html', '/poll/fehler': 'index.html', '/poll/verbesserung': 'index.html', '/poll/rueckmeldung': 'index.html' };
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad Request'); }
  const page = PAGE_FILES[pathname], fp = page ? path.join(PAGES, page) : path.join(PUBLIC, rel);
  if (!page && !fp.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not Found');
  if (page && req.method === 'GET') trackView(req);
  fs.readFile(fp, (err, buf) => {
    if (err) return send(res, 404, 'Not Found');
    const type = TYPES[path.extname(fp)] || 'application/octet-stream';
    if (type.startsWith('text/html')) {
      let html = buf.toString('utf8');
      if (!PRIVATE) html = html.replace('<html lang="de">', '<html lang="de" data-skin="modern">'); // öffentliche Version: eigener Look
      // Versionsnummer an Skripte/Stile: nginx liefert public/ ohne Cache-Control, Browser hielten sonst stundenlang alte Dateien,
      // die nicht zum neuen HTML passen (nach einem Update blieb die App beim Laden hängen)
      html = html.replace(/(["'])\/(app\.css|app\.js|recur\.js|theme\.js|formulare\.js|formulare\.css|beta\.js|legal\.css)\1/g, (m, q, f) => {
        let v = '0';
        try { v = Math.floor(fs.statSync(path.join(PUBLIC, f)).mtimeMs).toString(36); } catch { /* Datei fehlt: ohne Version */ }
        return `${q}/${f}?v=${v}${q}`;
      });
      buf = Buffer.from(legal(html).replace(/\{\{SITE_URL\}\}/g, siteUrl(req)).replace(/\{\{ROBOTS\}\}/g, indexable() ? 'index, follow' : 'noindex, nofollow'));
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      ...(https(req) ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}), // Browser nutzt danach immer HTTPS
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP, 'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

// Rückkehr vom Konto-Dienst: Einmal-Code über die geschützte API gegen die Kontodaten tauschen, dann eigene Sitzung setzen
async function authCallback(req, res, q) {
  const go = (to, cookie) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(); };
  let account;
  try { ({ account } = await accountsApi('/api/exchange', 'POST', { code: String(q.get('code') || '').slice(0, 100) })); } catch { return go(`${ACCOUNTS_URL}/anmelden`); }
  if (!account?.id || account.disabled || !/^[0-9a-f-]{36}$/i.test(account.id)) return go(`${ACCOUNTS_URL}/anmelden`);
  keepAccount(account); // Abbild sofort aktuell (Version der Sitzung)
  fs.mkdirSync(userDir(account.id), { recursive: true, mode: 0o700 });
  if (!account.admin) trackCount('logins');
  const next = q.get('next') || '/';
  go(/^\/(?!\/)[^\s\\]{0,300}$/.test(next) ? next : '/', sessionCookie(req, 365 * 86400, account)); // nur Pfade der App, nie fremde Adressen
}
if (ACCOUNTS) { // beim Start: alte Konten umziehen, Abbild laden; danach alle 3 Minuten (falls eine Benachrichtigung verloren ging)
  setTimeout(() => migrateAccounts().catch((e) => console.error('Umzug der Konten:', e.message)).then(() => refreshAccounts()).catch((e) => console.warn('Konten laden:', e.message)), 300);
  setInterval(() => refreshAccounts().catch((e) => console.warn('Konten laden:', e.message)), 3 * 60e3);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (ACCOUNTS && url.pathname === '/auth/callback' && req.method === 'GET') return await authCallback(req, res, url.searchParams);
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
      if (['/robots.txt', '/sitemap.xml', '/llms.txt'].includes(url.pathname)) return seoFile(req, res, url.pathname);
      if (ADMIN_URL && url.pathname === '/admin') { // Verwaltung liegt auf ADMIN_URL (ohne: 404); ohne Sitzung erst anmelden (kommt danach wieder hierher)
        res.writeHead(302, { Location: sessionUser(req) ? `${ADMIN_URL}/` : `${ACCOUNTS_URL}/weiter?next=%2Fadmin`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      return serveStatic(req, res, url.pathname);
    }
    if (url.pathname === '/api/ping') return send(res, 200, 'ok'); // Selbst-Wachhalten, verrät nichts
    if (ACCOUNTS && url.pathname === '/api/accounts-hook' && req.method === 'POST') { // Konto-Dienst meldet Änderungen (Sperren, Passwort, Löschen)
      if (!same(String(req.headers.authorization || ''), `Bearer ${ACCOUNTS_SECRET}`)) return send(res, 401, { error: 'falscher Schlüssel' });
      await refreshAccounts().catch((e) => console.warn('Konten neu laden:', e.message));
      return send(res, 200, { ok: true });
    }
    // Verwaltungs-Seite: darf Admin-API und Abmelden mit der Sitzung nutzen (CORS nur für genau diese Adresse)
    const adminCors = !!ADMIN_URL && req.headers.origin === ADMIN_URL && (/^\/api\/admin(\/|$)/.test(url.pathname) || url.pathname === '/api/logout');
    if (adminCors) {
      res.setHeader('Access-Control-Allow-Origin', ADMIN_URL);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
        return res.end();
      }
    }
    // Zusätzlich zum SameSite-Cookie: ändernde Anfragen nur von der eigenen Seite (Programme ohne Browser schicken keinen Origin)
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && !adminCors) {
      let own = false;
      try { own = new URL(req.headers.origin).host === req.headers.host; } catch { /* ungültig = fremd */ }
      if (!own) return send(res, 403, { error: 'Anfrage von fremder Seite abgelehnt' });
    }
    if (url.pathname === '/api/info') return send(res, 200, { demo: DEMO || (ACCOUNTS && !!demoAccount()), accounts: ACCOUNTS, accountsUrl: ACCOUNTS ? ACCOUNTS_URL : '' }); // für die Startseite
    if (!PRIVATE && /^\/api\/(ha|shop|screen)(\/|$)/.test(url.pathname)) return send(res, 404, { error: 'unbekannt' });
    if (url.pathname === '/api/screen/agent') { // Fernsteuerungs-Programm auf dem PC, eigener Schlüssel statt Anmeldung
      if (req.method !== 'POST' || !same(req.headers['x-key'] || '', TOKENS.screen)) return send(res, 403, { error: 'falscher Schlüssel' }); // Header statt Adresse: landet nicht im Zugriffsprotokoll
      return await screenAgent(req, res, url.searchParams);
    }
    if (url.pathname === '/api/cron') { // geplante Aufgabe in Plesk bzw. cron-job.org ("URL abrufen")
      if (!same(url.searchParams.get('key') || '', TOKENS.cron)) return send(res, 403, { error: 'falscher Schlüssel' });
      await eachUser(() => sync(10 * 60e3));
      return send(res, 200, ACCOUNTS ? { ok: true } : { ok: true, status: load('status.json', {}) });
    }
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('key') || '';
    const reader = req.method === 'GET' && (url.pathname === '/api/calendar.ics' ? readerFor(bearer, 'calendar') : ['/api/data', '/api/summary', '/api/wake', '/api/focus'].includes(url.pathname) && readerFor(bearer));
    const user = sessionUser(req) || reader;
    if (!['/api/login', '/api/demo', '/api/beta'].includes(url.pathname) && !user) return send(res, 401, { error: 'login' });
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'items', 'notes', '<id>']
    for (const [key, fn] of Object.entries(routes)) {
      const [method, pattern] = key.split(' '), p = pattern.split('/').filter(Boolean);
      if (method !== req.method || p.length !== parts.length) continue;
      const args = [];
      if (!p.every((seg, i) => (seg.startsWith(':') ? (args.push(decodeURIComponent(parts[i])), true) : seg === parts[i]))) continue;
      const run = () => { if (limited()) demoTouch(req); return fn(req, res, ...args); };
      return await (ACCOUNTS && user?.id ? asUser(user, run) : run()); // alles Weitere läuft im Datenordner dieses Kontos
    }
    send(res, 404, { error: 'unbekannt' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Serverfehler' });
    if (!e.status) console.error(e);
  }
});
server.listen(process.env.PORT || 3000, () => console.log(`${APP} läuft auf http://localhost:${process.env.PORT || 3000}${DEMO ? ' (Demo, Passwort "demo")' : ''}`));
