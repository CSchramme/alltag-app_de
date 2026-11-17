// Doppelseitiger Flyer A6 (105 × 148 mm) mit 3 mm Beschnitt, 300 dpi: Vorderseite (Botschaft) und Rückseite (Sammelcode,
// Schritte, Kontakt). Ergebnis: ZIP mit zwei JPGs (z. B. dm-Fotodruck) und einer zweiseitigen Druck-PDF (Druckerei).
// Wird erst geladen, wenn ein Admin einen Flyer erstellt.
const MM = 300 / 25.4;                       // Pixel je Millimeter bei 300 dpi
export const BLEED = 3, TRIM_W = 105, TRIM_H = 148;
export const W = Math.round((TRIM_W + 2 * BLEED) * MM), H = Math.round((TRIM_H + 2 * BLEED) * MM); // 1311 × 1819
const X = Math.round((BLEED + 6) * MM);      // Text mindestens 6 mm innerhalb der Schnittkante
const SANS = 'Inter, "Segoe UI", -apple-system, system-ui, Roboto, sans-serif';
const font = (weight, size) => `${weight} ${size}px ${SANS}`;

function fit(g, text, weight, size, maxW) { // Schriftgröße verkleinern, bis der Text in die Breite passt
  do g.font = font(weight, size); while (g.measureText(text).width > maxW && --size > 10);
  return size;
}
function wrap(g, text, x, y, width, lineHeight) {
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) { g.fillText(line, x, y); y += lineHeight; line = word; } else line = next;
  }
  g.fillText(line, x, y);
  return y + lineHeight;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function sky(g, seed) { // fast schwarzes Blau mit Sternen, wie die Startseite
  g.fillStyle = '#0b0e17';
  g.fillRect(0, 0, W, H);
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 230; i++) {
    g.fillStyle = `rgba(190, 205, 255, ${0.12 + rnd() * 0.42})`;
    g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.8 + rnd() * 1.8, 0, Math.PI * 2); g.fill();
  }
}
const gradient = (g, x, w) => {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, '#a9bcff'); gr.addColorStop(1, '#a191ff');
  return gr;
};

function front(g, icon, { site }) {
  sky(g, 12345);
  const inner = W - 2 * X;
  g.drawImage(icon, X, 150, 170, 170);
  g.fillStyle = '#eef1f8'; g.font = font(800, 104);
  g.fillText('Alltag', X + 205, 270);

  const size = fit(g, 'Hausaufgaben.', 800, 120, inner);
  ['Kalender,', 'Stundenplan,', 'Hausaufgaben.'].forEach((t, i) => g.fillText(t, X, 560 + i * size * 1.08));
  const last = 560 + 3 * size * 1.08;
  fit(g, 'Alles in einer App.', 800, size, inner);
  g.fillStyle = gradient(g, X, inner);
  g.fillText('Alles in einer App.', X, last);

  g.font = font(500, 42);
  let y = last + 130;
  for (const t of ['Stundenplan und Vertretungen aus deiner Schulsoftware', 'Mitteilung, wenn eine Stunde ausfällt', 'Hausaufgaben, Termine und Noten an einem Ort', 'Kostenlos und ohne Werbung']) {
    g.fillStyle = '#34d399'; g.fillText('✓', X, y);
    g.fillStyle = '#c6cddd'; y = wrap(g, t, X + 58, y, inner - 58, 54) + 18;
  }

  // unten: Abzeichen und Adresse
  const by = H - X - 40;
  g.font = font(600, 34);
  const badge = 'Projekt bei Jugend forscht 2027', bw = g.measureText(badge).width + 56;
  roundRect(g, X, by - 50, bw, 72, 36);
  g.fillStyle = 'rgba(126, 166, 255, .14)'; g.fill();
  g.lineWidth = 2; g.strokeStyle = 'rgba(126, 166, 255, .45)'; g.stroke();
  g.fillStyle = '#a9bcff'; g.fillText(badge, X + 28, by - 2);
  g.textAlign = 'right'; g.fillStyle = '#eef1f8'; g.font = font(700, 40);
  g.fillText(site, W - X, by - 2);
  g.textAlign = 'left';
}

function back(g, icon, { code, until, email, site, name, address }) {
  sky(g, 54321);
  const inner = W - 2 * X;
  g.drawImage(icon, X, 150, 96, 96);
  g.fillStyle = '#eef1f8'; g.font = font(800, 92);
  g.fillText('So bist du dabei', X + 124, 228);

  const steps = [`${site} öffnen`, '„Mit Einladungscode registrieren“', 'Code unten eingeben, fertig'];
  steps.forEach((t, i) => {
    const y = 400 + i * 128;
    g.beginPath(); g.arc(X + 38, y - 14, 38, 0, Math.PI * 2); g.fillStyle = '#7ea6ff'; g.fill();
    g.fillStyle = '#0b0e17'; g.font = font(800, 44); g.textAlign = 'center'; g.fillText(String(i + 1), X + 38, y + 2);
    g.textAlign = 'left'; g.fillStyle = '#eef1f8';
    fit(g, t, 600, 46, inner - 100);
    g.fillText(t, X + 100, y);
  });
  g.fillStyle = '#98a1b6'; g.font = font(500, 34);
  wrap(g, 'Tipp fürs iPhone: In Safari auf „Teilen“ und „Zum Home-Bildschirm“, dann bekommst du Mitteilungen.', X, 840, inner, 46);

  // Code-Karte
  const cy = 1010, ch = 400;
  roundRect(g, X, cy, inner, ch, 36);
  g.fillStyle = '#121725'; g.fill();
  g.lineWidth = 3; g.strokeStyle = '#2b3554'; g.stroke();
  g.fillStyle = '#98a1b6'; g.font = font(600, 40);
  g.fillText('Einladungscode', X + 50, cy + 90);
  g.fillStyle = '#ffffff';
  if ('letterSpacing' in g) g.letterSpacing = '10px';
  fit(g, `${code.slice(0, 3)} ${code.slice(3)}`, 800, 170, inner - 100);
  g.fillText(`${code.slice(0, 3)} ${code.slice(3)}`, X + 44, cy + 270);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.fillStyle = '#98a1b6'; g.font = font(500, 38);
  g.fillText(`gültig bis ${until}`, X + 50, cy + 350);

  let y = cy + ch + 110;
  g.fillStyle = '#eef1f8'; g.font = font(600, 40);
  if (email) { fit(g, `Fragen? ${email}`, 600, 40, inner); g.fillText(`Fragen? ${email}`, X, y); y += 70; }
  g.fillStyle = '#98a1b6'; g.font = font(500, 30);
  y = wrap(g, 'Alltag ist ein Schülerprojekt: kostenlos, ohne Werbung. Datenschutz und Impressum auf der Website.', X, y, inner, 42);
  if (name) { g.font = font(500, 28); wrap(g, `Verantwortlich: ${[name, address].filter(Boolean).join(', ')}`, X, H - X - 30, inner, 38); }
}

// ZIP ohne Kompression (JPEG und PDF sind schon gepackt): Dateikopf je Datei, Inhaltsverzeichnis, Abschluss
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (d) => { let c = 0xffffffff; for (const b of d) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files, now = new Date()) {
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], dir = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = crc32(f.data), size = f.data.length;
    const head = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, date, 2], [14, crc, 4], [18, size, 4], [22, size, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([o, v, n]) => (n === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)));
    const cd = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, date, 2], [16, crc, 4], [20, size, 4], [24, size, 4], [28, name.length, 2],
      [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([o, v, n]) => (n === 4 ? cd.setUint32(o, v, true) : cd.setUint16(o, v, true)));
    parts.push(new Uint8Array(head.buffer), name, f.data);
    dir.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + size;
  }
  const dirSize = dir.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, dirSize, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...dir, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// PDF: je Bild eine Seite in Endformat + Beschnitt; TrimBox/BleedBox sagen der Druckerei, wo geschnitten wird
export function pdf(images, trimW = TRIM_W, trimH = TRIM_H, bleed = BLEED) {
  const pt = (mm) => (mm * 72 / 25.4).toFixed(2), enc = new TextEncoder();
  const PW = pt(trimW + 2 * bleed), PH = pt(trimH + 2 * bleed), b = pt(bleed), tw = pt(trimW + bleed), th = pt(trimH + bleed);
  const parts = [], offsets = [];
  let size = 0;
  const add = (x) => { const d = typeof x === 'string' ? enc.encode(x) : x; parts.push(d); size += d.length; };
  const obj = (n, body) => { offsets[n] = size; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };
  add('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add(`<< /Type /Pages /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${images.length} >>`));
  images.forEach((im, i) => {
    const p = 3 + i * 3, draw = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    obj(p, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /BleedBox [0 0 ${PW} ${PH}] /TrimBox [${b} ${b} ${tw} ${th}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
    obj(p + 1, () => add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    obj(p + 2, () => { add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`); add(im.data); add('\nendstream'); });
  });
  const count = 3 + images.length * 3, xref = size;
  add(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

const README = `Alltag-Flyer, A6 doppelseitig

Endformat: 105 x 148 mm (A6), Hochformat
Dateien mit 3 mm Beschnitt auf jeder Seite (111 x 154 mm), 300 dpi

alltag-flyer-vorne.jpg und alltag-flyer-hinten.jpg
  Fuer Fotodruck oder Postkarten-Editor (z. B. dm): Vorderseite und Rueckseite einzeln hochladen.
  Falls der Editor kein Beschnittformat kennt: Bild auf A6 einpassen, der Rand darf abgeschnitten werden.

alltag-flyer-A6-druck.pdf
  Fuer Online-Druckereien: Seite 1 = vorne, Seite 2 = hinten, Endformat A6 mit 3 mm Beschnitt.
`;

// Vorder- und Rückseite zeichnen → { zip, front, back } (front/back = Vorschaubilder)
export async function flyerA6(info) {
  const icon = new Image();
  icon.src = '/icon.svg';
  await icon.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), out = {}, images = [];
  for (const [side, draw] of [['front', front], ['back', back]]) {
    draw(g, icon, info);
    out[side] = canvas.toDataURL('image/jpeg', 0.75);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    images.push({ data: new Uint8Array(await blob.arrayBuffer()), w: W, h: H });
  }
  out.zip = zip([
    { name: 'alltag-flyer-vorne.jpg', data: images[0].data },
    { name: 'alltag-flyer-hinten.jpg', data: images[1].data },
    { name: 'alltag-flyer-A6-druck.pdf', data: new Uint8Array(await pdf(images).arrayBuffer()) },
    { name: 'LIESMICH.txt', data: new TextEncoder().encode(README) },
  ]);
  return out;
}
