'use strict';
// Schulmanager Online: inoffizielle Schnittstelle des Webclients (Vorlagen: schulmanager-mcp von kohlsalem und die
// Home-Assistant-Integration von MrIcemanLE). Anmeldung: Salz holen, Passwort mit PBKDF2 hashen, JWT; Daten über /api/calls.
const crypto = require('crypto');
const { promisify } = require('util');

class SmError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const SM = 'https://login.schulmanager-online.de';
const pbkdf2 = promisify(crypto.pbkdf2);
const call = (moduleName, endpointName, parameters) => ({ moduleName, endpointName, parameters });
const hhmm = (t) => String(t || '').slice(0, 5);
const day = (d) => String(d || '').slice(0, 10);
const person = (t) => [t?.firstname, t?.lastname].filter(Boolean).join(' ') || String(t?.abbreviation || '');
const msg = (id, kind, author, text, time) => ({ id, kind, author, text, time, replies: [], starred: false, important: false, confirmed: null, likes: 0, liked: false, attachments: [] });
const shortHash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

async function http(url, body, jwt) {
  const r = await fetch(url, {
    method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'Alltag', Accept: 'application/json', 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
  });
  let json = null;
  try { json = await r.json(); } catch { /* keine JSON-Antwort */ }
  return { status: r.status, json };
}

class Schulmanager {
  constructor({ user, pass }, session = {}) {
    Object.assign(this, { user, pass, jwt: session?.jwt || null, kid: session?.student || null, hours: null });
  }
  get session() { return { jwt: this.jwt, student: this.kid }; }

  async login() {
    const salt = (await http(`${SM}/api/get-salt`, { emailOrUsername: this.user, mobileApp: false, institutionId: null })).json;
    if (typeof salt !== 'string') throw new SmError('Schulmanager antwortet gerade nicht wie erwartet.');
    const hash = (await pbkdf2(this.pass, salt, 99999, 512, 'sha512')).toString('hex'); // wie im Webclient
    const { status, json: r } = await http(`${SM}/api/login`, { emailOrUsername: this.user, password: this.pass, hash, mobileApp: false, institutionId: null });
    if (status >= 500 || !r) throw new SmError(`Schulmanager nicht erreichbar (HTTP ${status})`);
    if (!r.jwt) {
      if (/twoFactor/i.test(JSON.stringify(r))) throw new SmError('Bei deinem Schulmanager-Konto ist die Zwei-Faktor-Anmeldung an. Das kann Alltag noch nicht.', 'twofactor');
      throw new SmError('Schulmanager: Benutzername oder Passwort stimmt nicht.', 'credentials');
    }
    const u = r.user || {};
    const kids = u.associatedStudent ? [u.associatedStudent] : (u.associatedParents || []).map((p) => p.student).filter(Boolean);
    if (!kids.length) throw new SmError('In diesem Schulmanager-Konto ist kein Schüler hinterlegt.', 'credentials');
    this.jwt = r.jwt;
    this.kid = kids[0]; // shortcut: bei Elternkonten mit mehreren Kindern nur das erste
  }
  async calls(requests, retry = true) {
    if (!this.jwt || !this.kid) await this.login();
    const { status, json: r } = await http(`${SM}/api/calls`, { bundleVersion: '0000000000', requests: requests() }, this.jwt); // Platzhalter-Version nimmt der Server an
    if (status === 401 && retry) { this.jwt = null; return this.calls(requests, false); }
    if (status !== 200 || !Array.isArray(r?.results)) throw new SmError(`Schulmanager: HTTP ${status}`);
    return r.results.map((x, i) => {
      if (x.status !== 200) throw new SmError(`Schulmanager ${requests()[i].endpointName}: ${x.status}`);
      return x.data;
    });
  }

  async lessons(from, to) {
    const [list, hours] = await this.calls(() => [call('schedules', 'get-actual-lessons', { student: this.kid, start: from, end: to }), call('schedules', 'get-class-hours')]);
    this.hours = hours;
    return smLessons(list, hours);
  }
  bells() {
    return (this.hours || []).filter((h) => h.from && h.until).map((h) => ({ name: String(h.number ?? '').replace(/\.$/, ''), start: hhmm(h.from), end: hhmm(h.until) }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  student() { return { name: person(this.kid), class: String(this.kid?.class?.name || '') }; }
  async homework(today) { return smHomework((await this.calls(() => [call('classbook', 'get-homework', { student: this.kid })]))[0], today); }
  async exams(today, until) { return smExams((await this.calls(() => [call('exams', 'get-exams', { student: this.kid, start: today, end: until })]))[0], today); }
  async messages() { // Elternbriefe; Schülerkonten haben das Modul oft nicht
    try { return smLetters((await this.calls(() => [call('letters', 'get-letters')]))[0]); } catch (e) { if (e.code) throw e; return []; }
  }
}

/* ------------------------------------------------------------------ Schulmanager-Daten → Format der App */
function smLessons(list, hours = []) {
  const byId = new Map((hours || []).map((h) => [h.id, h])), days = new Map();
  const TYPES = { substitution: 'Vertretung', specialLesson: 'Sonderstunde', changedLesson: 'Änderung', roomChange: 'Raumänderung', teacherChange: 'Vertretung', irregularLesson: 'Änderung' };
  for (const l of list || []) {
    const date = day(l.date || l.start);
    if (!date) continue;
    const ch = l.classHour || {}, h = byId.get(ch.id) || ch, wd = new Date(`${date}T12:00`).getDay(); // fromByDay: 0 = Sonntag
    const actual = l.actualLesson, orig = l.originalLessons?.[0] || l.originalLesson, cur = actual || orig || {};
    const cancelled = !actual || l.type === 'cancelledLesson' || !!l.isCancelled;
    const subject = cur.subject?.name || cur.subject?.abbreviation || cur.subjectLabel || l.subjectLabel || (l.type === 'event' ? 'Veranstaltung' : 'Unterricht');
    const changes = [];
    if (!cancelled && orig && actual) {
      const t0 = (orig.teachers || []).map(person).join(', '), t1 = (actual.teachers || []).map(person).join(', ');
      if (t0 && t0 !== t1) changes.push(`Vertretung für ${t0}`);
      if (orig.room?.name && orig.room.name !== actual.room?.name) changes.push(`Raumänderung, sonst ${orig.room.name}`);
      const s0 = orig.subject?.name || orig.subject?.abbreviation;
      if (s0 && s0 !== subject) changes.push(`statt ${s0}`);
    }
    if (!cancelled && !changes.length && TYPES[l.type]) changes.push(TYPES[l.type]);
    const lesson = {
      period: Number(String(ch.number ?? '').replace(/\.$/, '')) || null, start: hhmm(h.fromByDay?.[wd] || h.from), end: hhmm(h.untilByDay?.[wd] || h.until),
      subject, short: cur.subject?.abbreviation || '', teachers: (cur.teachers || []).map(person).filter(Boolean), rooms: cur.room?.name ? [cur.room.name] : [],
      groups: (cur.studentGroups || []).map((g) => g.name).filter(Boolean), classes: [],
      topic: [l.substitutionText, l.comment].filter(Boolean).join(' · ') || null, cancelled, event: l.type === 'event', allday: false, online: null, changes, homework: [],
    };
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(lesson);
  }
  for (const l of days.values()) l.sort((a, b) => a.start.localeCompare(b.start) || (a.period || 0) - (b.period || 0));
  return days;
}

// Hausaufgaben stehen im Klassenbuch bei der Stunde, in der sie aufgegeben wurden. Fällig ist sie in der nächsten Stunde
// des Fachs – das ergänzt der Server anhand des Stundenplans (due bleibt hier leer).
function smHomework(list, today) {
  const since = new Date(`${today}T12:00`);
  since.setDate(since.getDate() - 7);
  return (list || []).filter((x) => x.homework && day(x.date) >= since.toISOString().slice(0, 10)).map((x) => {
    const subject = String(x.subject?.name || x.subject || ''), text = String(x.homework).trim();
    return { id: `hw:${day(x.date)}:${shortHash(subject + text)}`, kind: 'homework', label: 'Hausaufgabe', title: text, details: '', subject,
      due: null, created: `${day(x.date)}T00:00:00`, author: '', done: false };
  });
}

function smExams(list, today) {
  return (list || []).filter((e) => day(e.date) >= today).map((e) => {
    const label = String(e.type?.name || 'Prüfung'), subject = String(e.subject?.name || '');
    return { id: `ex:${e.id ?? shortHash(day(e.date) + subject + label)}`, kind: 'exam', label, title: [label, subject].filter(Boolean).join(' '), details: String(e.comment || '').trim(),
      subject, due: day(e.date), created: String(e.createdAt || ''), author: '', done: false };
  });
}

const smLetters = (list) => (Array.isArray(list) ? list : []).filter((l) => l?.id != null)
  .map((l) => msg(`letter:${l.id}`, 'news', 'Elternbrief', String(l.title || l.subject || 'Elternbrief'), String(l.createdAt || l.date || l.sentAt || '')));

module.exports = { Schulmanager, SmError, smLessons, smHomework, smExams, smLetters };
