'use strict';
// WebUntis: JSON-RPC laut offizieller Schnittstellenbeschreibung, Hausaufgaben/Prüfungen/Nachrichten über die Wege des Webclients
// (Vorlage: Node-Bibliothek „webuntis“ von SchoolUtils). Nur Anmeldung mit Benutzername und Passwort, nicht über Microsoft oder mit Zwei-Faktor.

class UntisError extends Error {
  constructor(message, code) { super(message); this.code = code; } // code: Abgleich pausiert, bis der Zugang neu eingetragen wird
}

const SERVER_RE = /^[a-z0-9-]+\.webuntis\.com$/; // nur echte WebUntis-Server, sonst könnte man den Server auf fremde Adressen schicken
const pad = (n) => String(n).padStart(2, '0');
const toUntis = (iso) => Number(iso.replace(/-/g, ''));
const fromUntis = (n) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
const hm = (n) => (n == null || n === '' ? '' : `${pad(Math.floor(n / 100))}:${pad(n % 100)}`);
const shift = (iso, n) => { const d = new Date(`${iso}T12:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const plain = (html) => String(html || '').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const msg = (id, kind, author, text, time) => ({ id, kind, author, text, time, replies: [], starred: false, important: false, confirmed: null, likes: 0, liked: false, attachments: [] });

async function http(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Alltag', Accept: 'application/json', ...opts.headers } });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
  return { status: r.status, json, text };
}

// Schulsuche wie in der Untis-App: Name oder Ort eintippen, Schule wählen
async function searchSchools(q) {
  const { json } = await http('https://mobile.webuntis.com/ms/schoolquery2', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'alltag', method: 'searchSchool', params: [{ search: q }], jsonrpc: '2.0' }),
  });
  if (json?.error) throw new UntisError(json.error.code === -6003 || /too many/i.test(json.error.message) ? 'Zu viele Treffer. Gib mehr vom Namen oder den Ort ein.' : 'Die Schulsuche von WebUntis antwortet gerade nicht.');
  return (json?.result?.schools || []).filter((s) => SERVER_RE.test(s.server || '') && s.loginName).slice(0, 20)
    .map((s) => ({ name: String(s.displayName || s.loginName), address: String(s.address || ''), server: s.server, school: String(s.loginName) }));
}

class Untis {
  constructor({ server, school, user, pass }, session = {}) {
    if (!SERVER_RE.test(server || '')) throw new UntisError('Unbekannter WebUntis-Server. Bitte die Schule neu suchen.', 'config');
    Object.assign(this, { server, school, user, pass, s: session?.sid ? session : null, jwt: null, grid: null });
  }
  get session() { return this.s || {}; }
  get base() { return `https://${this.server}/WebUntis`; }
  cookie() { return `JSESSIONID=${this.s.sid}; schoolname=${encodeURIComponent(`_${Buffer.from(this.school).toString('base64')}`)}`; }

  async rpc(method, params = {}, retry = true) {
    if (!this.s && method !== 'authenticate') await this.login();
    const { status, json } = await http(`${this.base}/jsonrpc.do?school=${encodeURIComponent(this.school)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.s ? { Cookie: this.cookie() } : {}) },
      body: JSON.stringify({ id: String(Date.now()), method, params, jsonrpc: '2.0' }),
    });
    if (!json) throw new UntisError(`WebUntis antwortet nicht (HTTP ${status})`);
    const e = json.error;
    if (!e) return json.result;
    if (e.code === -8520 && retry && method !== 'authenticate') { this.s = null; await this.login(); return this.rpc(method, params, false); } // Sitzung abgelaufen
    if (e.code === -8504) throw new UntisError('WebUntis: Benutzername oder Passwort stimmt nicht.', 'credentials');
    if (e.code === -8500) throw new UntisError('WebUntis kennt diese Schule nicht. Bitte die Schule neu suchen.', 'credentials');
    if (e.code === -8509) throw new UntisError('Dafür fehlt deinem WebUntis-Konto die Berechtigung.');
    throw new UntisError(`WebUntis: ${e.message || `Fehler ${e.code}`}`);
  }
  async login() {
    const r = await this.rpc('authenticate', { user: this.user, password: this.pass, client: 'Alltag' });
    if (!r?.sessionId) throw new UntisError('WebUntis hat die Anmeldung abgelehnt.', 'credentials');
    this.s = { sid: r.sessionId, personId: r.personId, personType: r.personType, klasseId: r.klasseId };
    this.jwt = null;
  }
  async token() { // Nachrichten brauchen zusätzlich ein Token des Webclients
    if (!this.jwt) {
      const r = await fetch(`${this.base}/api/token/new`, { headers: { Cookie: this.cookie(), 'User-Agent': 'Alltag' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new UntisError(`WebUntis-Token: HTTP ${r.status}`);
      this.jwt = (await r.text()).trim();
    }
    return this.jwt;
  }
  async rest(pathname, query = {}, bearer = false) {
    if (!this.s) await this.login();
    const go = async () => http(`${this.base}${pathname}?${new URLSearchParams(query)}`, { headers: { Cookie: this.cookie(), ...(bearer ? { Authorization: `Bearer ${await this.token()}` } : {}) } });
    let r = await go();
    if (r.status === 401 || r.status === 403) { await this.login(); r = await go(); }
    if (r.status !== 200 || !r.json) throw new UntisError(`WebUntis ${pathname}: HTTP ${r.status}`);
    return r.json;
  }

  async lessons(from, to) {
    this.grid = await this.rpc('getTimegridUnits').catch((e) => { if (e.code) throw e; return []; });
    const opts = (element) => ({ options: { element, startDate: toUntis(from), endDate: toUntis(to), showInfo: true, showSubstText: true, showLsText: true, showStudentgroup: true,
      klasseFields: ['id', 'name', 'longname'], roomFields: ['id', 'name', 'longname'], subjectFields: ['id', 'name', 'longname'], teacherFields: ['id', 'name', 'longname'] } });
    let list;
    try { list = await this.rpc('getTimetable', opts({ id: this.s.personId, type: this.s.personType })); } catch (e) {
      if (e.code || !this.s?.klasseId) throw e;
      list = await this.rpc('getTimetable', opts({ id: this.s.klasseId, type: 1 })); // z. B. Elternkonten: Plan der Klasse
    }
    return untisLessons(list, this.grid);
  }
  bells() {
    const day = (this.grid || []).find((g) => g.day === 2) || this.grid?.[0]; // Montag
    return (day?.timeUnits || []).map((u, i) => ({ name: String(u.name || i + 1), start: hm(u.startTime), end: hm(u.endTime) }));
  }
  async student() {
    const app = await this.rest('/api/rest/view/v1/app/data', {}, true).catch(() => null);
    const classes = await this.rpc('getKlassen').catch(() => []);
    return { name: String(app?.user?.person?.displayName || ''), class: String(classes.find?.((k) => k.id === this.s?.klasseId)?.name || '') };
  }
  async homework(today, until) { // auch ältere Einträge, die erst noch fällig werden
    return untisHomework((await this.rest('/api/homeworks/lessons', { startDate: toUntis(shift(today, -14)), endDate: toUntis(until) })).data, today);
  }
  async exams(today, until) {
    return untisExams((await this.rest('/api/exams', { startDate: toUntis(today), endDate: toUntis(until), klasseId: -1, withGrades: false })).data?.exams, today);
  }
  async messages(today) {
    const [news, inbox] = await Promise.allSettled([
      this.rest('/api/public/news/newsWidgetData', { date: toUntis(today) }),
      this.rest('/api/rest/view/v1/messages', {}, true),
    ]);
    if (news.status === 'rejected' && inbox.status === 'rejected') throw news.reason;
    return [...untisInbox(inbox.value), ...untisNews(news.value?.data, today)];
  }
}

/* ------------------------------------------------------------------ Untis-Daten → Format der App (wie bei EduPage) */
function untisLessons(list, grid = []) {
  const days = new Map();
  for (const p of list || []) {
    const date = fromUntis(p.date), units = (grid || []).find((g) => g.day === new Date(`${date}T12:00`).getDay() + 1)?.timeUnits || []; // Untis: 1 = Sonntag
    const unit = units.findIndex((u) => u.startTime === p.startTime), su = p.su?.[0], cancelled = p.code === 'cancelled';
    const changes = [];
    if (!cancelled) { // orgid = ursprünglich eingeplant
      const te = (p.te || []).filter((t) => t.orgid), ro = (p.ro || []).filter((r) => r.orgid);
      const was = (xs) => xs.map((x) => x.orglongname || x.orgname).filter(Boolean).join(', ');
      if (te.length) changes.push(was(te) ? `Vertretung für ${was(te)}` : 'Vertretung');
      if (ro.length) changes.push(was(ro) ? `Raumänderung, sonst ${was(ro)}` : 'Raumänderung');
      const subj = was((p.su || []).filter((s) => s.orgid));
      if (subj) changes.push(`statt ${subj}`);
      if (!changes.length && p.code === 'irregular') changes.push('Vertretung');
    }
    const subject = su?.longname || su?.name || p.lstext || p.activityType || 'Unterricht';
    const lesson = {
      period: unit >= 0 ? Number(units[unit].name) || unit + 1 : null, start: hm(p.startTime), end: hm(p.endTime), subject, short: su?.name || '',
      teachers: (p.te || []).map((t) => t.longname || t.name).filter(Boolean), rooms: (p.ro || []).map((r) => r.name).filter(Boolean),
      groups: p.sg ? [String(p.sg)] : [], classes: (p.kl || []).map((k) => k.name).filter(Boolean),
      topic: [p.lstype === 'ex' ? 'Prüfung' : '', p.lstext !== subject ? p.lstext : '', p.substText, p.info].filter(Boolean).join(' · ') || null,
      cancelled, event: false, allday: false, online: null, changes, homework: [],
    };
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(lesson);
  }
  for (const l of days.values()) l.sort((a, b) => a.start.localeCompare(b.start) || (a.cancelled - b.cancelled));
  return days;
}

function untisHomework(data, today) {
  const lessons = new Map((data?.lessons || []).map((l) => [l.id, l])), teachers = new Map((data?.teachers || []).map((t) => [t.id, t.name]));
  const records = new Map((data?.records || []).map((r) => [r.homeworkId, r]));
  return (data?.homeworks || []).filter((h) => h.dueDate && fromUntis(h.dueDate) >= today).map((h) => ({
    id: `hw:${h.id}`, kind: 'homework', label: 'Hausaufgabe', title: String(h.text || 'Hausaufgabe').trim(), details: String(h.remark || '').trim(),
    subject: String(lessons.get(h.lessonId)?.subject || ''), due: fromUntis(h.dueDate), created: h.date ? `${fromUntis(h.date)}T00:00:00` : '',
    author: String(teachers.get(records.get(h.id)?.teacherId) || ''), done: !!h.completed,
  }));
}

function untisExams(exams, today) {
  return (exams || []).filter((e) => e.examDate && fromUntis(e.examDate) >= today).map((e) => {
    const label = String(e.examType || 'Prüfung'), title = String(e.name || e.text || label).trim();
    return { id: `ex:${e.id}`, kind: 'exam', label, title, details: e.text && e.text !== title ? String(e.text).trim() : '', subject: String(e.subject || ''),
      due: fromUntis(e.examDate), created: '', author: (e.teachers || []).join(', '), done: false };
  });
}

const untisNews = (data, date) => (data?.messagesOfDay || []).map((m) => msg(`news:${m.id}`, 'news', 'Schule', [m.subject, plain(m.text)].filter(Boolean).join('\n\n'), `${date}T00:00:00`));
const untisInbox = (data) => (data?.incomingMessages || []).map((m) => msg(`msg:${m.id}`, 'message', String(m.sender?.displayName || ''),
  [m.subject, m.contentPreview].filter(Boolean).join('\n\n'), String(m.sentDateTime || '')));

module.exports = { Untis, UntisError, searchSchools, untisLessons, untisHomework, untisExams, untisNews, untisInbox, plain, SERVER_RE };
