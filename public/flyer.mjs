// Flyer zum Ausdrucken: 10 × 15 cm bei 300 dpi (Fotoformat, z. B. dm-Fotodruck), je Flyer ein eigener Einladungscode.
// Alle Bilder kommen in eine ZIP-Datei. Wird erst geladen, wenn ein Admin Flyer erstellt.
export const W = 1200, H = 1800;
const SANS = 'Inter, "Segoe UI", -apple-system, system-ui, Roboto, sans-serif';
const font = (weight, size) => `${weight} ${size}px ${SANS}`;

// Zeilenumbruch für Canvas: gibt die y-Position nach dem letzten Absatz zurück
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

function draw(g, icon, { code, until, email, site }) {
  // Hintergrund wie die Startseite: fast schwarzes Blau mit Sternen (je Code etwas anders verteilt)
  g.fillStyle = '#0b0e17';
  g.fillRect(0, 0, W, H);
  let seed = Number(code) + 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(190, 205, 255, ${0.12 + rnd() * 0.45})`;
    g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.8 + rnd() * 1.8, 0, Math.PI * 2); g.fill();
  }
  const X = 90, inner = W - 2 * X;
  g.drawImage(icon, X, 100, 150, 150);
  g.fillStyle = '#eef1f8'; g.font = font(800, 96);
  g.fillText('Alltag', X + 180, 208);

  g.font = font(800, 86);
  ['Kalender,', 'Stundenplan,', 'Hausaufgaben.'].forEach((t, i) => g.fillText(t, X, 420 + i * 98));
  const grad = g.createLinearGradient(X, 0, X + 880, 0);
  grad.addColorStop(0, '#a9bcff'); grad.addColorStop(1, '#a191ff');
  g.fillStyle = grad;
  g.fillText('Alles in einer App.', X, 714);

  g.font = font(500, 38);
  let y = 820;
  for (const t of ['Stundenplan und Vertretungen aus deiner Schulsoftware', 'Mitteilung, wenn eine Stunde ausfällt', 'Termine, Hausaufgaben und Noten an einem Ort']) {
    g.fillStyle = '#34d399'; g.fillText('✓', X, y);
    g.fillStyle = '#c6cddd'; y = wrap(g, t, X + 52, y, inner - 52, 50) + 14;
  }

  // Code-Karte
  const cy = 1060;
  roundRect(g, X, cy, inner, 390, 36);
  g.fillStyle = '#121725'; g.fill();
  g.lineWidth = 3; g.strokeStyle = '#2b3554'; g.stroke();
  g.fillStyle = '#98a1b6'; g.font = font(600, 38);
  g.fillText('Dein Einladungscode', X + 50, cy + 82);
  g.fillStyle = '#ffffff'; g.font = font(800, 156);
  if ('letterSpacing' in g) g.letterSpacing = '8px';
  g.fillText(`${code.slice(0, 3)} ${code.slice(3)}`, X + 44, cy + 250);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.fillStyle = '#98a1b6'; g.font = font(500, 36);
  g.fillText(`gültig bis ${until} · nur einmal nutzbar`, X + 50, cy + 330);

  // So geht's
  g.fillStyle = '#eef1f8'; g.font = font(600, 40);
  [`1.  ${site} öffnen`, '2.  „Mit Einladungscode registrieren“', '3.  Code eingeben, fertig'].forEach((t, i) => g.fillText(t, X, 1550 + i * 62));

  g.fillStyle = '#98a1b6'; g.font = font(500, 32);
  if (email) g.fillText(`Fragen? ${email}`, X, 1750);
  g.textAlign = 'right';
  g.fillText('Jugend forscht 2027', W - X, 1750);
  g.textAlign = 'left';
}

// ZIP ohne Kompression (JPEGs sind schon gepackt): Dateikopf je Datei, Inhaltsverzeichnis, Abschluss
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

// Alle Flyer zeichnen → { zip, preview } (preview = Bild des ersten Flyers zum Anzeigen)
export async function flyers({ codes, until, email, site }) {
  const icon = new Image();
  icon.src = '/icon.svg';
  await icon.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), files = [];
  let preview = '';
  for (const [i, code] of codes.entries()) {
    draw(g, icon, { code, until, email, site });
    if (!i) preview = canvas.toDataURL('image/jpeg', 0.8);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    files.push({ name: `alltag-flyer-${String(i + 1).padStart(2, '0')}-${code}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return { zip: zip(files), preview };
}
