'use strict';
// Alltag – Verwaltung als eigene Seite (z. B. admin.alltag-app.de). Liefert nur die Oberfläche aus. Alle Daten holt der Browser
// über die Admin-API der App (API_URL) mit deren Sitzung; die App erlaubt das nur für ihre ADMIN_URL (CORS).
// Plesk: Anwendungsstamm = dieser Ordner, Dokumentenstamm = public, Startdatei server.js, Umgebungsvariable API_URL.
const http = require('http');
const fs = require('fs');
const path = require('path');

const API = String(process.env.API_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\/[\w.-]+(:\d+)?$/.test(API)) {
  console.error('API_URL fehlt: Adresse der App ohne Pfad, z. B. https://alltag-app.de');
  process.exit(1);
}
const OWN = path.join(__dirname, 'public'), SHARED = path.join(__dirname, '..', 'public');
// Aus der App mitbenutzt: Flyer-Baukasten (lädt /icon.svg) und die Formulare des Beta-Tests (Auswertung, CSV)
const FILES = { '/admin.js': OWN, '/admin.css': OWN, '/flyer.mjs': SHARED, '/formulare.js': SHARED, '/icon.svg': SHARED };
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
// Bilder der Rückmeldungen kommen von der App; Flyer-Vorschau als blob:
const CSP = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${API}; connect-src ${API}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname, secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  const head = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-cache', ...(secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };
  const out = (status, type, body) => { res.writeHead(status, { ...head, 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : body); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return out(405, 'text/plain', 'Method Not Allowed');
  if (p === '/robots.txt') return out(200, 'text/plain; charset=utf-8', 'User-agent: *\nDisallow: /\n');
  if (p === '/' || p === '/index.html') {
    // Versionsnummer an Skript/Stil: nginx liefert public/ ohne Cache-Control, sonst passen alte Dateien nicht zum neuen HTML
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\{\{API\}\}/g, API)
      .replace(/"\/(admin\.js|admin\.css|formulare\.js)"/g, (m, f) => `"/${f}?v=${Math.floor(fs.statSync(path.join(FILES[`/${f}`], f)).mtimeMs).toString(36)}"`);
    head['Content-Security-Policy'] = CSP;
    head['Cross-Origin-Opener-Policy'] = 'same-origin';
    head['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=(), payment=()';
    return out(200, 'text/html; charset=utf-8', html);
  }
  if (!FILES[p]) return out(404, 'text/plain', 'Not Found');
  fs.readFile(path.join(FILES[p], p.slice(1)), (err, buf) => (err ? out(404, 'text/plain', 'Not Found') : out(200, TYPES[path.extname(p)], buf)));
}).listen(process.env.PORT || 3003, () => console.log(`Alltag-Verwaltung läuft auf http://localhost:${process.env.PORT || 3003}, App: ${API}`));
