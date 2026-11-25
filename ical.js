'use strict';
// Private Kalender (Google, iCloud, Outlook …) über ihren iCalendar-Link: abrufen (nur öffentliche Adressen),
// lesen (RFC 5545, das Nötige) und Wiederholungen in Berliner Ortszeit ausrechnen. Keine Pakete.
const dns = require('dns').promises;
const net = require('net');
const https = require('https');

const ZONE = 'Europe/Berlin';
const WIN_TZ = { 'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'GMT Standard Time': 'Europe/London', 'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles', UTC: 'UTC' }; // Outlook-Namen
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/* ---------------------------------------------------------------- Lesen */
const unfold = (text) => String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
const unesc = (v) => v.replace(/\\([\\;,nN])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
function prop(line) { // NAME;PARAM=WERT:INHALT – Doppelpunkte in Anführungszeichen gehören zum Parameter
  let q = false, i = 0;
  for (; i < line.length; i++) { if (line[i] === '"') q = !q; else if (line[i] === ':' && !q) break; }
  const [name, ...ps] = line.slice(0, i).split(';');
  const params = Object.fromEntries(ps.map((p) => { const j = p.indexOf('='); return [p.slice(0, j).toUpperCase(), p.slice(j + 1).replace(/^"|"$/g, '')]; }));
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}
function zoneOf(tzid) {
  const z = WIN_TZ[tzid] || tzid || '', tail = /([A-Za-z_]+\/[A-Za-z_+-]+)$/.exec(z)?.[1]; // „/mozilla.org/…/Europe/Berlin“
  for (const c of [z, tail]) { try { if (c) { new Intl.DateTimeFormat('en', { timeZone: c }); return c; } } catch { /* unbekannt */ } }
  return null; // ohne Zone: Zeit gilt so, wie sie dasteht
}
function when(value, params = {}) { // DATE oder DATE-TIME (UTC mit Z, mit TZID oder „floating“)
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, z] = m;
  if (h === undefined || params.VALUE === 'DATE') return { y: +y, mo: +mo, d: +d, allDay: true };
  return { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, tz: z ? 'UTC' : zoneOf(params.TZID) };
}
const minutes = (v) => { const m = /^[+-]?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(v) || []; return (+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0); };

function parseIcs(text) {
  const events = [];
  let ev = null, depth = 0;
  for (const line of unfold(text).split('\n')) {
    if (!line.trim()) continue;
    const p = prop(line), v = p.value.toUpperCase();
    if (!ev) { if (p.name === 'BEGIN' && v === 'VEVENT') ev = { exdates: [] }; continue; }
    if (p.name === 'BEGIN') { depth++; continue; } // Erinnerungen (VALARM) usw. überspringen
    if (p.name === 'END') { if (depth) depth--; else if (v === 'VEVENT') { if (ev.start) events.push(ev); ev = null; } continue; }
    if (depth) continue;
    if (p.name === 'UID') ev.uid = p.value;
    else if (p.name === 'SUMMARY') ev.title = unesc(p.value).trim().slice(0, 200);
    else if (p.name === 'LOCATION') ev.location = unesc(p.value).trim().slice(0, 200);
    else if (p.name === 'DTSTART') ev.start = when(p.value, p.params);
    else if (p.name === 'DTEND') ev.end = when(p.value, p.params);
    else if (p.name === 'DURATION') ev.duration = minutes(p.value);
    else if (p.name === 'RRULE') ev.rrule = Object.fromEntries(p.value.split(';').map((x) => x.split('=')).map(([k, x]) => [k.toUpperCase(), x || '']));
    else if (p.name === 'EXDATE') for (const x of p.value.split(',')) { const t = when(x, p.params); if (t) ev.exdates.push(t); }
    else if (p.name === 'RECURRENCE-ID') ev.recurrenceId = when(p.value, p.params);
    else if (p.name === 'STATUS') ev.cancelled = v === 'CANCELLED';
  }
  return events;
}

/* ---------------------------------------------------------------- Zeitzonen */
const fmts = new Map();
function wallIn(ms, tz) { // Zeitpunkt → Wanduhr in tz
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })));
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
const wallUtc = (ms) => { const x = new Date(ms); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes() }; };
function ms(t) { // Wanduhr (in t.tz) → Zeitpunkt; ganztägig und „floating“ zählen wie UTC
  const guess = Date.UTC(t.y, t.mo - 1, t.d, t.h || 0, t.mi || 0);
  if (t.allDay || !t.tz || t.tz === 'UTC') return guess;
  let x = guess;
  for (let i = 0; i < 2; i++) { const w = wallIn(x, t.tz); x += guess - Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi); }
  return x;
}
const shift = (t, min) => (t.tz ? wallIn(ms(t) + min * 60e3, ZONE) : wallUtc(ms(t) + min * 60e3)); // Ende in Berliner Zeit
const local = (t) => (t.tz && t.tz !== ZONE ? wallIn(ms(t), ZONE) : t);

/* ---------------------------------------------------------------- Wiederholungen */
const pad = (n) => String(n).padStart(2, '0');
const iso = (t) => `${t.y}-${pad(t.mo)}-${pad(t.d)}`;
const hm = (t) => `${pad(t.h)}:${pad(t.mi)}`;
const plusDays = (t, n) => { const x = new Date(Date.UTC(t.y, t.mo - 1, t.d + n)); return { ...t, y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const weekday = (t) => new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay();

function* occurrences(ev, from, to) { // Starts in der Zone des Termins, von DTSTART bis höchstens „to“
  const s = ev.start, r = ev.rrule;
  if (!r) { yield s; return; }
  const n = Math.max(1, Math.trunc(+r.INTERVAL) || 1), count = Math.trunc(+r.COUNT) || Infinity, until = r.UNTIL ? when(r.UNTIL) : null;
  const untilMs = until ? (until.allDay ? Date.UTC(until.y, until.mo - 1, until.d, 23, 59) : ms(until)) : Infinity;
  const byday = (r.BYDAY || '').split(',').map((x) => /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim())).filter(Boolean).map((m) => ({ n: +m[1] || 0, wd: DAYS.indexOf(m[2]) }));
  const bymd = (r.BYMONTHDAY || '').split(',').map(Number).filter(Boolean);
  // ohne COUNT gleich in die Nähe des Zeitfensters springen (tägliche Termine seit Jahren)
  const gap = (Date.parse(`${from}T00:00Z`) - Date.UTC(s.y, s.mo - 1, s.d)) / 864e5;
  const per = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[r.FREQ];
  if (!per) { yield s; return; }
  const i0 = count === Infinity && gap > 0 ? Math.max(0, Math.floor(gap / per / n) - 1) : 0;
  let made = 0;
  for (let i = i0; i < i0 + 3000; i++) {
    let c = [];
    if (r.FREQ === 'DAILY') c = [plusDays(s, i * n)];
    else if (r.FREQ === 'WEEKLY') {
      const monday = plusDays(s, i * 7 * n - ((weekday(s) + 6) % 7));
      c = byday.length ? byday.map((b) => plusDays(monday, (b.wd + 6) % 7)) : [plusDays(s, i * 7 * n)];
    } else if (r.FREQ === 'MONTHLY') {
      const first = new Date(Date.UTC(s.y, s.mo - 1 + i * n, 1)), base = { ...s, y: first.getUTCFullYear(), mo: first.getUTCMonth() + 1, d: 1 };
      const last = new Date(Date.UTC(base.y, base.mo, 0)).getUTCDate();
      if (byday.length) {
        c = byday.flatMap((b) => {
          const all = [];
          for (let d = 1; d <= last; d++) if (weekday({ ...base, d }) === b.wd) all.push({ ...base, d });
          return b.n > 0 ? [all[b.n - 1]] : b.n < 0 ? [all[all.length + b.n]] : all;
        }).filter(Boolean);
      } else c = (bymd.length ? bymd : [s.d]).map((d) => (d < 0 ? last + d + 1 : d)).filter((d) => d >= 1 && d <= last).map((d) => ({ ...base, d }));
    } else {
      const y = s.y + i * n;
      if (s.d <= new Date(Date.UTC(y, s.mo, 0)).getUTCDate()) c = [{ ...s, y }]; // 29.2. nur in Schaltjahren
    }
    c.sort((a, b) => ms(a) - ms(b));
    for (const o of c) {
      if (ms(o) < ms(s)) continue;
      if (ms(o) > untilMs || made >= count || iso(o) > to) return;
      made++;
      yield o;
    }
  }
}

// Alle Termine zwischen „from“ und „to“ (YYYY-MM-DD, Berliner Datum) als flache Liste, ganztägige über mehrere Tage je Tag einmal
function expand(events, from, to, max = 1500) {
  const moved = new Map(); // uid → Startzeitpunkte, die eine Ausnahme (RECURRENCE-ID) ersetzt
  for (const e of events) if (e.recurrenceId && e.uid) moved.set(e.uid, [...(moved.get(e.uid) || []), ms(e.recurrenceId)]);
  const out = [];
  for (const e of events) {
    if (e.cancelled || !e.start || out.length >= max) continue;
    const skip = new Set([...e.exdates.map(ms), ...(e.rrule && !e.recurrenceId ? moved.get(e.uid) || [] : [])]);
    const len = e.end ? Math.max(0, (ms(e.end) - ms(e.start)) / 60e3) : e.duration ?? (e.start.allDay ? 1440 : 0);
    const base = { title: e.title || 'Termin', location: e.location || '' };
    for (const o of occurrences(e, from, to)) {
      if (skip.has(ms(o))) continue;
      if (o.allDay) {
        for (let k = 0; k < Math.max(1, Math.round(len / 1440)); k++) {
          const d = iso(plusDays(o, k));
          if (d >= from && d <= to) out.push({ ...base, date: d, start: '', end: '' });
        }
      } else {
        const a = local(o), b = shift(o, len), d = iso(a);
        if (d >= from && d <= to) out.push({ ...base, date: d, start: hm(a), end: len && iso(b) === d ? hm(b) : '' });
      }
      if (out.length >= max) break;
    }
  }
  return out.sort((x, y) => `${x.date} ${x.start}`.localeCompare(`${y.date} ${y.start}`));
}

/* ---------------------------------------------------------------- Abrufen: nur öffentliche Server (kein Zugriff aufs eigene Netz) */
const BLOCK4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]];
const n4 = (ip) => ip.split('.').reduce((a, b) => a * 256 + +b, 0);
function publicIp(ip) {
  if (net.isIPv4(ip)) return !BLOCK4.some(([b, bits]) => Math.floor(n4(ip) / 2 ** (32 - bits)) === Math.floor(n4(b) / 2 ** (32 - bits)));
  if (!net.isIPv6(ip)) return false;
  const v = ip.toLowerCase(), mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return publicIp(mapped[1]);
  return !(v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || v.startsWith('::ffff:') || v.startsWith('64:ff9b:'));
}
async function fetchIcs(raw, hops = 0) {
  let url;
  try { url = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch { throw new Error('Das ist keine gültige Adresse.'); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username) throw new Error('Nur Kalender-Links mit https:// oder webcal:// gehen.');
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('Diesen Server gibt es nicht.');
  if (!addrs.every((a) => publicIp(a.address))) throw new Error('Diese Adresse ist nicht erlaubt.');
  const { address, family } = addrs[0]; // geprüfte Adresse festhalten, damit DNS sie nicht nachträglich umbiegt
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000, headers: { 'User-Agent': 'Alltag-Kalender/1.0', Accept: 'text/calendar, */*' },
      lookup: (h, o, cb) => (o?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return hops < 3 ? resolve(fetchIcs(new URL(res.headers.location, url).href, hops + 1)) : reject(new Error('Zu viele Weiterleitungen.'));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Der Kalender antwortet nicht (Fehler ${res.statusCode}). Ist der Link noch gültig?`)); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 3e6) { req.destroy(); reject(new Error('Der Kalender ist zu groß (über 3 MB).')); } else chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!/BEGIN:VCALENDAR/i.test(text)) return reject(new Error('Unter diesem Link liegt kein Kalender.'));
        resolve(text);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Der Kalender antwortet nicht rechtzeitig.')));
    req.on('error', (e) => reject(/antwortet|groß/.test(e.message) ? e : new Error('Der Kalender ist nicht erreichbar.')));
  });
}

module.exports = { parseIcs, expand, fetchIcs, publicIp };
