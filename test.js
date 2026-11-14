'use strict';
// Selbsttest ohne EduPage-Zugang:  node test.js
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Edupage, snapshot, encodeRequestBody, decodeResponse, parseHome, parseSubstHtml, affects } = require('./edupage');

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

  // 3. Vertretungsplan-HTML (Aufbau wie getSubstViewerDayDataHtml)
  const sec = (cls, rows) => `</div><div class="section print-nobreak"><div class="header"><span class="print-font-resizable">${cls}</span><div class="rows">${rows}</div></div>`;
  const row = (a, n, t) => `<div class="row ${a}"><div class="period"><span class="print-font-resizable">${n}</span></div><div class="info"><span class="print-font-resizable">${t}</span></div></div>`;
  const subst = parseSubstHtml(`<div>${sec('7.A', row('remove', '3', 'Mathematik – Entfall') + row('change', '5 - 6', 'Physik: Hr. X ➔ Fr. Y'))}${sec('8.B', row('add', '1', 'Zusatz'))}`);
  assert.deepEqual(subst.map((s) => [s.cls, s.periods, s.title, s.action]), [
    ['7.A', [3], 'Mathematik – Entfall', 'remove'], ['7.A', [5, 6], 'Physik: Hr. X ➔ Fr. Y', 'change'], ['8.B', [1], 'Zusatz', 'add']]);
  assert.ok(affects('7.A, 7.B', ['7.B']) && affects('7.A - Gruppe 1', ['7.A']) && !affects('7.AB', ['7.A']));

  // 4. Snapshot aus nachgebauten EduPage-Daten
  const ep = new Edupage('schule');
  ep.data = {
    userid: 'Student42',
    dbi: {
      students: { 42: { firstname: 'Max', lastname: 'M', classid: '7' } }, classes: { 7: { name: '7.A', short: '7A' } },
      subjects: { 1: { name: 'Mathematik', short: 'M' } }, teachers: { 9: { firstname: 'Bea', lastname: 'Becker' } }, classrooms: { 5: { name: '104', short: '104' } },
    },
    items: [
      { timelineid: '1', typ: 'homework', text: 'S. 12', timestamp: '2026-11-15 10:00:00', cas_udalosti: '2026-11-17 00:00:00', data: '{"predmetid":"1"}', vlastnik_meno: 'Fr. X' },
      { timelineid: '2', typ: 'sprava', text: '', timestamp: '2026-11-15 11:00:00', data: '{"messageContent":"Hallo","attachements":{"/x/a.pdf":"a.pdf"}}', vlastnik_meno: 'Fr. X' },
      { timelineid: '3', typ: 'sprava', text: 'Antwort', timestamp: '2026-11-15 12:00:00', data: '', reakcia_na: '2', vlastnik_meno: 'Max M' },
      { timelineid: '4', typ: 'homework', text: 'uralt', timestamp: '2020-01-01 10:00:00', data: '{}', vlastnik_meno: 'Fr. X' },
      { timelineid: '5', typ: 'homework', text: 'weg', timestamp: '2026-11-15 10:00:00', data: '{}', removed: '1' },
    ],
    userProps: { 1: { doneMaxCas: '2026-11-15 13:00:00' } },
  };
  ep.plan = async () => [{ uniperiod: '3', starttime: '09:45', endtime: '10:30', subjectid: '1', teacherids: ['9'], classroomids: ['5'], groupnames: [''], type: 'card' },
    { header: [] }, { uniperiod: '4', starttime: '10:35', endtime: '11:20', subjectid: '1', type: 'absent' }];
  ep.substitutions = async () => subst;
  const snap = await snapshot(ep, { school: 'schule', now: new Date(2026, 10, 16, 8) });
  assert.deepEqual(snap.errors, []);
  assert.deepEqual(snap.student, { name: 'Max M', class: '7.A' });
  assert.equal(snap.days.length, 5); // Mo–Fr innerhalb von 7 Tagen
  const d0 = snap.days[0];
  assert.equal(d0.changes.length, 2, 'nur Vertretungen der eigenen Klasse');
  assert.deepEqual(d0.lessons.map((l) => [l.subject, l.teachers[0], l.rooms[0], l.cancelled, l.changes]), [
    ['Mathematik', 'Bea Becker', '104', false, ['Mathematik – Entfall']], ['Mathematik', undefined, undefined, true, []]]);
  assert.deepEqual(snap.tasks.map((t) => [t.title, t.subject, t.due, t.done]), [['S. 12', 'Mathematik', '2026-11-17', true]]);
  assert.equal(snap.messages.length, 1);
  assert.equal(snap.messages[0].text, 'Hallo');
  assert.equal(snap.messages[0].replies[0].text, 'Antwort');
  assert.equal(snap.messages[0].attachments[0].url, 'https://schule.edupage.org/x/a.pdf');

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
