'use strict';
// Selbsttest ohne EduPage-Zugang:  node test.js
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Edupage, snapshot, encodeRequestBody, decodeResponse, parseHome, isoDay } = require('./edupage');

(async () => {
  // 1. Anfrage-Kodierung gleichwertig zur Python-Bibliothek. Node-zlib packt andere Bytes als Python-zlib,
  //    entpackt muss aber exakt dasselbe herauskommen (Referenz aus RequestData.encode_request_body).
  const zlib = require('zlib'), crypto = require('crypto');
  const unpack = (body) => {
    const p = new URLSearchParams(body), eqap = p.get('eqap');
    assert.equal(p.get('eqacs'), crypto.createHash('sha1').update(eqap).digest('hex'));
    return zlib.inflateRawSync(Buffer.from(eqap.slice(3), 'base64')).toString();
  };
  const python = 'eqap=dz%3AKypILkgsSswttlU1d1I1MiotTi3KS8xNBTJVjR1VjQyAjNzECr3c0uKS1CKQqJEzRDQ1pbQgMR1FIQiZuwAA&eqacs=f9c6d7fc7d575e2f868db167fdecdd500859d5cd&eqaz=1';
  assert.equal(unpack(encodeRequestBody({ rpcparams: '{"username": "max.muster", "edupage": ""}' })), unpack(python));
  assert.equal(unpack(python), 'rpcparams=%7B%22username%22%3A%20%22max.muster%22%2C%20%22edupage%22%3A%20%22%22%7D');
  assert.equal(decodeResponse(`eqz:${Buffer.from('{"token":"abc"}').toString('base64')}`), '{"token":"abc"}');
  assert.equal(decodeResponse('{"plain":1}'), '{"plain":1}');

  // 2. Startseiten-Daten
  const home = parseHome('<script>ASC.gsechash="g123";userhome({"userid":"Student42","a":"x);y"});\n\tASC.ready(1);\n</script>');
  assert.equal(home.data.userid, 'Student42');
  assert.equal(home.gsh, 'g123');
  assert.throws(() => parseHome('<html>Login</html>'), { code: 'expired' });

  // 3. Snapshot aus nachgebauten EduPage-Daten
  const ep = new Edupage('schule');
  ep.data = {
    userid: 'Student42',
    dbi: {
      students: { 42: { firstname: 'Max', lastname: 'M', classid: '7' } }, classes: { 7: { name: '7.A', short: '7A' } },
      subjects: { 1: { id: 1, name: 'Mathematik', short: 'M' }, '-8': { id: -8, name: 'Deutsch', short: 'D' }, '-145': { id: -145, name: 'Geographie', short: 'Geo' }, 6: { id: 6, name: 'Interessengruppe', short: 'IG' } },
      teachers: { 9: { firstname: 'Bea', lastname: 'Becker' }, 10: { firstname: 'Tom', lastname: 'Tal' } }, classrooms: { 5: { name: '104', short: '104' }, 7: { name: '205', short: '205' } },
    },
    items: [
      { timelineid: '1', typ: 'homework', text: '', timestamp: '2026-11-15 10:00:00', cas_udalosti: '2026-11-17 00:00:00', data: '{"predmetid":"1","nazov":"S. 12","popis":"mit Rechenweg"}', vlastnik_meno: 'Fr. X' },
      { timelineid: '2', typ: 'sprava', text: '', timestamp: '2026-11-15 11:00:00', data: '{"messageContent":"Hallo","attachements":{"/x/a.pdf":"a.pdf"},"receipt":"1","confirmations":{"like":"2","receipt":35},"myConfirmations":{"receipt":"2026-11-15 12:00:00"}}', vlastnik_meno: 'Fr. X' },
      { timelineid: '3', typ: 'sprava', text: 'Antwort', timestamp: '2026-11-15 12:00:00', data: '', reakcia_na: '2', vlastnik_meno: 'Max M' },
      { timelineid: '4', typ: 'homework', text: '', timestamp: '2026-11-10 10:00:00', cas_udalosti: '2026-11-13 00:00:00', data: '{"nazov":"überfällig"}', vlastnik_meno: 'Fr. X' },
      { timelineid: '6', typ: 'homework', text: '', timestamp: '2026-11-14 09:00:00', cas_udalosti: '2026-11-18 00:00:00', data: '{"id":"HW7","predmetid":"1","nazov":"alt"}', vlastnik_meno: 'Fr. X' },
      { timelineid: '7', typ: 'homework', text: 'Geändert: S. 40', timestamp: '2026-11-15 09:00:00', cas_udalosti: '2026-11-19 00:00:00', data: '{"id":"HW7","predmetid":"1","nazov":"S. 40"}', vlastnik_meno: 'Fr. X' },
      { timelineid: '9', typ: 'homeworkstudentstav', text: '', timestamp: '2026-11-14 08:00:00', data: '{"id":"superid:1","predmetid":"1","date":"2026-11-14","nazov":"AB Zellatmung","stav":"missing"}', vlastnik_meno: 'Fr. X' },
      { timelineid: '10', typ: 'homeworkstudentstav', text: '', timestamp: '2026-11-14 08:00:00', data: '{"id":"superid:2","predmetid":"1","date":"2026-11-14","nazov":"erledigt","stav":"done"}', vlastnik_meno: 'Fr. X' },
      { timelineid: '8', typ: 'event', text: 'Udalosť: 1.Deutsch-SchA', timestamp: '2026-11-15 09:00:00', cas_udalosti: '2026-11-16 00:00:00', data: '{}', vlastnik_meno: 'Fr. X' },
      { timelineid: '5', typ: 'homework', text: 'weg', timestamp: '2026-11-15 10:00:00', data: '{}', removed: '1' },
    ],
    userProps: { 1: { doneMaxCas: '2026-11-15 13:00:00' } },
  };
  const card = (p, sid, extra = {}, dp = {}) => ({ uniperiod: p, type: 'lesson', starttime: '09:45', endtime: '10:30', subjectid: sid, teacherids: ['9'], classroomids: ['5'], groupnames: [''],
    header: [{ item: { subjectid: sid, changes: [] } }], infos: [], flags: { dp0: { type: 'card', cancelled: false, allday: false, ...dp } }, ...extra });
  ep.plan = async () => [
    card('3', '1', { infos: [{ type: 'homework', texts: [{ text: 'Fällige Hausaufgabe (<- Freitag, 13.11.): ', item: { text: 'S. 12 Nr. 4\n' } }] }] },
      { changes: [{ column: 'classids', old: '-58' }] }), // geänderte Klassenliste: keine Vertretung für mich
    { uniperiod: '4', type: 'event', starttime: '10:50', endtime: '11:30', subjectid: '-8', teacherids: [], classroomids: [], groupnames: [''],
      header: [{ icon: 'x.svg', text: 'SchA: 1.Deutsch-SchA' }], flags: { dp0: { type: 'event', cancelled: false, allday: false } } },
    { uniperiod: '4', type: '', header: [{ item: { subjectid: '-145', changes: [{ column: 'subjectid', old: '-145' }] } }], infos: [{ texts: [{ text: 'Entfällt' }] }],
      flags: [], classids: [], teacherids: [], classroomids: [], groupnames: [], starttime: '', endtime: '', period: '4' },
    card('5', '1', { teacherids: ['10'], classroomids: ['7'] }, { changes: [{ column: 'teacherids', old: '9' }, { column: 'classroomids', old: '5' }] }),
    card('7', '6', { header: [{ item: { text: 'Percussion, 6-10' } }, { item: { text: '·' } }, { item: { subjectid: '6', changes: [] } }] }, { type: 'tcard' }),
    card('6', '1', { teacherids: [], starttime: '12:10', endtime: '12:50' }), // keine Lehrkraft eingetragen → Entfall
    { type: 'period', uniperiod: '8', header: [], flags: [], classids: [], teacherids: [], classroomids: [], groupnames: [] },
    { uniperiod: 'ad', type: 'event', starttime: '00:00', endtime: '24:00', header: [{ text: 'Feiertag: Buß- und Bettag' }], teacherids: [], classroomids: [], groupnames: [''], flags: { dp0: { type: 'event', allday: true } } },
  ];
  const snap = await snapshot(ep, { school: 'schule', now: new Date(2026, 10, 16, 8) });
  assert.deepEqual(snap.errors, []);
  assert.deepEqual(snap.student, { name: 'Max M', class: '7.A' });
  assert.equal(snap.days.length, 5); // Mo–Fr innerhalb von 7 Tagen
  const d0 = snap.days[0];
  // Entfall und Vertretung kommen aus dem persönlichen Stundenplan, nicht aus dem Vertretungsplan der Schule
  assert.deepEqual(d0.changes, [
    { periods: [4], label: '4.', text: 'Geographie – Entfall', kind: 'cancel' },
    { periods: [5], label: '5.', text: 'Mathematik: Vertretung für Bea Becker, Raumänderung, sonst 104', kind: 'change' },
    { periods: [6], label: '6.', text: 'Mathematik – Entfall', kind: 'cancel' }]);
  assert.deepEqual(d0.lessons.map((l) => [l.period, l.start, l.subject, l.topic, l.cancelled, l.event, l.allday]), [
    [3, '09:45', 'Mathematik', null, false, false, false],
    [4, '10:50', 'SchA: 1.Deutsch-SchA', 'Deutsch', false, true, false],
    [4, '10:50', 'Geographie', null, true, false, false], // Zeit von derselben Stunde übernommen
    [5, '09:45', 'Mathematik', null, false, false, false],
    [7, '09:45', 'Interessengruppe', 'Percussion, 6-10', false, false, false],
    [6, '12:10', 'Mathematik', null, true, false, false],
    [null, '', 'Feiertag: Buß- und Bettag', null, false, true, true]]);
  assert.deepEqual(d0.lessons[0].homework, ['S. 12 Nr. 4']);
  assert.deepEqual(d0.lessons[0].changes, []);
  assert.deepEqual(d0.lessons[3].teachers, ['Tom Tal']);
  // überfällig und Timeline-Termine fallen weg, die geänderte Hausaufgabe ersetzt ihr Original
  assert.deepEqual(snap.tasks.map((t) => [t.id, t.title, t.details, t.subject, t.due, t.done]).sort(), [
    ['1', 'S. 12', 'mit Rechenweg', 'Mathematik', '2026-11-17', true],
    ['8', '1.Deutsch-SchA', '', 'Deutsch', '2026-11-16', false], // Prüfungs-Ankündigung aus der Timeline, Fach aus dem Titel
    ['HW7', 'S. 40', '', 'Mathematik', '2026-11-19', false]]);
  assert.equal(snap.tasks.find((t) => t.id === '8').label, 'Schulaufgabe');
  assert.equal(snap.tasks.find((t) => t.id === 'HW7').tid, '7'); // Timeline-ID für den Haken in EduPage
  assert.deepEqual(snap.missing.map((m) => [m.title, m.subject]), [['AB Zellatmung', 'Mathematik']]);
  assert.equal(snap.v, 6);

  // Lehrkraft laut regulärem Gesamtstundenplan (Montag = erste Stelle in „days“, Doppelstunde über durationperiods)
  const { regularDay } = require('./edupage');
  const tables = {
    periods: [{ id: '1', period: '1', starttime: '07:55', endtime: '08:40' }, { id: '2', period: '2', starttime: '08:40', endtime: '09:25' }],
    lessons: [{ id: 'L1', subjectid: 'S1', teacherids: ['-156'], classids: ['C1'], durationperiods: 2 }, { id: 'L2', subjectid: 'S1', teacherids: ['-9'], classids: ['C1'] }],
    cards: [{ lessonid: 'L1', period: '1', days: '10000', classroomids: ['R1'] }, { lessonid: 'L1', period: '1', days: '01000', classroomids: ['R1'] }, { lessonid: 'L2', period: '2', days: '10000', classroomids: ['R1'] }],
    subjects: [{ id: 'S1', name: 'Englisch', short: 'E' }], classrooms: [{ id: 'R1', name: 'A004 (Tel. 4004)', short: 'A004' }], classes: [{ id: 'C1', name: '9A', short: '9A' }],
  };
  assert.deepEqual(regularDay(tables, '-156', '2026-11-16').map((l) => [l.start, l.end, l.subject, l.rooms[0], l.classes[0]]), [['07:55', '09:25', 'Englisch', 'A004', '9A']]);
  assert.equal(regularDay(tables, '-156', '2026-11-18').length, 0); // Mittwoch: keine Karte
  assert.equal(regularDay(tables, '-156', '2026-11-15').length, 0); // Sonntag

  // Wiederholungen (gemeinsam für Server und App)
  const R = require('./public/recur');
  assert.ok(R.occursOn({ date: '2026-11-17', repeat: 'weekly' }, '2026-11-24'));
  assert.ok(!R.occursOn({ date: '2026-11-17', repeat: 'weekly' }, '2026-11-25'));
  assert.ok(!R.occursOn({ date: '2026-11-17', repeat: 'weekly', until: '2026-11-20' }, '2026-11-24'));
  assert.ok(!R.occursOn({ date: '2026-11-17', repeat: 'weekly' }, '2026-11-10'));
  // Geburtstage: jedes Jahr, 29.2. sonst am 28.2., Alter nur mit bekanntem Jahr
  assert.ok(R.birthdayOn({ date: '2010-03-05' }, '2027-03-05'));
  assert.ok(R.birthdayOn({ date: '2008-02-29' }, '2027-02-28') && !R.birthdayOn({ date: '2008-02-29' }, '2028-02-28') && R.birthdayOn({ date: '2008-02-29' }, '2028-02-29'));
  assert.equal(R.ageOn({ date: '2010-03-05' }, '2027-03-05'), 17);
  assert.equal(R.ageOn({ date: '1900-03-05' }, '2027-03-05'), null);
  assert.equal(R.nextOccurrence({ due: '2026-11-20', repeat: 'weekdays' }, '2026-11-20'), '2026-11-23');
  assert.equal(R.nextOccurrence({ due: '2026-01-31', repeat: 'monthly' }, '2026-01-31'), '2026-03-31');
  assert.equal(R.nextOccurrence({ due: '2026-11-20', repeat: '' }, '2026-11-20'), null);
  assert.equal(snap.messages.length, 1);
  assert.equal(snap.messages[0].text, 'Hallo');
  assert.equal(snap.messages[0].replies[0].text, 'Antwort');
  assert.equal(snap.messages[0].attachments[0].url, 'https://schule.edupage.org/x/a.pdf');
  assert.deepEqual([snap.messages[0].important, snap.messages[0].confirmed, snap.messages[0].likes, snap.messages[0].liked], [true, '2026-11-15 12:00:00', 2, false]);

  // 4. Web-Push: Empfänger-Seite nachgebaut (RFC 8291) entschlüsselt, VAPID-Signatur prüfbar
  const { encrypt, vapidHeader, generateVapidKeys } = require('./push');
  const ua = crypto.createECDH('prime256v1'), uaPub = ua.generateKeys(), authSecret = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: 'Vertretung', body: 'Mathe – Entfall äöü' });
  const box = encrypt(msg, { p256dh: uaPub.toString('base64url'), auth: authSecret.toString('base64url') });
  const salt = box.subarray(0, 16), asPub = box.subarray(21, 21 + box[20]);
  const hk = (ikm, s, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, Buffer.from(info), n));
  const ikm = hk(ua.computeSecret(asPub), authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const dec = crypto.createDecipheriv('aes-128-gcm', hk(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hk(ikm, salt, 'Content-Encoding: nonce\0', 12));
  const rest = box.subarray(21 + box[20]);
  dec.setAuthTag(rest.subarray(-16));
  const plain = Buffer.concat([dec.update(rest.subarray(0, -16)), dec.final()]);
  assert.equal(plain.subarray(0, -1).toString(), msg);
  assert.equal(plain.at(-1), 2);
  const vk = generateVapidKeys(), [, jwt] = vapidHeader('https://push.example/x', vk, 'mailto:a@example.com').match(/t=([^,]+)/);
  const [h64, b64, s64] = jwt.split('.'), vpub = Buffer.from(vk.publicKey, 'base64url');
  const vkey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: vpub.subarray(1, 33).toString('base64url'), y: vpub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h64}.${b64}`), { key: vkey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(b64, 'base64url')).aud, 'https://push.example');

  // 5. Server (Demo) über HTTP
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alltag-test-'));
  const port = 3900 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, ['app.js'], { cwd: __dirname, env: { ...process.env, ENV_FILE: '', DEMO: '1', PRIVATE: '1', DATA_DIR: dir, PORT: String(port) }, stdio: 'pipe' });
  try {
    await new Promise((resolve, reject) => { srv.stdout.on('data', (b) => String(b).includes('läuft') && resolve()); srv.on('exit', reject); });
    const base = `http://localhost:${port}`;
    const call = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...o.headers } });
    assert.equal((await call('/api/data')).status, 401);
    assert.equal((await call('/api/login', { method: 'POST', body: JSON.stringify({ password: 'falsch' }) })).status, 401);
    const login = await call('/api/login', { method: 'POST', body: JSON.stringify({ password: 'demo' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const auth = (p, o = {}) => call(p, { ...o, headers: { Cookie: cookie, ...o.headers } });
    const data = await (await auth('/api/data')).json();
    assert.equal(data.app, 'Alltag');
    assert.ok(data.db.reminders.length && data.db.events.length);

    // eigene Einträge: anlegen, Felder prüfen, ändern, löschen
    const made = await (await auth('/api/items/grades', { method: 'POST', body: JSON.stringify({ subject: 'Physik', value: '2+', weight: '2', evil: '<x>' }) })).json();
    assert.equal(made.weight, 2);
    assert.equal(made.evil, undefined);
    assert.equal((await auth('/api/items/grades', { method: 'POST', body: JSON.stringify({ value: '1' }) })).status, 400); // Fach fehlt
    const upd = await (await auth(`/api/items/grades/${made.id}`, { method: 'PUT', body: JSON.stringify({ value: '1' }) })).json();
    assert.equal(upd.value, '1');
    assert.equal(upd.subject, 'Physik');
    assert.equal((await auth(`/api/items/grades/${made.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await auth('/api/items/hacks', { method: 'POST', body: '{}' })).status, 404);

    // Widget-Schlüssel darf nur lesen, Cron braucht seinen Schlüssel
    const { widget, cron } = await (await auth('/api/tokens')).json();
    assert.equal((await call('/api/data', { headers: { Authorization: `Bearer ${widget}` } })).status, 200);
    assert.equal((await call('/api/tokens', { headers: { Authorization: `Bearer ${widget}` } })).status, 401);
    assert.equal((await call('/api/cron?key=falsch')).status, 403);
    assert.equal((await call(`/api/cron?key=${cron}`)).status, 200);
    assert.equal((await call(`/api/diagnose?key=${cron}`)).status, 401); // vorübergehende Diagnose ist wieder entfernt
    // Selbst-Wachhalten: Ping ohne Anmeldung, eigene Adresse nur aus angemeldetem Aufruf gemerkt
    assert.equal(await (await call('/api/ping')).text(), 'ok');
    // Lernplan zur Demo-Klassenarbeit, Kurzbefehl-Text mit Lese-Schlüssel, Nachrichten nur an bekannte Lehrkräfte
    const d2 = await (await auth('/api/data')).json();
    assert.ok(d2.snap.tasks.some((t) => t.kind === 'study' && t.title.includes('Klassenarbeit')));
    assert.ok(d2.snap.people.length > 3 && d2.snap.missing.length === 1);
    const sum = await call(`/api/summary?day=morgen&key=${widget}`);
    assert.equal(sum.status, 200);
    assert.match(await sum.text(), /^Morgen /);
    // Einstellungen: Stunden-Mitteilungen an, unbekanntes Bundesland abgelehnt
    assert.equal((await (await auth('/api/settings', { method: 'POST', body: JSON.stringify({ lessonPush: true }) })).json()).lessonPush, true);
    assert.equal((await auth('/api/settings', { method: 'POST', body: JSON.stringify({ state: 'XX' }) })).status, 400);
    // Schulweg: Haltestellen, Ort, Vorlauf; Verbindungen (Demo); Wecker und Fokus für Kurzbefehle
    assert.equal((await auth('/api/settings', { method: 'POST', body: JSON.stringify({ place: { name: 'X', lat: 200, lon: 0 } }) })).status, 400);
    assert.equal((await auth('/api/settings', { method: 'POST', body: JSON.stringify({ stops: { home: { id: 'a b<', name: 'X' } } }) })).status, 400);
    const sw = await (await auth('/api/settings', { method: 'POST', body: JSON.stringify({ stops: { home: { id: 'de:1:1', name: 'Rathaus' }, school: { id: 'de:1:2', name: 'Schule' } }, wakeLead: 45 }) })).json();
    assert.equal(sw.stops.school.name, 'Schule');
    assert.equal(sw.wakeLead, 45);
    assert.ok(sw.weather.length > 24);
    const tr = await (await auth(`/api/trips?to=school&date=${isoDay(new Date())}&time=07:50`)).json();
    assert.ok(tr.configured && tr.trips.length && tr.trips.every((x) => x.arr <= '07:50'));
    const wake = await (await call(`/api/wake?key=${widget}`)).text();
    const tmr = d2.snap.days.find((d) => d.date === isoDay(new Date(Date.now() + 864e5)));
    assert.equal(wake, tmr?.lessons.some((l) => !l.cancelled) ? '06:43' : ''); // Demo: Abfahrt 07:28 (52 → 22 Min. vor 07:50) minus 45 Min.
    assert.match(await (await call(`/api/focus?day=morgen&key=${widget}`)).text(), tmr ? /^\d{2}:\d{2}$/ : /^$/);
    assert.equal((await call('/api/wake?key=falsch')).status, 401);
    const bd = await (await auth('/api/items/birthdays', { method: 'POST', body: JSON.stringify({ name: 'Oma', date: '1950-07-01', before: 99 }) })).json();
    assert.equal(bd.before, 30);
    assert.equal((await auth('/api/items/birthdays', { method: 'POST', body: JSON.stringify({ name: 'Ohne Datum' }) })).status, 400);
    // Tafelbilder: nur JPEG, nur angemeldet, Löschen entfernt die Datei
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const form = (b) => { const fd = new FormData(); fd.append('bild', new Blob([b.toString('base64')]), 'bild.jpg'); return fd; };
    const up = (p, b, h = {}) => fetch(base + p, { method: 'POST', body: form(b), headers: h }); // ohne JSON-Kopf: fetch setzt multipart mit Grenze
    assert.equal((await auth('/api/photos?subject=Mathe', { method: 'POST', body: jpeg, headers: { 'Content-Type': 'image/jpeg' } })).status, 400); // roh als image/jpeg sperrt die Hoster-Firewall
    const ph = await (await up('/api/photos?subject=Mathe&date=2026-11-16&caption=Tafel', jpeg, { Cookie: cookie })).json();
    assert.equal(ph.subject, 'Mathe');
    const img = await auth(`/api/photos/${ph.id}`);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), jpeg);
    assert.equal((await call(`/api/photos/${ph.id}`)).status, 401);
    assert.equal((await auth('/api/photos', { method: 'POST', body: 'kein Bild' })).status, 400);
    assert.equal((await auth('/api/items/photos', { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await auth('/api/photos/..%2Fsecret.json')).status, 404);
    assert.equal((await auth(`/api/items/photos/${ph.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await auth(`/api/photos/${ph.id}`)).status, 404);
    // Lernzeit starten und beenden (unter 1 Minute wird nichts gezählt)
    assert.equal((await (await auth('/api/timer', { method: 'POST', body: JSON.stringify({ subject: 'Mathe', minutes: 999 }) })).json()).timer.minutes, 180);
    const stopped = await (await auth('/api/timer/stop', { method: 'POST', body: '{}' })).json();
    assert.equal(stopped.timer, null);
    assert.ok(!stopped.db.sessions.some((s) => s.subject === 'Mathe' && s.date === isoDay(new Date()) && s.minutes > 25));
    // Ticket: nur echte Links
    assert.equal((await auth('/api/settings', { method: 'POST', body: JSON.stringify({ ticket: { name: 'Pass', url: 'javascript:alert(1)' } }) })).status, 400);
    assert.equal((await (await auth('/api/settings', { method: 'POST', body: JSON.stringify({ ticket: { name: 'Pass', url: 'https://example.org/ticket', until: '2027-01-31' } }) })).json()).ticket.until, '2027-01-31');
    // Home Assistant (Demo): Token verlässt den Server nie, nur freigegebene Knöpfe
    const hc = await auth('/api/ha', { method: 'POST', body: JSON.stringify({ url: 'https://ha.example/', token: 'geheimes-token' }) });
    const hcText = await hc.text();
    assert.equal(hc.status, 200);
    assert.ok(!hcText.includes('geheimes-token') && JSON.parse(hcText).ha.url === 'https://ha.example');
    assert.equal((await auth('/api/settings', { method: 'POST', body: JSON.stringify({ haPc: ['light.wohnzimmer'] }) })).status, 400);
    assert.equal((await auth('/api/settings', { method: 'POST', body: JSON.stringify({ haPc: ['switch.pc'], haTodo: 'todo.cookidoo_einkaufsliste' }) })).status, 200);
    assert.equal((await auth('/api/ha/pc/button.pc_sperren', { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await auth('/api/ha/pc/switch.pc', { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await (await auth('/api/ha/pc')).json())[0].state, 'on');
    // PC-Bildschirm: Programm mit eigenem Schlüssel, Eingaben nur bekannte Arten in Grenzen
    const { screen: skey } = await (await auth('/api/tokens')).json();
    assert.equal((await call('/api/screen/agent', { method: 'POST', body: '', headers: { 'X-Key': 'falsch' } })).status, 403);
    assert.equal((await call(`/api/screen/agent?key=${skey}`, { method: 'POST', body: '' })).status, 403); // Schlüssel nur im Header
    const off = await auth('/api/screen/frame?after=0');
    assert.equal(off.status, 204);
    assert.equal(off.headers.get('x-agent'), '0');
    const ag1 = await (await up('/api/screen/agent?n=2&s=0', jpeg, { 'X-Key': skey })).json();
    assert.equal(ag1.active, true);
    await auth('/api/screen/input', { method: 'POST', body: JSON.stringify({ events: [{ t: 'move', x: 2, y: 0.5 }, { t: 'key', k: 'rm -rf' }, { t: 'text', s: 'hi' }, { t: 'exec' }] }) });
    const fr = await auth('/api/screen/frame?after=0');
    assert.equal(fr.headers.get('content-type'), 'image/jpeg');
    assert.equal(fr.headers.get('x-screens'), '2');
    assert.deepEqual(Buffer.from(await fr.arrayBuffer()), jpeg);
    assert.equal((await call('/api/screen/frame?after=0')).status, 401);
    const ag2 = await (await call('/api/screen/agent', { method: 'POST', body: '', headers: { 'X-Key': skey } })).json();
    assert.deepEqual(ag2.events, [{ t: 'move', x: 1, y: 0.5 }, { t: 'text', s: 'hi' }]);
    const shopList = await (await auth('/api/shop', { method: 'POST', body: JSON.stringify({ text: 'Eier' }) })).json();
    assert.ok(shopList.some((i) => i.summary === 'Eier'));
    // Siri schreibt Schul-Kürzel aus
    const td = new Date(); const tdIso = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}`;
    await auth('/api/items/events', { method: 'POST', body: JSON.stringify({ title: 'SchA Mathe und PLN Physik', date: tdIso }) });
    assert.match(await (await call(`/api/summary?day=heute&key=${widget}`)).text(), /Schulaufgabe Mathe und praktischer Leistungsnachweis Physik/);
    assert.equal((await call('/api/summary?day=morgen&key=falsch')).status, 401);
    assert.equal((await auth('/api/messages', { method: 'POST', body: JSON.stringify({ to: ['unbekannt'], text: 'Hallo' }) })).status, 400);
    assert.equal((await auth('/api/messages', { method: 'POST', body: JSON.stringify({ to: [d2.snap.people[0].id], text: 'Hallo' }) })).status, 200);
    // Kalender: beliebige Woche ab Montag nachladen
    assert.equal((await auth('/api/week?start=2026-11-17')).status, 400); // kein Montag
    assert.equal((await (await auth('/api/week?start=2026-11-23')).json()).days.length, 5);
    // Gefällt mir und Lesebestätigung (Demo: ohne EduPage), Zähler und Bestätigung kommen zurück
    assert.equal((await auth('/api/messages/m1/like', { method: 'POST', body: JSON.stringify({ liked: true }) })).status, 200);
    assert.equal((await auth('/api/messages/m2/confirm', { method: 'POST', body: '{}' })).status, 200);
    const d3 = await (await auth('/api/data')).json();
    assert.deepEqual([d3.snap.messages.find((m) => m.id === 'm1').liked, d3.snap.messages.find((m) => m.id === 'm1').likes], [true, 4]);
    assert.ok(d3.snap.messages.find((m) => m.id === 'm2').confirmed);
    const tp = await (await auth(`/api/teacher/${encodeURIComponent(d2.snap.people[0].id)}`)).json();
    assert.ok(Array.isArray(tp.lessons));
    // wiederkehrender Termin wird mit Regel gespeichert
    const ev = await (await auth('/api/items/events', { method: 'POST', body: JSON.stringify({ title: 'Training', date: '2026-11-17', repeat: 'weekly', until: '2026-12-31' }) })).json();
    assert.deepEqual([ev.repeat, ev.until], ['weekly', '2026-12-31']);
    assert.equal((await (await auth('/api/items/events', { method: 'POST', body: JSON.stringify({ title: 'X', date: '2026-11-17', repeat: 'stündlich' }) })).json()).repeat, '');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'origin.json'), 'utf8')), `http://localhost:${port}`);
    assert.equal((await call('/api/push/subscribe', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ endpoint: 'http://x' }) })).status, 400);

    // HTML nie in public/: Plesk würde sie an der App vorbei ausliefern (ohne Look, Impressum-Angaben und CSP)
    assert.ok(!fs.readdirSync(path.join(__dirname, 'public')).some((f) => f.endsWith('.html')));
    // statische Dateien, kein Ausbruch aus public/
    const index = await call('/');
    const indexHtml = await index.text();
    assert.ok(indexHtml.includes('<title>Alltag</title>') && !indexHtml.includes('data-skin')); // private App: Liquid Glass
    assert.ok(index.headers.get('content-security-policy'));
    assert.equal((await call('/..%2fapp.js')).status, 404);
    assert.equal((await call('/data/secret.json')).status, 404);
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 6. Öffentliche Version mit Konten: Einladungscodes, getrennte Daten, keine privaten Funktionen
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'alltag-konten-'));
  const port2 = port + 100;
  const srv2 = spawn(process.execPath, ['app.js'], { cwd: __dirname, env: { ...process.env, ENV_FILE: '', DEMO: '', PRIVATE: '', ACCOUNTS: '1', APP_PASSWORD: 'start-code', DATA_KEY: 'k'.repeat(40), LEGAL_NAME: 'Max <Muster>', LEGAL_EMAIL: '', DATA_DIR: dir2, PORT: String(port2) }, stdio: 'pipe' });
  try {
    await new Promise((resolve, reject) => { srv2.stdout.on('data', (b) => String(b).includes('läuft') && resolve()); srv2.on('exit', reject); });
    const call = (p, o = {}, cookie) => fetch(`http://localhost:${port2}${p}`, { ...o, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...o.headers } });
    const post = (p, body, cookie) => call(p, { method: 'POST', body: JSON.stringify(body) }, cookie);
    const ck = (r) => r.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await call('/api/info')).json(), { demo: false, accounts: true, setup: true });
    assert.ok((await (await call('/')).text()).includes('<html lang="de" data-skin="modern">')); // öffentliche Version: eigener Look
    const imp = await (await call('/impressum.html')).text(); // Angaben aus Plesk-Variablen, sicher eingesetzt; fehlende sichtbar markiert
    assert.ok(imp.includes('Max &#60;Muster&#62;') && imp.includes('noch eintragen: LEGAL_EMAIL') && !imp.includes('{{'));
    assert.ok((await (await call('/datenschutz.html')).text()).includes('PEIN GbR'));
    assert.equal((await post('/api/register', { name: 'chef', password: 'geheim123', code: 'falsch', school: 'edupage' })).status, 403);
    const r1 = await post('/api/register', { name: 'Chef', password: 'geheim123', code: ' start-code ', school: 'edupage' }); // Leerzeichen egal
    assert.equal(r1.status, 200);
    const c1 = ck(r1);
    const d1 = await (await call('/api/data', {}, c1)).json();
    assert.deepEqual([d1.account.name, d1.account.admin, d1.features.ha, d1.features.screen], ['chef', true, false, false]);
    assert.equal((await post('/api/register', { name: 'zweiter', password: 'geheim123', code: 'start-code', school: 'none' })).status, 403); // Startcode nur fürs erste Konto
    const code = (await (await post('/api/admin/invites', { note: 'Ben' }, c1)).json()).invites[0].code;
    assert.match(code, /^\d{6}$/);
    assert.equal((await post('/api/register', { name: 'ben', password: 'kurz', code, school: 'none' })).status, 400);
    const r2 = await post('/api/register', { name: 'ben', password: 'passwort-ben', code: `${code.slice(0, 3)} ${code.slice(3)}`, school: 'none' }); // Leerzeichen egal
    assert.equal(r2.status, 200);
    const c2 = ck(r2);
    assert.equal((await post('/api/register', { name: 'ben2', password: 'passwort-ben', code, school: 'none' })).status, 403); // Code verbraucht
    // jedes Konto sieht nur seine eigenen Daten
    await post('/api/items/notes', { title: 'Nur für Ben' }, c2);
    assert.ok(!(await (await call('/api/data', {}, c1)).json()).db.notes.some((n) => n.title === 'Nur für Ben'));
    assert.ok((await (await call('/api/data', {}, c2)).json()).db.notes.some((n) => n.title === 'Nur für Ben'));
    // ohne Schulsoftware: eigener Stundenplan, jede Woche gleich (Montag weit in der Zukunft, damit keine Ferien stören)
    const far = new Date(); far.setFullYear(far.getFullYear() + 3); far.setDate(far.getDate() - ((far.getDay() + 6) % 7));
    assert.equal((await post('/api/items/lessons', { day: 1, start: '8:00', end: '08:45', subject: 'Mathe' }, c2)).status, 400); // Uhrzeit ungültig
    await post('/api/items/lessons', { day: 1, start: '08:00', end: '08:45', subject: 'Mathe', room: '104', teacher: 'Hr. Graf' }, c2);
    const wk = await (await call(`/api/week?start=${isoDay(far)}`, {}, c2)).json();
    assert.deepEqual([wk.days.length, wk.days[0].lessons[0].subject, wk.days[0].lessons[0].rooms[0], wk.days[1].lessons.length], [5, 'Mathe', '104', 0]);
    assert.equal((await post('/api/edupage', {}, c2)).status, 400);
    // Rechte: Ben ist kein Admin; Home Assistant und PC-Bildschirm gibt es hier nicht
    assert.equal((await call('/api/admin', {}, c2)).status, 403);
    assert.equal((await call('/api/ha/pc', {}, c1)).status, 404);
    assert.equal((await call('/api/screen/frame?after=0', {}, c1)).status, 404);
    const t2 = await (await call('/api/tokens', {}, c2)).json();
    assert.ok(t2.widget && !t2.cron && !t2.screen);
    assert.equal((await (await call(`/api/data?key=${t2.widget}`)).json()).account.name, 'ben'); // Widget-Schlüssel gehört zu genau einem Konto
    // Anmelden; Passwort ändern meldet andere Geräte ab
    assert.equal((await post('/api/login', { name: 'ben', password: 'falsch' })).status, 401);
    const l2 = await post('/api/login', { name: 'BEN', password: 'passwort-ben' });
    assert.equal(l2.status, 200);
    const pw = await post('/api/account', { old: 'passwort-ben', password: 'neues-passwort' }, c2);
    assert.equal(pw.status, 200);
    assert.equal((await call('/api/data', {}, ck(l2))).status, 401);
    const c2b = ck(pw);
    assert.equal((await call('/api/data', {}, c2b)).status, 200);
    // Admin sperrt Ben (Sitzung endet sofort), dann Löschen samt Datenordner
    const benId = (await (await call('/api/admin', {}, c1)).json()).accounts.find((a) => a.name === 'ben').id;
    await post(`/api/admin/accounts/${benId}`, { disabled: true }, c1);
    assert.equal((await call('/api/data', {}, c2b)).status, 401);
    assert.equal((await post('/api/login', { name: 'ben', password: 'neues-passwort' })).status, 403);
    assert.ok(fs.existsSync(path.join(dir2, 'users', benId)));
    assert.equal((await call(`/api/admin/accounts/${benId}`, { method: 'DELETE' }, c1)).status, 200);
    assert.ok(!fs.existsSync(path.join(dir2, 'users', benId)));
    assert.equal((await call(`/api/admin/accounts/${d1.account.id}`, { method: 'DELETE' }, c1)).status, 400); // sich selbst nicht
    // Demo-Konto: Admin stellt ein Konto über die Support-ID auf Demo; Besucher kommen ohne Passwort hinein und können nichts Dauerhaftes ändern
    assert.equal((await post('/api/demo', {})).status, 404);
    const code2 = (await (await post('/api/admin/invites', { note: 'Demo' }, c1)).json()).invites.find((i) => !i.usedBy).code;
    assert.equal((await post('/api/register', { name: 'demo', password: 'beispiel-zugang', code: code2, school: 'edupage' })).status, 200);
    const dem = (await (await call('/api/admin', {}, c1)).json()).accounts.find((a) => a.name === 'demo');
    assert.match(dem.support, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.equal((await post(`/api/admin/accounts/${d1.account.id}`, { demo: true }, c1)).status, 400); // Admin-Konto nicht
    assert.equal((await post(`/api/admin/accounts/${dem.id}`, { demo: true }, c1)).status, 200);
    assert.equal((await (await call('/api/info')).json()).demo, true);
    const cd = ck(await post('/api/demo', {}));
    const dd = await (await call('/api/data', {}, cd)).json();
    assert.ok(dd.demo && dd.account.demo && dd.snap.messages.length && dd.db.reminders.length && !dd.features.photos && !dd.features.push);
    assert.equal((await post('/api/account', { old: 'beispiel-zugang', password: 'gekapert-123' }, cd)).status, 400);
    assert.equal((await call('/api/account', { method: 'DELETE', body: JSON.stringify({ password: 'beispiel-zugang' }) }, cd)).status, 400);
    assert.equal((await post('/api/push/subscribe', { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } }, cd)).status, 400);
    // Jugend forscht Version: alles frei, Daten bleiben bis zum Zurücksetzen durch den Admin
    await post(`/api/admin/accounts/${dem.id}`, { jury: true }, c1);
    const dj = await (await call('/api/data', {}, cd)).json();
    assert.ok(dj.account.jury && dj.features.photos && dj.features.push);
    const nn = await (await post('/api/items/notes', { title: 'Von der Jury' }, cd)).json();
    assert.ok((await (await call('/api/data', {}, cd)).json()).db.notes.some((n) => n.id === nn.id));
    await post(`/api/admin/accounts/${dem.id}`, { resetDemo: true }, c1);
    assert.ok(!(await (await call('/api/data', {}, cd)).json()).db.notes.some((n) => n.id === nn.id));
    assert.equal((await post(`/api/admin/accounts/${d1.account.id}`, { jury: true }, c1)).status, 400); // nur Demo-Konten
    assert.equal((await post(`/api/admin/accounts/${dem.id}`, { demo: false }, c1)).status, 200);
    assert.equal((await call('/api/data', {}, cd)).status, 401); // Demo beendet: Besucher-Sitzungen enden
    assert.equal((await post('/api/demo', {})).status, 404);
    // Sicherheit: fremde Seiten dürfen nichts ändern, zu einfache Passwörter gibt es nicht
    assert.equal((await call('/api/items/notes', { method: 'POST', body: '{}', headers: { Origin: 'https://boese.example' } }, c1)).status, 403);
    assert.equal((await call('/api/items/notes', { method: 'POST', body: JSON.stringify({ title: 'x' }), headers: { Origin: `http://localhost:${port2}` } }, c1)).status, 200);
    const code3 = (await (await post('/api/admin/invites', {}, c1)).json()).invites.find((i) => !i.usedBy).code;
    assert.equal((await post('/api/register', { name: 'lea', password: '12345678', code: code3, school: 'none' })).status, 400);
    // Flyer: mehrere Codes auf einmal, 30 Tage gültig
    const fl = await (await post('/api/admin/invites', { count: 3, days: 30, note: 'Flyer Test' }, c1)).json();
    assert.equal(fl.created.length, 3);
    const flDays = (Date.parse(fl.invites.find((i) => i.code === fl.created[0]).expires) - Date.now()) / 864e5;
    assert.ok(flDays > 29.9 && flDays <= 30);
    const fl90 = await (await post('/api/admin/invites', { count: 1, days: 90, note: 'Flyer Lang' }, c1)).json();
    assert.ok((Date.parse(fl90.invites.find((i) => i.code === fl90.created[0]).expires) - Date.now()) / 864e5 > 89.9);
    const fl999 = await (await post('/api/admin/invites', { count: 1, days: 999 }, c1)).json(); // unbekannte Dauer → 7 Tage
    assert.ok((Date.parse(fl999.invites.find((i) => i.code === fl999.created[0]).expires) - Date.now()) / 864e5 <= 7);
    assert.equal((await call('/flyer.mjs')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    // Sammelcode für Flyer: ein Code für mehrere Anmeldungen, danach geschlossen
    const sc = await (await post('/api/admin/invites', { uses: 2, days: 90, note: 'Flyer Sammel' }, c1)).json();
    assert.equal(sc.created.length, 1);
    const scode = sc.created[0];
    for (const n of ['flyer-a', 'flyer-b']) assert.equal((await post('/api/register', { name: n, password: 'gruene-wiese-9', code: scode, school: 'none' })).status, 200);
    assert.equal((await post('/api/register', { name: 'flyer-c', password: 'gruene-wiese-9', code: scode, school: 'none' })).status, 403);
    const scInv = (await (await call('/api/admin', {}, c1)).json()).invites.find((i) => i.code === scode);
    assert.deepEqual([scInv.usedCount, scInv.uses, scInv.open, 'used' in scInv], [2, 2, false, false]); // Liste der Konten bleibt auf dem Server
    assert.ok((await (await call('/admin')).text()).includes('data-skin="modern"')); // Verwaltung als eigene Seite
    // Codes laufen nach 7 Tagen ab
    const code4 = (await (await post('/api/admin/invites', { note: 'alt' }, c1)).json()).invites.find((i) => !i.usedBy && i.note === 'alt').code;
    const invFile = path.join(dir2, 'invites.json');
    fs.writeFileSync(invFile, JSON.stringify(JSON.parse(fs.readFileSync(invFile, 'utf8')).map((i) => (i.code === code4 ? { ...i, created: new Date(Date.now() - 8 * 864e5).toISOString() } : i))));
    assert.equal((await post('/api/register', { name: 'zu-spaet', password: 'gruene-wiese-8', code: code4, school: 'none' })).status, 403);
    assert.ok((await (await call('/api/admin', {}, c1)).json()).invites.find((i) => i.code === code4).open === false);
    assert.equal((await post('/api/register', { name: 'leander', password: 'xxleanderxx', code: code3, school: 'none' })).status, 400);
    // Widget-Schlüssel erneuern: der alte gilt sofort nicht mehr
    const w1 = (await (await call('/api/tokens', {}, c1)).json()).widget;
    assert.equal((await call(`/api/summary?key=${w1}`)).status, 200);
    await post('/api/tokens/widget', {}, c1);
    assert.equal((await call(`/api/summary?key=${w1}`)).status, 401);
    // Auf anderen Geräten abmelden: dieses Gerät bleibt angemeldet
    const other = ck(await post('/api/login', { name: 'chef', password: 'geheim123' }));
    const keep = ck(await post('/api/account', { logoutOthers: true }, c1));
    assert.deepEqual([(await call('/api/data', {}, other)).status, (await call('/api/data', {}, keep)).status], [401, 200]);
    // Raten bremst nur das angegriffene Konto (auch bei wechselnden Geräten), nicht alle anderen
    for (let i = 0; i < 10; i++) await call('/api/login', { method: 'POST', body: JSON.stringify({ name: 'chef', password: `falsch${i}` }), headers: { 'X-Real-IP': `10.0.0.${i}` } });
    assert.equal((await post('/api/login', { name: 'chef', password: 'geheim123' })).status, 429);
    const lena = ck(await post('/api/register', { name: 'lena', password: 'gruene-wiese-7', code: code3, school: 'none' }));
    assert.equal((await call('/api/data', {}, lena)).status, 200);
    assert.equal((await post('/api/login', { name: 'lena', password: 'gruene-wiese-7' })).status, 200);
  } finally {
    srv2.kill();
    fs.rmSync(dir2, { recursive: true, force: true });
  }
  // 7. ZIP für die Flyer: Kopf, Inhaltsverzeichnis, Abschluss mit Anzahl und Prüfsumme
  const { zip } = await import(require('url').pathToFileURL(path.join(__dirname, 'public', 'flyer.mjs')).href);
  const zbuf = Buffer.from(await zip([{ name: 'a.txt', data: Buffer.from('Hallo') }, { name: 'b.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) }]).arrayBuffer());
  assert.equal(zbuf.readUInt32LE(0), 0x04034b50);
  assert.equal(zbuf.readUInt32LE(zbuf.length - 22), 0x06054b50);
  assert.equal(zbuf.readUInt16LE(zbuf.length - 12), 2);
  if (require('zlib').crc32) assert.equal(zbuf.readUInt32LE(14), require('zlib').crc32(Buffer.from('Hallo')));
  assert.equal(zbuf.subarray(35, 40).toString(), 'Hallo'); // 30 Byte Kopf + 5 Byte Name

  // Druck-PDF: zwei Seiten A6 mit Beschnitt, Querverweise (xref) zeigen genau auf die Objekte
  const { pdf } = await import(require('url').pathToFileURL(path.join(__dirname, 'public', 'flyer.mjs')).href);
  const pbuf = Buffer.from(await pdf([{ data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), w: 2, h: 2 }, { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), w: 2, h: 2 }]).arrayBuffer());
  const ptxt = pbuf.toString('latin1'), xrefAt = Number(ptxt.match(/startxref\n(\d+)/)[1]);
  assert.ok(ptxt.startsWith('%PDF-1.4') && ptxt.slice(xrefAt).startsWith('xref') && /\/Count 2/.test(ptxt) && /\/TrimBox \[8\.50 8\.50 306\.14 428\.03\]/.test(ptxt));
  [...ptxt.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].forEach(([, off], i) => assert.ok(ptxt.startsWith(`${i + 1} 0 obj`, Number(off))));

  // 8. Mit Konten startet der Server nicht ohne ausreichend langen DATA_KEY
  const noKey = spawn(process.execPath, ['app.js'], { cwd: __dirname, env: { ...process.env, ENV_FILE: '', DEMO: '', ACCOUNTS: '1', APP_PASSWORD: 'x', DATA_KEY: 'kurz', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'alltag-ohne-')), PORT: String(port + 200) }, stdio: 'pipe' });
  assert.equal(await new Promise((r) => noKey.on('exit', r)), 1);
  console.log('alle Tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
