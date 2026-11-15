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
  room(id) { const r = this.dbi('classrooms', id); return r ? r.short || r.name : null; }
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

  // Persönlicher Tagesplan (Format aus echten Daten): Stunden, Termine/Prüfungen, Ausfall als eigener
  // Eintrag mit „Entfällt“, Vertretung über flags.dp0.changes [{column, old}], fällige Hausaufgaben in infos.
  lessons(plan) {
    const times = {}; // Einträge ohne Uhrzeit (z. B. Entfall) bekommen die Zeit derselben Stunde
    for (const l of plan) if (l.starttime && l.uniperiod) times[l.uniperiod] ??= [l.starttime, l.endtime];
    const out = [];
    for (const l of plan) {
      if (l.type === 'period' || ('header' in l && (!l.header?.length || l.header[0]?.cmd === 'addlesson_t'))) continue;
      const dp = l.flags?.dp0 && typeof l.flags.dp0 === 'object' ? l.flags.dp0 : {};
      const head = (l.header || []).map((h) => h.item || h);
      const subj = this.dbi('subjects', l.subjectid ?? dp.subjectid ?? head.find((h) => h.subjectid)?.subjectid);
      const headText = head.map((h) => h.text).filter((t) => t && t.trim() !== '·').join(' · ');
      const texts = (l.infos || []).flatMap((i) => (i.texts || []).map((t) => ({ type: i.type, ...t })));
      const event = !!(l.type === 'event' || l.type === 'out' || l.main);
      const allday = !!(dp.allday || l.allday || l.uniperiod === 'ad');
      const cancelled = !!(dp.cancelled || l.removed || l.type === 'absent' || l.type === '' || texts.some((t) => /^Entfällt/.test(t.text || '')));
      const [start, end] = allday ? ['', ''] : l.starttime ? [l.starttime, l.endtime] : times[l.uniperiod] || ['', ''];
      // Vertretung = anderer Lehrer, Raum oder anderes Fach als im regulären Plan; geänderte Klassenlisten betreffen dich nicht
      const old = (col) => [...new Set((dp.changes || []).filter((c) => c.column === col).flatMap((c) => [].concat(c.old)).map(String))];
      const notes = [];
      if (!cancelled) {
        const t = old('teacherids').map((id) => this.person('teachers', id)).filter(Boolean);
        const r = old('classroomids').map((id) => this.room(id)).filter(Boolean);
        const s = old('subjectid').filter((id) => id !== String(subj?.id)).map((id) => this.dbi('subjects', id)?.name).filter(Boolean);
        if (t.length) notes.push(`Vertretung für ${t.join(', ')}`);
        if (r.length) notes.push(`Raumänderung, sonst ${r.join(', ')}`);
        if (s.length) notes.push(`statt ${s.join(', ')}`);
        if (!notes.length && dp.substids?.length) notes.push('Vertretung');
      }
      out.push({
        period: /^\d+$/.test(l.uniperiod) ? Number(l.uniperiod) : null,
        start: start.replace('24:00', '23:59'),
        end: end.replace('24:00', '23:59'),
        subject: (event ? headText || subj?.name : subj?.name || headText) || 'Unterricht',
        short: subj?.short || '',
        teachers: (l.teacherids || []).map((id) => this.person('teachers', id)).filter(Boolean),
        rooms: (l.classroomids || []).map((id) => this.room(id)).filter(Boolean),
        groups: (l.groupnames || []).filter(Boolean),
        classes: (l.classids || []).map((id) => this.dbi('classes', id)).filter(Boolean).map((c) => c.short || c.name),
        topic: (event ? subj?.name : (subj && headText) || dp.note_wd || l.flags?.event?.name) || null,
        cancelled, event, allday,
        online: l.ol_url || dp.ol_url || null,
        changes: notes,
        homework: texts.filter((t) => t.type === 'homework').map((t) => String(t.item?.text || t.text || '').trim()).filter(Boolean),
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
        starred: props[e.timelineid]?.starred === '1',
      });
    }
    return out;
  }

  // Timeline-Aktionen wie im EduPage-Webclient (timelineViewer.js) bzw. der Python-Bibliothek (createItem)
  async timelineAction(akcia, data) {
    const r = await this.req(`/timeline/?=&akcia=${akcia}&eqav=1&maxEqav=7`, { method: 'POST', body: encodeRequestBody(data) });
    const text = decodeResponse(r.text);
    if (r.status !== 200 || text === '0') throw new Error(`EduPage hat „${akcia}“ abgelehnt`);
    try { return JSON.parse(text); } catch { throw new Error(`EduPage-Antwort auf „${akcia}“ war unlesbar`); }
  }
  async sendMessage(to, text) {
    const r = await this.timelineAction('createItem', { selectedUser: to.join(';'), text, attachements: '{}', receipt: '0', typ: 'sprava' });
    if (!r.changes?.length) throw new Error('EduPage hat die Nachricht nicht angenommen');
  }
  async reply(groupid, text) {
    const r = await this.timelineAction('createReply', { groupid, text });
    if (r.status && r.status !== 'ok') throw new Error('EduPage hat die Antwort nicht angenommen');
  }
  // Lesebestätigung (type 'receipt', val '') und „Gefällt mir“ (type 'like', val '1'/'0') – wie Message.markAsSeen/markAsLiked der Node-Bibliothek
  async confirm(groupid, type, val) {
    await this.timelineAction('createConfirmation', { groupid, confirmType: type, val });
  }
  async setProp(groupid, prop, val) {
    await this.timelineAction('setUserProp', { propsToStore: JSON.stringify({ [groupid]: { [prop]: val } }) });
  }

  // Stundenplan einer Lehrkraft (wie get_timetable() der Python-Bibliothek)
  async teacherPlan(id, date) {
    const r = await this.req('/timetable/server/currenttt.js?__func=curentttGetData', {
      method: 'POST',
      json: { __args: [null, { year: this.data?.dp?.year, datefrom: date, dateto: date, table: 'teachers', id: String(id), showColors: true, showIgroupsInClasses: true, showOrig: true, log_module: 'CurrentTTView' }], __gsh: this.gsh },
    });
    const j = JSON.parse(r.text).r || {};
    if (j.error) throw new Error(/insuf/i.test(j.error) ? 'Deine Schule erlaubt keinen Einblick in Lehrer-Stundenpläne.' : String(j.error));
    return this.lessons(j.ttitems || []);
  }
  // Regulärer Gesamtstundenplan, wie ihn der EduPage-Stundenplan-Viewer zeigt (ohne Vertretungen) –
  // Rückfall, wenn Schülerkonten den Lehrer-Stundenplan nicht sehen dürfen
  async regularTables() {
    const post = async (path, args) => JSON.parse((await this.req(path, { method: 'POST', json: { __args: args, __gsh: this.gsh || '00000000' } })).text).r || {};
    const list = await post('/timetable/server/ttviewer.js?__func=getTTViewerData', [null, this.data?.dp?.year]);
    const tt = list.regular?.default_num || list.regular?.timetables?.find((t) => !t.hidden)?.tt_num;
    if (!tt) throw new Error('Deine Schule hat keinen Gesamtstundenplan freigegeben.');
    const r = await post('/timetable/server/regulartt.js?__func=regularttGetData', [null, tt]);
    const tables = Object.fromEntries((r.dbiAccessorRes?.tables || []).map((t) => [t.id, t.data_rows || []]));
    if (!tables.cards?.length || !tables.lessons?.length) throw new Error('Der Gesamtstundenplan der Schule ist nicht einsehbar.');
    return tables;
  }

  teachers() {
    return Object.entries(this.data?.dbi?.teachers || {}).map(([id, p]) => ({ id, name: `${p.firstname || ''} ${p.lastname || ''}`.trim() }))
      .filter((t) => t.name).sort((a, b) => a.name.localeCompare(b.name, 'de'));
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
}; // Termine/Feiertage nicht aus der Timeline – die stehen schon im persönlichen Stundenplan
const SNAPSHOT_VERSION = 5;
// Prüfungen kündigt EduPage als Timeline-Termin an („Udalosť: 1.Deutsch-SchA - 16.11.2026“) – daraus entsteht der Lernplan
const EXAM_RE = /SchA|Schulaufgabe|Stegreif|\bEx\b|Klassenarbeit|Klausur|Kurzarbeit|\bTest\b/i;
const examLabel = (t) => (/SchA|Schulaufgabe/i.test(t) ? 'Schulaufgabe' : /Stegreif|\bEx\b/i.test(t) ? 'Stegreifaufgabe'
  : /Kurzarbeit/i.test(t) ? 'Kurzarbeit' : /Klassenarbeit/i.test(t) ? 'Klassenarbeit' : 'Prüfung'); // erhöhen, wenn sich die Auswertung ändert → Server gleicht nach dem Update sofort neu ab
const MESSAGE_KINDS = { sprava: 'message', news: 'news', chat: 'chat' };
const KEEP_DAYS = 14;

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Ein Schultag: Stunden plus Liste der Änderungen (Entfall/Vertretung) für Mitteilungen
function schoolDay(date, lessons) {
  const changes = lessons.filter((l) => l.cancelled || l.changes.length).map((l) => ({
    periods: l.period ? [l.period] : [], label: l.period ? `${l.period}.` : '',
    text: l.cancelled ? `${l.subject} – Entfall` : `${l.subject}: ${l.changes.join(', ')}`, kind: l.cancelled ? 'cancel' : 'change',
  }));
  return { date, lessons, changes };
}

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
    days.push(schoolDay(date, await attempt(`Stundenplan ${date}`, async () => ep.lessons(await ep.plan(date)), [])));
  }

  const items = (await attempt('Timeline', () => ep.timeline(), [])).sort((a, b) => a.time.localeCompare(b.time));
  const cutoff = isoDay(addDays(now, -KEEP_DAYS));
  const today = isoDay(now), tasks = new Map(), messages = new Map(), missing = new Map();
  const subjectIn = (t) => Object.values(subjects).find((s) => s.name && t.includes(s.name))?.name || '';
  for (const n of items) {
    const exam = n.type === 'event' && EXAM_RE.test(n.text) && !TASK_KINDS[n.type];
    if (TASK_KINDS[n.type] || exam) {
      // Ändert die Lehrkraft eine Hausaufgabe, legt EduPage einen neuen Eintrag mit derselben data.id an („Geändert: …“) → der neueste gilt
      const key = String(n.data.id || n.id), prev = tasks.get(key);
      tasks.delete(key);
      const due = n.eventTime ? n.eventTime.slice(0, 10) : n.data.date || null;
      if (n.removed || (due ? due < today : n.time.slice(0, 10) < cutoff)) continue; // Vergangenes ausblenden
      const [kind, label] = exam ? ['exam', examLabel(n.text)] : TASK_KINDS[n.type];
      const title = exam ? n.text.replace(/^[^:]{1,20}:\s*/, '').replace(/\s*-\s*\d{1,2}\.\d{1,2}\.\d{4}\s*$/, '')
        : String(n.data.nazov || n.text || label).replace(/^Geändert:\s*/, '');
      tasks.set(key, {
        id: key, tid: n.id, kind, label, title: title.trim(), details: String(n.data.popis || '').trim(),
        subject: subjects[String(n.data.predmetid ?? n.data.subjectid ?? '')]?.name || subjectIn(title),
        due, created: n.time.replace(' ', 'T'), author: n.author, done: n.done || !!prev?.done,
      });
    } else if (n.type === 'homeworkstudentstav') { // Lehrkraft hat eine Hausaufgabe als „fehlt“ markiert
      const key = String(n.data.id || n.id);
      missing.delete(key);
      if (n.data.stav === 'missing' && String(n.data.date || '') >= isoDay(addDays(now, -30))) {
        missing.set(key, {
          id: key, title: String(n.data.nazov || 'Hausaufgabe').trim(), date: n.data.date, comment: n.data.comment || '',
          subject: subjects[String(n.data.predmetid ?? '')]?.name || String(n.data.planNazov || '').split(' · ').pop(),
        });
      }
    } else if (n.removed) {
      continue;
    } else if (MESSAGE_KINDS[n.type]) {
      const att = n.data.attachements && typeof n.data.attachements === 'object' ? n.data.attachements : {};
      const m = {
        id: n.id, kind: MESSAGE_KINDS[n.type], author: n.author, text: n.text, time: n.time.replace(' ', 'T'), replies: [], starred: n.starred,
        important: !!+n.data.receipt || !!+n.data.importantReply, confirmed: n.data.myConfirmations?.receipt || null,
        likes: +(n.data.confirmations?.like || 0), liked: !!n.data.myConfirmations?.like,
        attachments: Object.entries(att).map(([url, name]) => ({ name: String(name), url: url.startsWith('/') ? `https://${school}.edupage.org${url}` : url })),
      };
      const parent = n.replyTo && messages.get(n.replyTo);
      if (parent) { parent.replies.push(m); parent.last = m.time; } else messages.set(m.id, m);
    }
  }
  return {
    v: SNAPSHOT_VERSION,
    updated: new Date().toISOString(),
    student: { name: who.name, class: who.cls },
    days, tasks: [...tasks.values()], missing: [...missing.values()].reverse(),
    people: await attempt('Lehrkräfte', () => ep.teachers(), []),
    messages: [...messages.values()].sort((a, b) => (b.last || b.time).localeCompare(a.last || a.time)).slice(0, 100),
    errors,
  };
}

// Tagesplan einer Lehrkraft aus dem regulären Gesamtstundenplan (Karten: Stunde, Tage als „10000“, Räume)
function regularDay(tables, teacherId, date) {
  const dow = new Date(`${date}T12:00`).getDay();
  if (dow === 0 || dow === 6) return [];
  const byId = (name) => new Map((tables[name] || []).map((x) => [String(x.id), x]));
  const lessons = byId('lessons'), subjects = byId('subjects'), rooms = byId('classrooms'), classes = byId('classes');
  const periods = new Map((tables.periods || []).map((p) => [String(p.period ?? p.id), p]));
  return (tables.cards || []).flatMap((c) => {
    const l = lessons.get(String(c.lessonid));
    if (!l || !(l.teacherids || []).map(String).includes(String(teacherId)) || String(c.days || '')[dow - 1] !== '1') return [];
    const p = periods.get(String(c.period)), last = periods.get(String(Number(c.period) + (Number(l.durationperiods) || 1) - 1)) || p;
    return [{
      period: Number(c.period) || null, start: p?.starttime || '', end: last?.endtime || '',
      subject: subjects.get(String(l.subjectid))?.name || 'Unterricht', short: subjects.get(String(l.subjectid))?.short || '',
      teachers: [], rooms: (c.classroomids || []).map((id) => rooms.get(String(id))).filter(Boolean).map((r) => r.short || r.name),
      classes: (l.classids || []).map((id) => classes.get(String(id))).filter(Boolean).map((k) => k.short || k.name),
      groups: [], topic: null, cancelled: false, event: false, allday: false, online: null, changes: [], homework: [],
    }];
  }).sort((a, b) => a.start.localeCompare(b.start));
}

module.exports = { Edupage, EduError, snapshot, schoolDay, regularDay, SNAPSHOT_VERSION, encodeRequestBody, decodeResponse, parseHome, isoDay, addDays };
