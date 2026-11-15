'use strict';
// Selbsttest ohne EduPage-Zugang:  node test.js
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Edupage, snapshot, encodeRequestBody, decodeResponse, parseHome } = require('./edupage');

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
  const srv = spawn(process.execPath, ['app.js'], { cwd: __dirname, env: { ...process.env, DEMO: '1', DATA_DIR: dir, PORT: String(port) }, stdio: 'pipe' });
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

    // statische Dateien, kein Ausbruch aus public/
    const index = await call('/');
    assert.ok((await index.text()).includes('<title>Alltag</title>'));
    assert.ok(index.headers.get('content-security-policy'));
    assert.equal((await call('/..%2fapp.js')).status, 404);
    assert.equal((await call('/data/secret.json')).status, 404);
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('alle Tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
