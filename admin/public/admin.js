'use strict';
/* Alltag – Verwaltung (admin.alltag-app.de). Spricht nur mit der Admin-API der App: CORS mit deren Sitzungs-Cookie.
   Anmelden läuft über die App (/admin → Konto-Dienst → zurück hierher). Bereiche über die Adresse (#konten …). */
const API = document.querySelector('meta[name="api"]').content;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const F = {
  short: new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }),
  full: new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
  rel: new Intl.RelativeTimeFormat('de', { numeric: 'auto' }),
  num: new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
};
function ago(iso) {
  if (!iso) return 'noch nie';
  const s = (new Date(iso) - Date.now()) / 1000, a = Math.abs(s);
  if (a < 60) return 'gerade eben';
  if (a < 3600) return F.rel.format(Math.round(s / 60), 'minute');
  if (a < 86400) return F.rel.format(Math.round(s / 3600), 'hour');
  return F.rel.format(Math.round(s / 86400), 'day');
}
const schoolName = (k) => ({ edupage: 'EduPage', untis: 'WebUntis', schulmanager: 'Schulmanager', none: 'Ohne Schulsoftware' })[k] || k;
const shownCode = (c) => String(c).replace(/^(\d{3})(\d{3})$/, '$1 $2'); // 482 913 liest sich leichter vor
const euro = (n) => (n ? `${n.toFixed(2).replace('.', ',')} €` : '–');
const host = (u) => String(u).replace(/^https?:\/\//, '').replace(/\/$/, '');

const S = { data: null, beta: null, fb: null, um: null, clients: null, health: null, q: '', secret: null, flyer: null };
const LOADERS = { beta: '/api/admin/beta', fb: '/api/admin/feedback', um: '/api/admin/umfrage', clients: '/api/admin/clients', health: '/api/admin/health' };

async function api(p, { method = 'GET', body } = {}) {
  const r = await fetch(API + p, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) })
    .catch(() => { throw Object.assign(new Error('Die App ist gerade nicht erreichbar.'), { status: 0 }); });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { gate('login'); throw Object.assign(new Error('Bitte anmelden.'), { status: 401 }); }
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}
const need = (keys) => Promise.all(keys.filter((k) => !S[k]).map(async (k) => { S[k] = await api(LOADERS[k]); }));
const setData = (d) => { d.stats ||= S.data?.stats; S.data = d; }; // nach Aktionen schickt der Server keine neue Statistik mit

/* ---------------------------------------------------------------- kleine Bausteine */
const ICONS = {
  uebersicht: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  konten: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  einladungen: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
  anmeldungen: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  rueckmeldungen: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  umfrage: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  plaene: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  apps: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  impressum: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  system: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', chev: '<path d="m9 18 6-6-6-6"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', ext: '<path d="M7 17 17 7M7 7h10v10"/>',
};
const icon = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
const panel = (title, sub, body, cls = '') => `<section class="panel ${cls}">${title ? `<h2>${title}</h2>` : ''}${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;
const list = (rows, empty) => (rows.length ? `<div class="list">${rows.join('')}</div>` : `<p class="empty">${esc(empty)}</p>`);
const row = (title, sub = '', trail = '') => `<div class="row"><div class="main"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${trail !== '' ? `<div class="trail">${trail}</div>` : ''}</div>`; // 0 zeigen
const linkRow = (attrs, title, sub = '') => `<button class="row" type="button" ${attrs}><div class="main"><div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${icon('chev')}</button>`;
const field = (name, label, value = '', attrs = '') => `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const area = (name, label, value = '', rows = 3) => `<label class="field"><span>${esc(label)}</span><textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
const pick = (name, label, opts, sel) => `<label class="field"><span>${esc(label)}</span><select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const chip = (t, kind = '') => `<span class="chip ${kind}">${esc(t)}</span>`;
const meter = (v, total) => `<div class="meter" aria-hidden="true"><i style="width:${total ? Math.round((v / total) * 100) : 0}%"></i></div>`;
const shares = (counts, total) => Object.entries(counts).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => row(`${esc(k)}${meter(v, total)}`, '', `${v}${total ? ` · ${Math.round((v / total) * 100)} %` : ''}`));
const formData = (f) => Object.fromEntries(new FormData(f));
const sure = (b, text) => { if (b.dataset.sure) return true; b.dataset.sure = '1'; b.textContent = text; return false; }; // zweiter Klick bestätigt

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
}
const fail = (x) => { if (x.status !== 401) toast(x.message); };
function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('Kopiert'), () => window.prompt('Zum Kopieren markieren:', text));
}
function csvDownload(name, rows) { // Semikolon und BOM: öffnet sich in Excel direkt richtig
  const text = `﻿${rows.map((r) => r.map((v) => `"${String(Array.isArray(v) ? v.join(', ') : v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')}`;
  download(new Blob([text], { type: 'text/csv;charset=utf-8' }), name);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const dlg = $('#dlg');
function openDlg(title, html) {
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = html;
  if (!dlg.open) dlg.showModal();
  return $('#dlg-body');
}
const closeDlg = () => { if (dlg.open) dlg.close(); };

/* ---------------------------------------------------------------- Anmelden, Rahmen, Navigation */
function gate(kind, msg = '') {
  $('#layout').hidden = true;
  closeDlg();
  const g = $('#gate');
  g.hidden = false;
  const body = {
    login: `<p>Melde dich mit deinem Alltag-Konto an. Hier kommen nur Admins rein.</p><a class="btn primary" href="${esc(API)}/admin">Anmelden</a>`,
    noadmin: `<p>Dieses Konto hat keine Admin-Rechte.</p><button class="btn primary" type="button" data-logout>Mit anderem Konto anmelden</button><a class="btn" href="${esc(API)}/">Zur App</a>`,
    down: `<p>${esc(msg)}</p><button class="btn primary" type="button" data-retry>Erneut versuchen</button>`,
  }[kind];
  g.innerHTML = `<div class="gate-card"><img src="/icon.svg" alt="" width="56" height="56"><h1>Alltag Verwaltung</h1>${body}</div>`;
  $('[data-logout]', g)?.addEventListener('click', logout);
  $('[data-retry]', g)?.addEventListener('click', start);
}
async function logout() {
  const r = await api('/api/logout', { method: 'POST' }).catch(() => ({}));
  location.href = r.accountsUrl ? `${r.accountsUrl}/abmelden` : `${API}/`; // auch beim Konto-Dienst abmelden
}
const NAV = [
  ['uebersicht', 'Übersicht'], ['konten', 'Konten'], ['einladungen', 'Einladungen & Flyer'],
  'Beta-Test', ['anmeldungen', 'Anmeldungen'], ['rueckmeldungen', 'Rückmeldungen'], ['umfrage', 'Abschlussumfrage'],
  'Einstellungen', ['plaene', 'Abo-Pläne'], ['apps', 'Anmelden mit Alltag'], ['impressum', 'Impressum'], ['system', 'Systemstatus'],
];
function frame() {
  $('#nav').innerHTML = NAV.map((n) => (typeof n === 'string' ? `<p class="grp">${n}</p>` : `<a href="#${n[0]}" data-page="${n[0]}">${icon(n[0])}<span>${n[1]}</span><b class="badge" hidden></b></a>`)).join('');
  const me = S.data.accounts.find((a) => a.id === S.data.me);
  $('#who').innerHTML = `<div class="me"><span class="avatar" aria-hidden="true">${esc((me?.name || '?').slice(0, 1).toUpperCase())}</span><span><b>${esc(me?.name || 'Admin')}</b><small>Admin</small></span></div>
    <a class="side-link" href="${esc(API)}/">${icon('ext')}<span>Zur App</span></a><button class="side-link" type="button" id="logout">${icon('out')}<span>Abmelden</span></button>`;
  $('#logout').onclick = logout;
  $('#menu').innerHTML = icon('menu');
  $('#dlg-x').innerHTML = icon('x');
}
function badges() {
  const n = { anmeldungen: S.beta?.list.filter((x) => x.status === 'neu').length, rueckmeldungen: S.fb?.list.filter((x) => x.status === 'neu').length, system: S.health && !S.health.ok ? '!' : 0 };
  $$('#nav [data-page]').forEach((a) => { const b = $('.badge', a), v = n[a.dataset.page]; b.hidden = !v; b.textContent = v || ''; b.classList.toggle('warn', v === '!'); });
}
const layout = $('#layout'), menuBtn = $('#menu');
function drawer(open) {
  layout.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  $('#scrim').hidden = !open;
}
menuBtn.onclick = () => drawer(!layout.classList.contains('open'));
$('#scrim').onclick = () => drawer(false);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && layout.classList.contains('open')) { drawer(false); menuBtn.focus(); } });
$('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) drawer(false); });
$('#dlg-x').onclick = closeDlg;
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(); }); // Klick neben das Fenster

const PAGES = {
  uebersicht: ['Übersicht', pageOverview, ['beta', 'fb', 'health'], true], konten: ['Konten', pageAccounts], einladungen: ['Einladungen & Flyer', pageInvites],
  anmeldungen: ['Beta-Anmeldungen', pageBeta, ['beta']], rueckmeldungen: ['Rückmeldungen', pageFeedback, ['fb']], umfrage: ['Abschlussumfrage', pageSurvey, ['um']],
  plaene: ['Abo-Pläne', pagePlans], apps: ['Anmelden mit Alltag', pageApps, ['clients']], impressum: ['Impressum', pageLegal], system: ['Systemstatus', pageSystem, ['health']],
};
let seq = 0;
async function render() {
  const id = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'uebersicht', [title, fn, needs = [], soft] = PAGES[id], my = ++seq, main = $('#main');
  $('#title').textContent = title;
  document.title = `${title} · Alltag Verwaltung`;
  $$('#nav [data-page]').forEach((a) => (a.dataset.page === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  if (needs.some((k) => !S[k])) {
    main.innerHTML = '<p class="empty">Lädt …</p>';
    try { await need(needs); } catch (x) { if (!soft) { if (my === seq && x.status !== 401) main.innerHTML = panel('Konnte nicht laden', esc(x.message), ''); return; } }
  }
  if (my !== seq) return; // inzwischen woanders hin gewechselt
  main.onclick = null; // nur „Anmelden mit Alltag“ hängt einen an
  fn(main);
  badges();
}
addEventListener('hashchange', () => { closeDlg(); render(); scrollTo(0, 0); $('#main').focus({ preventScroll: true }); });

async function start() {
  try { setData(await api('/api/admin')); } catch (x) {
    if (x.status === 401) return;
    return gate(x.status === 403 ? 'noadmin' : 'down', x.message);
  }
  $('#gate').hidden = true;
  layout.hidden = false;
  frame();
  render();
  need(['beta', 'fb', 'health']).catch(() => {}).then(badges); // Zahlen in der Seitenleiste
}

/* ---------------------------------------------------------------- Übersicht und Statistik */
// Balken je Tag (eine Reihe, eine Farbe). Tooltip beim Zeigen, Zahlen zusätzlich als Tabelle.
function dayBars(days, key, unit) {
  const W = 360, H = 136, B = 114, n = days.length, gap = 2, bw = (W - (n - 1) * gap) / n, max = Math.max(1, ...days.map((d) => d[key]));
  const y = (v) => B - (v / max) * (B - 22), day = (d) => F.short.format(parseDay(d.date));
  const bars = days.map((d, i) => {
    const x = i * (bw + gap), v = d[key], top = y(v), r = Math.min(4, bw / 2, B - top);
    const shape = v ? `<path d="M${x} ${B}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${B}Z"/>` : '';
    return `<g><title>${esc(day(d))}: ${v} ${unit}</title><rect class="hit" x="${x - gap / 2}" y="0" width="${bw + gap}" height="${B}"/>${shape}</g>`;
  }).join('');
  const total = days.reduce((s, d) => s + d[key], 0), last = days.at(-1);
  return `<svg class="day-bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${unit} pro Tag, letzte ${n} Tage: zusammen ${total}, höchstens ${max}, heute ${last[key]}`)}">
    <line class="grid" x1="0" x2="${W}" y1="22" y2="22"/><text x="0" y="14">${max}</text>${bars}<line class="base" x1="0" x2="${W}" y1="${B}" y2="${B}"/>
    <text x="0" y="${H - 4}">${esc(day(days[0]))}</text><text x="${W}" y="${H - 4}" text-anchor="end">heute</text></svg>`;
}
const tiles = (items) => `<div class="tiles">${items.map(([n, l, href]) => `<${href ? `a href="${href}"` : 'div'} class="tile"><b>${n}</b><span>${l}</span></${href ? 'a' : 'div'}>`).join('')}</div>`;
function healthLine(h) {
  if (!h) return '';
  return h.ok ? `<span class="dot ok"></span>Konto-Dienst erreichbar · Mailversand: ${esc(h.mail)} · ${h.unconfirmed} ${h.unconfirmed === 1 ? 'Konto wartet' : 'Konten warten'} auf E-Mail-Bestätigung`
    : `<span class="dot bad"></span>Konto-Dienst nicht erreichbar: ${esc(h.error)}`;
}
function pageOverview(main) {
  const d = S.data, s = d.stats;
  const single = d.invites.filter((i) => !i.uses && i.open), flyers = d.invites.filter((i) => i.uses);
  const active = d.accounts.filter((a) => a.lastSeen && Date.now() - Date.parse(a.lastSeen) < 7 * 864e5).length;
  const newBeta = S.beta?.list.filter((x) => x.status === 'neu').length || 0, openFb = S.fb?.list.filter((x) => x.status !== 'erledigt').length || 0;
  const todo = [
    newBeta && linkRow('data-go="anmeldungen"', `${newBeta} neue Beta-${newBeta === 1 ? 'Anmeldung' : 'Anmeldungen'}`, 'Noch nicht eingeladen'),
    openFb && linkRow('data-go="rueckmeldungen"', `${openFb} offene ${openFb === 1 ? 'Rückmeldung' : 'Rückmeldungen'}`, 'Neu oder in Arbeit'),
    S.health && !S.health.ok && linkRow('data-go="system"', 'Konto-Dienst nicht erreichbar', esc(S.health.error)),
  ].filter(Boolean);
  const sum = (k, n = 30) => (s ? s.days.slice(-n).reduce((a, x) => a + x[k], 0) : 0), today = s?.days.at(-1);
  let html = `<p class="health">${healthLine(S.health)}</p>
    ${tiles([[d.accounts.length, 'Konten', '#konten'], [active, 'aktiv in den letzten 7 Tagen'], [single.length, 'offene Einladungen', '#einladungen'], [flyers.reduce((n, i) => n + i.usedCount, 0), 'über Flyer angemeldet', '#einladungen']])}
    ${todo.length ? panel('Zu erledigen', '', `<div class="list">${todo.join('')}</div>`) : ''}`;
  if (s) {
    const dev = Object.values(s.platforms).reduce((a, b) => a + b, 0);
    const USE = [['link', 'Schulsoftware verbunden oder Stundenplan eingetragen'], ['push', 'Mitteilungen an'], ['events', 'Termine'], ['reminders', 'Erinnerungen'], ['grades', 'Noten'], ['notes', 'Notizen'], ['photos', 'Tafelbilder']];
    const table = `<details class="table-wrap"><summary>Zahlen als Tabelle</summary><div class="scroll-x"><table><thead><tr><th>Tag</th><th>Besucher</th><th>Aufrufe</th><th>Aktive Konten</th><th>Neue Konten</th><th>Demo</th></tr></thead>
      <tbody>${s.days.slice().reverse().map((x) => `<tr><td>${esc(F.short.format(parseDay(x.date)))}</td><td>${x.visitors}</td><td>${x.views}</td><td>${x.active}</td><td>${x.signups}</td><td>${x.demo}</td></tr>`).join('')}</tbody></table></div></details>`;
    html += `<h2 class="section">Statistik</h2>
      <p class="sub">Ohne Cookies und ohne fremde Dienste. Besucher zählen je Tag einmal, eigene Besuche als Admin und Demo-Konten zählen nicht.</p>
      ${tiles([[today.visitors, 'Besucher heute'], [sum('visitors'), 'Besuche in 30 Tagen'], [today.active, 'Konten heute in der App'], [sum('signups'), 'neue Konten in 30 Tagen']])}
      <div class="grid2">${panel('Besucher der Website pro Tag', '', dayBars(s.days, 'visitors', 'Besucher'))}${panel('Konten pro Tag in der App', '', dayBars(s.days, 'active', 'Konten'))}</div>
      ${panel('', '', table)}
      <div class="grid2">
        ${panel('Geräte der Besucher (30 Tage)', '', list(dev ? shares(s.platforms, dev) : [], 'Noch keine Besuche.'))}
        ${panel('Schulsoftware der Konten', '', list(s.accounts ? shares(Object.fromEntries(Object.entries(s.schools).map(([k, v]) => [schoolName(k), v])), s.accounts) : [], 'Noch keine Konten.'))}
        ${panel(`Was genutzt wird (von ${s.accounts} Konten)`, '', list(USE.map(([k, l]) => row(l, '', s.use[k])), ''))}
        ${panel('Aktivität', '', list([[s.active.day, 'aktiv in 24 Stunden'], [s.active.week, 'aktiv in 7 Tagen'], [s.active.month, 'aktiv in 30 Tagen'], [sum('logins'), 'Anmeldungen in 30 Tagen'], [sum('demo'), 'Demo gestartet in 30 Tagen'], [sum('views'), 'Seitenaufrufe in 30 Tagen']].map(([v, l]) => row(l, '', v)), ''))}
      </div>`;
  }
  main.innerHTML = html;
  $$('[data-go]', main).forEach((b) => { b.onclick = () => { location.hash = b.dataset.go; }; });
}

/* ---------------------------------------------------------------- Konten */
function accTags(a) {
  const plan = a.plan && a.plan !== 'free' && !a.demo && !a.admin ? S.data.plans?.list[a.plan]?.name || 'Pro' : '';
  return [a.admin && chip('Admin', 'blue'), plan && chip(plan, 'violet'), a.jury ? chip('Jugend forscht', 'mint') : a.demo && chip('Demo', 'mint'), a.disabled && chip('gesperrt', 'red'), a.email && !a.emailOk && chip('E-Mail unbestätigt', 'orange')].filter(Boolean).join(' ');
}
function pageAccounts(main) {
  const d = S.data;
  main.innerHTML = panel('', '', `<label class="field search"><span class="vh">Suchen</span><input id="acc-q" type="search" placeholder="Name, E-Mail oder Support-ID" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(S.q)}"></label>
    <p class="sub" id="acc-count"></p>
    <div class="list" id="acc-list">${d.accounts.map((a) => `<button class="row" type="button" data-acc="${esc(a.id)}" data-q="${esc(`${a.name} ${a.email} ${a.support} ${a.support.replace('-', '')}`.toLowerCase())}">
      <span class="avatar" aria-hidden="true">${esc(a.name.slice(0, 1).toUpperCase())}</span>
      <div class="main"><div class="title">${esc(a.name)} ${accTags(a)}</div>
      <div class="sub"><span class="code">${esc(a.support)}</span> · ${esc(a.demo ? 'Demo-Daten' : schoolName(a.school))} · ${a.lastSeen ? `aktiv ${esc(ago(a.lastSeen))}` : `angelegt ${esc(ago(a.created))}`}</div></div>${icon('chev')}</button>`).join('')}</div>`);
  const filter = () => {
    const q = S.q.trim().toLowerCase(), rows = $$('#acc-list [data-acc]', main);
    rows.forEach((b) => { b.hidden = !!q && !b.dataset.q.includes(q); });
    const n = rows.filter((b) => !b.hidden).length;
    $('#acc-count', main).textContent = q ? `${n} von ${rows.length} Konten` : `${rows.length} Konten`;
  };
  $('#acc-q', main).oninput = (e) => { S.q = e.target.value; filter(); };
  $$('[data-acc]', main).forEach((b) => { b.onclick = () => openAcc(b.dataset.acc); });
  filter();
}
function openAcc(id, password) {
  const a = S.data.accounts.find((x) => x.id === id);
  if (!a) return closeDlg();
  const self = a.id === S.data.me, plans = S.data.plans?.list || {};
  const facts = [['Support-ID', `<span class="code">${esc(a.support)}</span>`], a.email && ['E-Mail', `${esc(a.email)}${a.emailOk ? '' : ' (unbestätigt)'}`],
    ['Schulsoftware', esc(a.demo ? 'Demo-Daten' : schoolName(a.school))], ['Angelegt', esc(ago(a.created))], ['Zuletzt aktiv', esc(ago(a.lastSeen))]].filter(Boolean);
  const act = (k, label, danger) => `<button class="btn${danger ? ' danger' : ''}" type="button" data-do="${k}">${label}</button>`;
  const body = openDlg(a.name, `${accTags(a) ? `<p>${accTags(a)}</p>` : ''}
    <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${password ? `<div class="notice"><b>Neues Passwort</b><span class="code big">${esc(password)}</span><span>Nur jetzt sichtbar. Gib es ${esc(a.name)} persönlich weiter.</span><button class="btn small" type="button" data-copy>Kopieren</button></div>` : ''}
    ${self ? '<p class="sub">Das ist dein eigenes Konto. E-Mail, Passwort und Löschen findest du auf der Konto-Seite (App → Profil → Konto verwalten).</p>' : `
      ${a.demo || a.admin ? '' : `<div class="field"><span>Abo-Plan</span><div class="seg" role="group" aria-label="Abo-Plan">${Object.entries(plans).map(([k, p]) => `<button type="button" data-plan="${k}" aria-pressed="${k === (a.plan || 'free')}">${esc(p.name)}</button>`).join('')}</div>
        <small>Für den Nutzer noch unsichtbar, schaltet die Pro-Funktionen frei.</small></div>`}
      <div class="actions">${[act('reset', 'Passwort zurücksetzen'), a.demo ? '' : act('admin', a.admin ? 'Admin-Rechte entziehen' : 'Zum Admin machen'),
        a.demo ? act('jury', a.jury ? 'Jugend-forscht-Kennzeichnung entfernen' : 'Als „Jugend forscht Version · Full Access“ kennzeichnen') : '',
        a.demo ? act('resetDemo', 'Demo-Daten zurücksetzen') : '', a.admin ? '' : act('demo', a.demo ? 'Demo-Konto beenden' : 'Als Demo-Konto einrichten'),
        act('disable', a.disabled ? 'Entsperren' : 'Sperren', !a.disabled), act('delete', 'Konto löschen', true)].join('')}</div>`}`);
  $('[data-copy]', body)?.addEventListener('click', () => copy(password));
  const url = `/api/admin/accounts/${encodeURIComponent(a.id)}`;
  $$('[data-plan]', body).forEach((b) => {
    b.onclick = async () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      try { setData(await api(url, { method: 'POST', body: { plan: b.dataset.plan } })); render(); if (dlg.open) openAcc(a.id); } catch (x) { fail(x); }
    };
  });
  $$('[data-do]', body).forEach((b) => {
    b.onclick = async () => {
      const k = b.dataset.do;
      const ask = { delete: 'Wirklich löschen? Alle Daten sind dann weg.', reset: 'Wirklich zurücksetzen?', resetDemo: 'Wirklich? Alles, was Besucher eingetragen haben, ist dann weg.',
        demo: a.demo ? 'Wirklich beenden? Das Konto ist danach leer.' : 'Wirklich? Alle Daten des Kontos werden durch Beispieldaten ersetzt.' }[k];
      if (ask && !sure(b, ask)) return;
      b.disabled = true;
      try {
        if (k === 'delete') { setData(await api(url, { method: 'DELETE' })); closeDlg(); toast(`${a.name} gelöscht`); return render(); }
        const body2 = { reset: { reset: true }, admin: { admin: !a.admin }, demo: { demo: !a.demo }, jury: { jury: !a.jury }, resetDemo: { resetDemo: true }, disable: { disabled: !a.disabled } }[k];
        const d = await api(url, { method: 'POST', body: body2 });
        setData(d);
        if (k === 'resetDemo') toast('Demo-Daten zurückgesetzt');
        render();
        if (dlg.open || d.password) openAcc(a.id, d.password); // neues Passwort gibt es nur in dieser Antwort
      } catch (x) { fail(x); b.disabled = false; }
    };
  });
}

/* ---------------------------------------------------------------- Einladungen und Flyer */
function pageInvites(main) {
  const d = S.data, nameOf = (id) => d.accounts.find((a) => a.id === id)?.name || 'gelöschtes Konto';
  const single = d.invites.filter((i) => !i.uses && i.open), flyers = d.invites.filter((i) => i.uses).reverse(), used = d.invites.filter((i) => !i.uses && i.usedBy).slice(-10).reverse();
  const until = (i) => (i.expires ? `gültig bis ${esc(F.short.format(new Date(i.expires)))}` : 'ohne Ablaufdatum');
  main.innerHTML = `<div class="grid2">
    ${panel('Einladung für eine Person', '6 Ziffern, nur einmal nutzbar.', `<form class="form" id="invite-form">${field('note', 'Für wen? (siehst nur du)', '', 'maxlength="80"')}
      ${pick('days', 'Gültig', [[7, '7 Tage'], ['unbegrenzt', 'ohne Ablaufdatum']], 7)}<button class="btn primary" type="submit">Einladungscode erstellen</button></form>
      ${list(single.map((i) => row(`<span class="code">${esc(shownCode(i.code))}</span>`, `${esc(i.note || 'ohne Notiz')} · ${until(i)}`,
        `<button class="btn small" type="button" data-copy="${esc(i.code)}">Kopieren</button> <button class="btn small danger" type="button" data-del="${esc(i.code)}">Löschen</button>`)), 'Keine offenen Einladungen.')}`)}
    ${panel('Flyer (A6, doppelseitig)', 'Ein Code für alle Flyer: Er gilt für die gewählte Zahl an Anmeldungen und bis zum Ablaufdatum. Du bekommst eine ZIP-Datei mit Vorder- und Rückseite als Bild (z. B. für den dm-Fotodruck) und eine Druck-PDF für Druckereien.',
      `<form class="form" id="flyer-form"><div class="two">${pick('uses', 'Anmeldungen', [50, 100, 200, 500, 'unbegrenzt'].map((v) => [v, v === 'unbegrenzt' ? 'unbegrenzt' : `bis zu ${v}`]), 100)}
        ${pick('days', 'Gültig', [30, 60, 90, 'unbegrenzt'].map((v) => [v, v === 'unbegrenzt' ? 'ohne Ablaufdatum' : `${v} Tage`]), 90)}</div>
        ${field('email', 'Deine E-Mail für Fragen', d.legal?.email, 'type="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="120"')}
        ${field('site', 'Adresse der App', host(d.site || API), 'autocapitalize="off" spellcheck="false" maxlength="60" required')}
        <button class="btn primary" type="submit">Code und Flyer erstellen</button></form>
      <div class="flyer-previews" id="flyer-preview">${S.flyer ? `<img src="${S.flyer.front}" alt="Vorderseite des Flyers"><img src="${S.flyer.back}" alt="Rückseite des Flyers">` : ''}</div>`)}
    </div>
    ${panel('Flyer-Codes', '', list(flyers.map((i) => row(`<span class="code">${esc(shownCode(i.code))}</span>`,
      `${esc(i.note || 'Flyer')} · ${i.unlimited ? `${i.usedCount} Anmeldungen` : `${i.usedCount} von ${i.uses} Anmeldungen`} · ${!i.open ? 'beendet' : until(i)}`,
      i.open ? `<button class="btn small" type="button" data-flyer="${esc(i.code)}">Flyer laden</button> <button class="btn small danger" type="button" data-del="${esc(i.code)}">Stoppen</button>` : chip('beendet'))), 'Noch keine Flyer.'))}
    ${used.length ? panel('Zuletzt eingelöste Einladungen', '', list(used.map((i) => row(`<span class="code">${esc(shownCode(i.code))}</span>`, `${esc(i.note || 'ohne Notiz')} → ${esc(nameOf(i.usedBy))}`)), '')) : ''}`;
  $('#invite-form', main).onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/admin/invites', { method: 'POST', body: formData(e.target) }); setData(r); render(); toast(`Code ${shownCode(r.created?.[0] || '')} erstellt`); } catch (x) { fail(x); }
  };
  $$('[data-copy]', main).forEach((b) => { b.onclick = () => copy(b.dataset.copy); });
  $$('[data-del]', main).forEach((b) => {
    b.onclick = async () => {
      if (!sure(b, 'Sicher?')) return;
      try { setData(await api(`/api/admin/invites/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' })); render(); } catch (x) { fail(x); }
    };
  });
  const form = $('#flyer-form', main);
  const makeFlyer = async (inv, btn) => {
    const label = btn.textContent, o = formData(form);
    btn.disabled = true; btn.textContent = 'Erstelle Flyer …';
    try {
      const { flyerA6 } = await import('/flyer.mjs');
      S.flyer = await flyerA6({ code: inv.code, until: inv.expires ? new Date(inv.expires).toLocaleDateString('de-DE') : '', email: o.email.trim(), site: o.site.trim(), name: d.legal?.name, address: d.legal?.address?.replace(/\s*\n\s*/g, ', ') });
      download(S.flyer.zip, `alltag-flyer-${inv.code}.zip`);
      return true;
    } catch (x) { fail(x); } finally { btn.disabled = false; btn.textContent = label; }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const o = formData(form);
    try { // „unbegrenzt“ bleibt Text, der Server versteht es so
      const r = await api('/api/admin/invites', { method: 'POST', body: { uses: o.uses, days: o.days, note: `Flyer ${F.short.format(new Date())}` } });
      setData(r);
      if (await makeFlyer(r.invites.find((i) => i.code === r.created[0]), $('button[type=submit]', form))) toast('Flyer erstellt');
      render();
    } catch (x) { fail(x); }
  };
  $$('[data-flyer]', main).forEach((b) => { b.onclick = async () => { if (await makeFlyer(d.invites.find((i) => i.code === b.dataset.flyer), b)) render(); }; });
}

/* ---------------------------------------------------------------- Beta-Test: Anmeldungen, Rückmeldungen, Abschlussumfrage */
const FORMS = () => window.Formulare?.FORMS || { beta: [], feedback: [], umfrage: [] };
const formRows = (id, x) => FORMS()[id].filter((f) => f.name && x[f.name] != null && x[f.name] !== '' && !(Array.isArray(x[f.name]) && !x[f.name].length))
  .map((f) => `<dt>${esc(f.label)}</dt><dd class="pre">${esc(f.type === 'check' ? (x[f.name] ? 'ja' : 'nein') : Array.isArray(x[f.name]) ? x[f.name].join(', ') : x[f.name])}</dd>`).join('');
function betaState(x) { // eingelöster Code = registriert
  const inv = x.code && S.data.invites.find((i) => i.code === x.code), name = inv?.usedBy && S.data.accounts.find((a) => a.id === inv.usedBy)?.name;
  return inv?.usedBy ? `registriert als ${name || 'Konto'}` : x.status === 'eingeladen' ? `eingeladen ${ago(x.invitedAt)}` : 'neu';
}
function pageBeta(main) {
  const l = S.beta.list;
  main.innerHTML = panel(`Anmeldungen (${l.length})`, `Von der Seite <a href="${esc(API)}/beta" target="_blank" rel="noopener">${esc(host(API))}/beta</a>. „Einladen“ schickt den Einladungscode mit der Tester-ID per Mail.`,
    `${list(l.map((x) => { const st = betaState(x); return linkRow(`data-beta="${esc(x.id)}"`, `<span class="code">${esc(x.id)}</span> ${esc(x.vorname)} ${esc(x.nachname)} ${st === 'neu' ? chip('neu', 'blue') : ''}`,
      esc([x.schulsoftware, x.hauptgeraet, `${x.alter} J.`, st].join(' · '))); }), 'Noch keine Anmeldungen.')}
    ${l.length ? '<div><button class="btn" type="button" data-csv>Als CSV laden</button></div>' : ''}`);
  $('[data-csv]', main)?.addEventListener('click', () => {
    const fields = FORMS().beta.filter((f) => f.name);
    csvDownload('alltag-beta-anmeldungen.csv', [['ID', 'Angemeldet', 'Status', ...fields.map((f) => f.label)], ...l.map((x) => [x.id, x.at, betaState(x), ...fields.map((f) => x[f.name])])]);
  });
  $$('[data-beta]', main).forEach((b) => { b.onclick = () => openBeta(l.find((y) => y.id === b.dataset.beta)); });
}
function openBeta(x) {
  const st = betaState(x);
  const body = openDlg(`${x.id} · ${x.vorname}`, `<dl class="facts">${formRows('beta', x)}</dl>
    <p class="sub">Angemeldet ${esc(ago(x.at))} · ${esc(st)}${x.code ? ` · Code <span class="code">${esc(shownCode(x.code))}</span>` : ''}</p>
    <div class="actions">${st.startsWith('registriert') ? '' : `<button class="btn primary" type="button" data-do="invite">${x.code ? 'Neuen Code per Mail schicken' : 'Einladen (Code per Mail)'}</button>`}
      <button class="btn danger" type="button" data-do="del">Anmeldung löschen</button></div>`);
  $$('[data-do]', body).forEach((b) => {
    b.onclick = async () => {
      const inv = b.dataset.do === 'invite';
      if (!inv && !sure(b, 'Wirklich löschen?')) return;
      b.disabled = true;
      try {
        const r = await api(`/api/admin/beta/${encodeURIComponent(x.id)}${inv ? '/invite' : ''}`, { method: inv ? 'POST' : 'DELETE' });
        if (r.invites) S.data.invites = r.invites;
        S.beta = { list: r.list };
        closeDlg(); toast(inv ? 'Einladung verschickt' : 'Gelöscht'); render();
      } catch (e) { fail(e); b.disabled = false; }
    };
  });
}
const FB_KIND = { Fehler: 'red', Idee: 'violet', Frage: 'blue' };
function pageFeedback(main) {
  const l = S.fb.list, open = l.filter((x) => x.status !== 'erledigt').length;
  main.innerHTML = panel(`Rückmeldungen (${open} offen)`, 'Aus der App (Profil → Beta-Test). Tester-ID, Gerät und App-Version kommen automatisch mit.',
    `${list(l.map((x) => linkRow(`data-fb="${esc(x.id)}"`, `${chip(x.art, FB_KIND[x.art] || 'blue')} ${esc(x.titel)}`,
      `${esc([x.account?.name, x.betaId, ago(x.at)].filter(Boolean).join(' · '))} · ${x.status === 'erledigt' ? 'erledigt' : x.status === 'neu' ? '<b>neu</b>' : esc(x.status)}`)), 'Noch keine Rückmeldungen.')}
    ${l.length ? '<div><button class="btn" type="button" data-csv>Als CSV laden</button></div>' : ''}`);
  $('[data-csv]', main)?.addEventListener('click', () => csvDownload('alltag-rueckmeldungen.csv', [['Zeit', 'Art', 'Kurz', 'Beschreibung', 'Wann', 'Schritte', 'Status', 'Notiz', 'Konto', 'Tester-ID', 'Support-ID', 'Schulsoftware', 'Ansicht', 'Version', 'Gerät'],
    ...l.map((x) => [x.at, x.art, x.titel, x.beschreibung, x.wann, x.schritte, x.status, x.note, x.account?.name, x.betaId, x.account?.support, x.school, x.view, x.version, x.device])]));
  $$('[data-fb]', main).forEach((b) => { b.onclick = () => openFb(l.find((y) => y.id === b.dataset.fb)); });
}
function openFb(x) {
  const shot = `${API}/api/admin/feedback/${encodeURIComponent(x.id)}/shot`;
  const body = openDlg(x.art, `<dl class="facts">${formRows('feedback', x)}
      <dt>Von</dt><dd>${esc([x.account?.name, x.betaId, x.account?.support].filter(Boolean).join(' · ') || 'unbekannt')}</dd>
      <dt>Gesendet</dt><dd>${esc(F.full.format(new Date(x.at)))} · Ansicht ${esc(x.view || '–')} · Version ${esc(x.version || '–')}</dd>
      <dt>Gerät</dt><dd class="small">${esc(x.device || '–')}</dd></dl>
    ${x.shot ? `<a href="${esc(shot)}" target="_blank" rel="noopener"><img class="shot" src="${esc(shot)}" alt="Bildschirmfoto"></a>` : ''}
    <form class="form" id="fb-edit">${pick('status', 'Status', [['neu', 'Neu'], ['in Arbeit', 'In Arbeit'], ['erledigt', 'Erledigt']], x.status)}
      ${area('note', 'Notiz (nur für dich)', x.note || '', 3)}<button class="btn primary" type="submit">Sichern</button></form>`);
  $('#fb-edit', body).onsubmit = async (e) => {
    e.preventDefault();
    try { S.fb = { list: (await api(`/api/admin/feedback/${encodeURIComponent(x.id)}`, { method: 'POST', body: formData(e.target) })).list }; closeDlg(); toast('Gesichert'); render(); } catch (e2) { fail(e2); }
  };
}
function pageSurvey(main) {
  const u = S.um, ans = u.answers, n = ans.length;
  const summary = FORMS().umfrage.filter((f) => f.name).map((f) => {
    const vals = ans.map((a) => a[f.name]).filter((v) => v != null && v !== '');
    if (f.type === 'textarea') return vals.length ? panel(esc(f.label), '', list(vals.slice(-30).reverse().map((t) => `<div class="row"><div class="main pre">${esc(t)}</div></div>`), '')) : '';
    if (f.type === 'scale') {
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      const counts = Object.fromEntries(Array.from({ length: f.max - f.min + 1 }, (_, k) => [String(f.min + k), vals.filter((v) => v === f.min + k).length]).filter(([, v]) => v));
      const nps = f.max === 10 && vals.length ? Math.round(((vals.filter((v) => v >= 9).length - vals.filter((v) => v <= 6).length) / vals.length) * 100) : null;
      return panel(esc(f.label), `Durchschnitt ${vals.length ? F.num.format(Math.round(avg * 10) / 10) : '–'} von ${f.max}${nps != null ? ` · Weiterempfehlung (NPS) ${nps}` : ''}`, list(shares(counts, vals.length), 'Noch keine Antworten.'));
    }
    const counts = {};
    for (const v of vals) for (const y of [].concat(v)) counts[y] = (counts[y] || 0) + 1;
    return panel(esc(f.label), '', list(shares(counts, n), 'Noch keine Antworten.'));
  }).join('');
  main.innerHTML = `${panel(`${n} ${n === 1 ? 'Antwort' : 'Antworten'}`, 'Anonym: gespeichert ohne Konto, nur mit Tag. Ist sie offen, sehen Tester in der App einen Hinweis und im Profil den Fragebogen.',
    `<label class="toggle"><span><b>Umfrage geöffnet</b></span><input type="checkbox" class="switch" id="um-open"${u.open ? ' checked' : ''}></label>
    ${n ? '<div><button class="btn" type="button" data-csv>Als CSV laden</button></div>' : ''}`)}
    ${n ? `<div class="grid2">${summary}</div>` : ''}`;
  $('#um-open', main).onchange = async (e) => {
    try { S.um = await api('/api/admin/umfrage', { method: 'POST', body: { open: e.target.checked } }); toast(S.um.open ? 'Umfrage geöffnet' : 'Umfrage geschlossen'); render(); } catch (x) { fail(x); e.target.checked = !e.target.checked; }
  };
  $('[data-csv]', main)?.addEventListener('click', () => {
    const fields = FORMS().umfrage.filter((f) => f.name);
    csvDownload('alltag-abschlussumfrage.csv', [['Tag', ...fields.map((f) => f.label)], ...ans.map((a) => [a.day, ...fields.map((f) => a[f.name])])]);
  });
}

/* ---------------------------------------------------------------- Einstellungen */
function pagePlans(main) { // Abo-Pläne: nur hier sichtbar, solange man Pro nicht kaufen kann
  const p = S.data.plans;
  main.innerHTML = `${panel('Plan-Auswahl für Nutzer', 'Noch nicht kaufbar. Den Plan eines Kontos setzt du beim Konto. Admins und Demo-Konten haben alles.',
    `<label class="toggle"><span><b>Plan-Auswahl zeigen</b><small>Im Profil erscheint „Alltag Pro“ mit den Plänen und Preisen, kaufen geht noch nicht. Du siehst die Vorschau auch so.</small></span>
      <input type="checkbox" class="switch" id="plans-visible"${p.visible ? ' checked' : ''}></label>`)}
    <div class="plans">${Object.entries(p.list).map(([k, x]) => `<section class="panel plan${k === 'pro' ? ' featured' : ''}"><h2>${esc(x.name)}</h2>
      <p class="price">${x.month ? `<b>${euro(x.month)}</b> im Monat · ${euro(x.year)} im Jahr` : '<b>0 €</b> für immer'}${x.accounts > 1 ? ` · bis ${x.accounts} Konten` : ''}</p>
      <ul>${(x.features.length ? x.features.map((f) => esc(p.features[f] + (p.soon.includes(f) ? ' (geplant)' : ''))) : ['Alles für den Schultag']).map((t) => `<li>${t}</li>`).join('')}</ul>
      <p class="sub">${S.data.accounts.filter((a) => a.plan === k && !a.admin && !a.demo).length} Konten</p></section>`).join('')}</div>`;
  $('#plans-visible', main).onchange = async (e) => {
    try { setData(await api('/api/admin/plans', { method: 'POST', body: { visible: e.target.checked } })); toast(e.target.checked ? 'Für alle sichtbar' : 'Nur noch für Admins'); render(); } catch (x) { fail(x); e.target.checked = !e.target.checked; }
  };
}
// Anmelden mit Alltag: eigene Apps eintragen (OpenID Connect beim Konto-Dienst); Schlüssel nur direkt nach Anlegen/Erneuern sichtbar
function pageApps(main) {
  const l = S.clients.clients, shown = S.secret, acc = S.data.accountsUrl;
  S.secret = null;
  main.innerHTML = `${shown ? `<div class="notice"><b>Schlüssel für ${esc(l.find((c) => c.id === shown.id)?.name || 'die App')}</b><span>Nur jetzt sichtbar, gleich in die App eintragen:</span><span class="code big">${esc(shown.secret)}</span>
      <button class="btn small" type="button" data-copy="${esc(shown.secret)}">Schlüssel kopieren</button></div>` : ''}
    ${panel('Eingetragene Apps', `Für deine eigenen Apps, wie „Anmelden mit Google“ (Standard OpenID Connect). In der App einstellen: Anbieter <span class="code">${esc(acc)}</span>, Client-ID und Schlüssel, Scopes <span class="code">openid profile</span> (mit E-Mail: <span class="code">email</span> dazu). Nutzer stimmen beim ersten Anmelden zu.`,
      list(l.map((c) => row(`${esc(c.name)} ${c.disabled ? chip('gesperrt', 'red') : ''}`, `<span class="code">${esc(c.id)}</span> · ${esc(c.redirects.join(', '))}`,
        `<span class="btns"><button class="btn small" type="button" data-cl-copy="${esc(c.id)}">ID kopieren</button><button class="btn small" type="button" data-cl-secret="${esc(c.id)}">Neuer Schlüssel</button>
        <button class="btn small" type="button" data-cl-off="${esc(c.id)}">${c.disabled ? 'Entsperren' : 'Sperren'}</button><button class="btn small danger" type="button" data-cl-del="${esc(c.id)}">Löschen</button></span>`)), 'Noch keine Apps eingetragen.'))}
    ${panel('App eintragen', '', `<form class="form" id="cl-form">${field('name', 'Name der App (sehen Nutzer beim Zustimmen)', '', 'maxlength="60" required')}
      ${area('redirects', 'Rücksprung-Adressen, eine pro Zeile (https://…/callback)', '', 2)}<button class="btn primary" type="submit">App eintragen</button></form>`)}`;
  const url = (id) => `/api/admin/clients/${encodeURIComponent(id)}`;
  $('[data-copy]', main)?.addEventListener('click', (e) => copy(e.target.dataset.copy));
  $('#cl-form', main).onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/admin/clients', { method: 'POST', body: formData(e.target) }); S.clients = r; S.secret = { id: r.created, secret: r.secret }; render(); } catch (x) { fail(x); }
  };
  main.onclick = async (e) => {
    const b = e.target.closest('button[data-cl-copy],button[data-cl-secret],button[data-cl-off],button[data-cl-del]');
    if (!b) return;
    const ds = b.dataset;
    if (ds.clCopy) return copy(ds.clCopy);
    if ((ds.clSecret || ds.clDel) && !sure(b, ds.clDel ? 'Wirklich löschen?' : 'Alter Schlüssel geht dann nicht mehr. Sicher?')) return;
    try {
      if (ds.clDel) S.clients = await api(url(ds.clDel), { method: 'DELETE' });
      else if (ds.clSecret) { const r = await api(url(ds.clSecret), { method: 'POST', body: { newSecret: true } }); S.clients = r; S.secret = { id: ds.clSecret, secret: r.secret }; }
      else S.clients = await api(url(ds.clOff), { method: 'POST', body: { disabled: !l.find((c) => c.id === ds.clOff)?.disabled } });
      render();
    } catch (x) { fail(x); }
  };
}
function pageLegal(main) {
  const l = S.data.legal || {};
  main.innerHTML = `<div class="grid2">${panel('Angaben', 'Steht im Impressum, in der Datenschutzerklärung und auf neuen Flyern. Gilt sofort nach dem Sichern.',
    `<form class="form" id="legal-form">${field('name', 'Name', l.name, 'maxlength="120" required autocomplete="off"')}
      ${area('address', 'Anschrift, z. B. c/o Impressum-Dienst, Straße, PLZ Ort', l.address, 3)}
      ${field('email', 'E-Mail', l.email, 'type="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="120" required')}
      ${field('phone', 'Telefon (freiwillig)', l.phone, 'type="tel" maxlength="40"')}<button class="btn primary" type="submit">Sichern</button></form>`)}
    ${panel('Seiten ansehen', '', list([['impressum.html', 'Impressum'], ['datenschutz.html', 'Datenschutz']].map(([f, t]) => `<a class="row" href="${esc(API)}/${f}" target="_blank" rel="noopener"><div class="main"><div class="title">${t}</div><div class="sub">${esc(host(API))}/${f}</div></div>${icon('ext')}</a>`), ''))}</div>`;
  $('#legal-form', main).onsubmit = async (e) => {
    e.preventDefault();
    try { setData(await api('/api/admin/legal', { method: 'POST', body: formData(e.target) })); toast('Impressum gesichert'); render(); } catch (x) { fail(x); }
  };
}
function pageSystem(main) {
  const h = S.health, a = h.app || {};
  const state = (ok, text) => `<span class="dot ${ok ? 'ok' : 'bad'}"></span>${text}`;
  main.innerHTML = `<div class="grid2">
    ${panel('App', `<a href="${esc(API)}/" target="_blank" rel="noopener">${esc(host(API))}</a>`, list([row('Läuft seit', '', a.since ? esc(ago(a.since)) : '–'), row('Arbeitsspeicher', '', a.memory ? `${a.memory} MB` : '–'), row('Node.js', '', esc(a.node || '–'))], ''))}
    ${panel('Konto-Dienst', `<a href="${esc(S.data.accountsUrl)}/" target="_blank" rel="noopener">${esc(host(S.data.accountsUrl))}</a>`, list(h.ok ? [row(state(true, 'erreichbar')), row('Mailversand', '', esc(h.mail)), row('Konten', '', h.accounts), row('warten auf E-Mail-Bestätigung', '', h.unconfirmed)]
      : [row(state(false, 'nicht erreichbar'), esc(h.error))], ''))}
    </div>
    ${panel('Testmail', 'Prüft den Mailversand und zeigt, wie die Mails aussehen', `<form id="test-mail" class="test-mail"><input type="email" name="to" required maxlength="120" autocomplete="email" placeholder="E-Mail-Adresse" value="${esc(S.data.me?.email || '')}" aria-label="An diese Adresse"><button class="btn" type="submit">Testmail senden</button></form>`)}
    <p class="sub">Die App startet nach längerer Ruhe neu (Hoster), „läuft seit“ ist deshalb oft kurz. Neue Konten ohne bestätigte E-Mail löscht der Konto-Dienst nach 7 Tagen.</p>
    <div><button class="btn" type="button" id="re-check">Neu prüfen</button></div>`;
  $('#re-check', main).onclick = () => { S.health = null; render(); };
  $('#test-mail', main).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, b = $('button', f);
    b.disabled = true;
    try { await api('/api/admin/test-mail', { method: 'POST', body: { to: f.to.value } }); toast(`Testmail an ${f.to.value} ist unterwegs.`); } catch (x) { toast(x.message); }
    b.disabled = false;
  };
}

start();
