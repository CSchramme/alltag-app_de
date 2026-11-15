'use strict';
// EduPage-Zugriff, übertragen aus der Python-Bibliothek edupage-api 0.13.3:
// Login (RPC, sonst Formular), Startseiten-Daten, Stundenplan, Vertretungsplan, Timeline.
const zlib = require('zlib');
const crypto = require('crypto');

class EduError extends Error {
  constructor(code, message) { super(message); this.code = code; } // credentials | captcha | twofactor | expired
}

// wie urllib.parse.quote: "/" bleibt, !'()* werden kodiert
const quote = (s) => encodeURIComponent(s).replace(/%2F/g, '/').replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const form = (o) => Object.entries(o).map(([k, v]) => `${quote(k)}=${quote(v)}`).join('&');

// edubarUtils.js: Formular → raw deflate → base64, dazu SHA1-Prüfsumme
function encodeRequestBody(data) {
  const eqap = `dz:${zlib.deflateRawSync(Buffer.from(typeof data === 'string' ? data : form(data))).toString('base64')}`;
  return form({ eqap, eqacs: crypto.createHash('sha1').update(eqap).digest('hex'), eqaz: '1' });
}
function decodeResponse(text) {
  if (text.startsWith('eqwd:')) return Buffer.from(text.slice(5), 'base64').toString('latin1');
  if (!text.startsWith('eqz:')) return text;
  return Buffer.from(text.slice(4), 'base64').toString('latin1');
}
function parseRpc(text) {
  try { return JSON.parse(decodeResponse(text)); } catch { return null; }
}

function setCookies(headers) {
  if (headers.getSetCookie) return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[\w-]+=)/) : [];
}

// "userhome({...});" aus der Startseite – wie in Python: bis zum vorletzten ");"
function parseHome(html) {
  const at = html.indexOf('userhome(');
  if (at < 0) throw new EduError('expired', 'EduPage hat keine Startseiten-Daten geliefert');
  const s = html.slice(at + 9), last = s.lastIndexOf(');');
  const prev = last > 0 ? s.lastIndexOf(');', last - 1) : -1;
  const data = JSON.parse(s.slice(0, prev >= 0 ? prev : last).replace(/[\t\n\r]/g, ''));
  const gsh = html.split('ASC.gsechash="')[1]?.split('"')[0] ?? null;
  return { data, gsh };
}

class Edupage {
  constructor(school, cookies = {}) {
    this.base = `https://${school}.edupage.org`;
    this.cookies = new Map(Object.entries(cookies));
    this.data = null;
    this.gsh = null;
  }

  async req(path, { method = 'GET', body, json } = {}) {
    let url = new URL(path, this.base);
    for (let hop = 0; hop < 8; hop++) {
      const headers = { 'User-Agent': 'Mozilla/5.0', Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
      if (json) headers['Content-Type'] = 'application/json';
      else if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const res = await fetch(url, { method, headers, body: json ? JSON.stringify(json) : body, redirect: 'manual', signal: AbortSignal.timeout(20000) });
      for (const c of setCookies(res.headers)) {
        const [kv] = c.split(';'), i = kv.indexOf('=');
        if (/max-age=0|expires=thu, 01[- ]jan[- ]1970/i.test(c)) this.cookies.delete(kv.slice(0, i).trim());
        else this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url);
        method = 'GET'; body = undefined; json = undefined;
        continue;
      }
      return { status: res.status, url: url.href, text: await res.text() };
    }
    throw new Error('Zu viele Weiterleitungen');
  }

  home(html) { ({ data: this.data, gsh: this.gsh } = parseHome(html)); }

  async login(user, pass) {
    let res = await this.loginRpc(user, pass);
    if (!res) { // Schulen ohne RPC-Login: klassisches Formular
      const page = await this.req('/login/?cmd=MainLogin');
      const csrf = page.text.split('"csrftoken":"')[1]?.split('"')[0];
      if (!csrf) throw new EduError('credentials', 'EduPage hat keinen Login-Token geliefert – stimmt die Schul-Adresse?');
      res = await this.req('/login/edubarLogin.php', { method: 'POST', body: form({ csrfauth: csrf, username: user, password: pass }) });
      if (/cap=1|lerr=b43b43/.test(res.url)) throw new EduError('captcha', 'EduPage verlangt ein Captcha. Melde dich einmal im Browser bei EduPage an und versuche es später erneut.');
      if (res.url.includes('bad=1')) throw new EduError('credentials', 'Benutzername oder Passwort ist falsch.');
    }
    if (res.url.includes('twofactor')) throw new EduError('twofactor', 'Zwei-Faktor-Anmeldung wird nicht unterstützt.');
    try { this.home(res.text); } catch { throw new EduError('credentials', 'Anmeldung fehlgeschlagen – Zugangsdaten prüfen.'); }
  }

  async loginRpc(user, pass) {
    if ((await this.req('/login/?cmd=MainLogin')).status !== 200) return null;
    const t = await this.req('/login/?cmd=MainLogin&akcia=getToken', { method: 'POST', body: encodeRequestBody({ rpcparams: JSON.stringify({ username: user, edupage: '' }) }) });
    const token = t.status === 200 && parseRpc(t.text)?.token;
    if (!token) return null;
    const l = await this.req('/login/?cmd=MainLogin&akcia=login', {
      method: 'POST',
      body: encodeRequestBody({ rpcparams: JSON.stringify({ username: user, password: pass, userToken: token, edupage: '', ctxt: '', tu: null, gu: null, au: null }) }),
    });
    const r = l.status === 200 && parseRpc(l.text);
    if (!r || r.err?.error_id === 'invalid_token' || !r.redirectUrl) return null;
    return this.req(r.redirectUrl);
  }

  // Bestehende Sitzung wiederverwenden – wirft EduError('expired'), wenn sie abgelaufen ist
  async refresh() { this.home((await this.req('/user')).text); }

  dbi(group, id) { return this.data?.dbi?.[group]?.[String(id)]; }
  person(group, id) { const p = this.dbi(group, id); return p ? `${p.firstname} ${p.lastname}`.trim() : null; }

  async plan(date) {
    const eb = (await this.req('/dashboard/eb.php?mode=ttday')).text;
    const gpid = eb.split('gpid=')[1]?.split('&')[0], gsh = eb.split('gsh=')[1]?.split('"')[0];
    if (!gpid || !gsh) throw new Error('Stundenplan-Schlüssel fehlt');
    const uid = this.data.userid;
    const r = await this.req('/gcall', {
      method: 'POST',
      body: form({ gpid: String(Number(gpid) + 1), gsh, action: 'loadData', user: uid, changes: '{}', date, dateto: date, _LJSL: '4096' }),
    });
    const start = `${uid}",`;
    if (!r.text.includes(start)) throw new Error('Kein Stundenplan für dieses Konto');
    const body = r.text.split(start)[1];
    return JSON.parse(body.slice(0, body.lastIndexOf(',['))).dates?.[date]?.plan ?? [];
  }

  lessons(plan) {
    const out = [];
    for (const l of plan) {
      if ('header' in l && (!l.header?.length || l.header[0]?.cmd === 'addlesson_t')) continue;
      const subj = this.dbi('subjects', l.subjectid);
      const event = !!(l.type === 'event' || l.type === 'out' || l.main);
      let topic = l.flags?.dp0?.note_wd || l.flags?.event?.name || null;
      if (!topic && event && !subj && typeof l.name === 'string' && l.name.trim()) topic = l.name;
      out.push({
        period: /^\d+$/.test(l.uniperiod) ? Number(l.uniperiod) : null,
        start: (l.starttime || '').replace('24:00', '23:59'),
        end: (l.endtime || '').replace('24:00', '23:59'),
        subject: subj?.name || topic || 'Veranstaltung',
        short: subj?.short || '',
        teachers: (l.teacherids || []).map((id) => this.person('teachers', id)).filter(Boolean),
        rooms: (l.classroomids || []).map((id) => this.dbi('classrooms', id)?.name).filter(Boolean),
        groups: (l.groupnames || []).filter(Boolean),
        topic: subj ? topic : null,
        cancelled: !!(l.removed || l.type === 'absent' || l.type === ''),
        event,
        online: l.ol_url || null,
      });
    }
    return out;
  }

  timeline() {
    const props = this.data?.userProps && typeof this.data.userProps === 'object' ? this.data.userProps : {};
    const out = [];
    for (const e of this.data?.items || []) {
      if (!e.timelineid) continue;
      let d = {};
      try { d = JSON.parse(e.data || '{}'); } catch { /* kaputte Zusatzdaten ignorieren */ }
      if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
      let text = e.text;
      if (e.typ === 'sprava' && typeof d.messageContent === 'string' && d.messageContent.trim()) text = d.messageContent;
      if (!text) text = d.nazov || '';
      out.push({
        id: String(e.timelineid), type: e.typ, text: String(text || '').trim(), data: d,
        author: e.vlastnik_meno === '*' ? 'Ganze Schule' : String(e.vlastnik_meno || ''),
        time: e.timestamp, eventTime: e.cas_udalosti || null,
        replyTo: e.reakcia_na ? String(e.reakcia_na) : null,
        removed: String(e.removed) === '1',
        done: !!props[e.timelineid]?.doneMaxCas,
      });
    }
    return out;
  }

  whoami() {
    const sid = String(this.data?.userid || '').replace(/\D/g, '');
    const me = this.dbi('students', sid);
    const c = this.dbi('classes', me?.classid ?? this.data?.userrow?.TriedaID);
    return { name: me ? `${me.firstname} ${me.lastname}`.trim() : '', cls: c?.name || '' };
  }
}

/* ------------------------------------------------------------------ Snapshot für die App */
const TASK_KINDS = {
  homework: ['homework', 'Hausaufgabe'], bexam: ['exam', 'Klassenarbeit'], sexam: ['exam', 'Test'], testing: ['exam', 'Test'],
  oexam: ['exam', 'Mündliche Prüfung'], rexam: ['exam', 'Referat'], pexam: ['exam', 'Projekt'],
  event: ['event', 'Termin'], schoolevent: ['event', 'Schulveranstaltung'], excursion: ['event', 'Exkursion'], trip: ['event', 'Ausflug'],
  culture: ['event', 'Kultur'], parentsevening: ['event', 'Elternabend'], holiday: ['event', 'Ferien'], freeday: ['event', 'Schulfrei'], sholiday: ['event', 'Schulfrei'],
};
const MESSAGE_KINDS = { sprava: 'message', news: 'news', chat: 'chat' };
const KEEP_DAYS = 14;

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

async function snapshot(ep, { school, now = new Date() } = {}) {
  const errors = [];
  const attempt = async (label, fn, fallback) => {
    try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return fallback; }
  };
  const who = await attempt('Klasse', () => ep.whoami(), { name: '', cls: '' });
  const subjects = ep.data?.dbi?.subjects || {};

  // nächste 7 Kalendertage, Stundenplan nur an Werktagen
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = addDays(now, i), date = isoDay(dt);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    // Nur der persönliche Stundenplan zählt – der Vertretungsplan der ganzen Schule passt nicht zu Kursen/Gruppen
    const lessons = (await attempt(`Stundenplan ${date}`, async () => ep.lessons(await ep.plan(date)), [])).map((l) => ({ ...l, changes: [] }));
    const changes = lessons.filter((l) => l.cancelled).map((l) => ({
      periods: l.period ? [l.period] : [], label: l.period ? `${l.period}.` : '', text: `${l.subject} – Entfall`, kind: 'cancel',
    }));
    days.push({ date, lessons, changes });
  }

  const items = (await attempt('Timeline', () => ep.timeline(), [])).sort((a, b) => a.time.localeCompare(b.time));
  const cutoff = isoDay(addDays(now, -KEEP_DAYS));
  const tasks = [], messages = new Map();
  for (const n of items) {
    if (n.removed) continue;
    if (TASK_KINDS[n.type]) {
      const due = n.eventTime ? n.eventTime.slice(0, 10) : null;
      if ((due || n.time.slice(0, 10)) < cutoff) continue;
      const [kind, label] = TASK_KINDS[n.type];
      tasks.push({
        id: n.id, kind, label, title: n.text || n.data.nazov || label,
        subject: subjects[String(n.data.predmetid ?? n.data.subjectid ?? '')]?.name || '',
        due, created: n.time.replace(' ', 'T'), author: n.author, done: n.done,
      });
    } else if (MESSAGE_KINDS[n.type]) {
      const att = n.data.attachements && typeof n.data.attachements === 'object' ? n.data.attachements : {};
      const m = {
        id: n.id, kind: MESSAGE_KINDS[n.type], author: n.author, text: n.text, time: n.time.replace(' ', 'T'), replies: [],
        attachments: Object.entries(att).map(([url, name]) => ({ name: String(name), url: url.startsWith('/') ? `https://${school}.edupage.org${url}` : url })),
      };
      const parent = n.replyTo && messages.get(n.replyTo);
      if (parent) { parent.replies.push(m); parent.last = m.time; } else messages.set(m.id, m);
    }
  }
  return {
    updated: new Date().toISOString(),
    student: { name: who.name, class: who.cls },
    days, tasks,
    messages: [...messages.values()].sort((a, b) => (b.last || b.time).localeCompare(a.last || a.time)).slice(0, 100),
    errors,
  };
}

module.exports = { Edupage, EduError, snapshot, encodeRequestBody, decodeResponse, parseHome, isoDay, addDays };
