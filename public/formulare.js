/* Alltag – Formulare des Beta-Tests (Anmeldung, Rückmeldung, Abschlussumfrage). Einmal beschrieben, genutzt von
   Server (Prüfung), App und Seite /beta (Darstellung). Ersetzt die Google Forms. Wie recur.js: im Browser window.Formulare. */
(function (root) {
  const ZUSTIMMUNG = 'Ich stimme zu';
  const FORMS = {
    beta: [
      { section: 'Über dich' },
      { name: 'vorname', label: 'Vorname', type: 'text', max: 60, required: true, auto: 'given-name' },
      { name: 'nachname', label: 'Nachname', type: 'text', max: 60, required: true, auto: 'family-name' },
      { name: 'email', label: 'E-Mail-Adresse', type: 'email', max: 120, required: true, auto: 'email', hint: 'Dahin schicken wir deinen Einladungscode.' },
      { name: 'alter', label: 'Alter', type: 'number', min: 8, max: 99, required: true },
      { name: 'land', label: 'Land', type: 'select', options: ['Deutschland', 'Österreich', 'Schweiz'], required: true },
      { name: 'schule', label: 'Schule (optional)', type: 'text', max: 120 },
      { name: 'schulsoftware', label: 'Welche Schulsoftware nutzt deine Schule?', type: 'radio', options: ['EduPage', 'WebUntis', 'Schulmanager', 'Keine', 'Weiß nicht'], required: true },
      { section: 'Technik' },
      { name: 'geraete', label: 'Welche Geräte nutzt du?', type: 'multi', options: ['Handy', 'Tablet', 'Laptop', 'Computer'], required: true },
      { name: 'systeme', label: 'Welche Betriebssysteme?', type: 'multi', options: ['iOS', 'Android', 'Windows', 'macOS', 'Linux'], required: true },
      { name: 'browser', label: 'Welche Browser?', type: 'multi', options: ['Safari', 'Chrome', 'Edge', 'Firefox', 'Opera', 'Samsung Internet'], required: true },
      { name: 'erfahrung', label: 'Wie gut kennst du dich mit Websites und Apps aus?', type: 'scale', min: 1, max: 5, low: 'kaum', high: 'sehr gut', required: true },
      { name: 'hauptgeraet', label: 'Wo testest du hauptsächlich?', type: 'select', options: ['Handy', 'Tablet', 'Laptop', 'Computer'], required: true },
      { section: 'Beta-Test' },
      { name: 'proWoche', label: 'Wie oft kannst du pro Woche testen?', type: 'select', options: ['1 Mal', '2–4 Mal', '5–6 Mal', 'täglich', 'mehrmals täglich'], required: true },
      { name: 'fehlerMelden', label: 'Bist du bereit, Fehler und Probleme zu melden?', type: 'radio', options: ['Ja', 'Nein'], required: true },
      { name: 'feedbackGeben', label: 'Bist du bereit, am Ende eine kurze Rückmeldung zu geben?', type: 'radio', options: ['Ja', 'Nein'], required: true },
      { section: 'Datenschutz und Teilnahme' },
      { name: 'datenschutz', label: 'Ich bin einverstanden, dass meine Angaben für die Organisation des Beta-Tests verarbeitet werden (siehe Datenschutzerklärung).', type: 'check', required: true },
      { name: 'freiwillig', label: 'Ich nehme freiwillig teil und kann jederzeit aufhören.', type: 'check', required: true },
      { name: 'praesentation', label: 'Die Testergebnisse dürfen ohne meinen Namen bei Jugend forscht 2027 gezeigt werden.', type: 'check', required: true },
      { name: 'eltern', label: 'Ich bin mindestens 16 Jahre alt, oder meine Eltern sind einverstanden.', type: 'check', required: true },
    ],
    feedback: [
      { name: 'art', label: 'Worum geht es?', type: 'radio', options: ['Fehler', 'Idee', 'Frage'], required: true },
      { name: 'titel', label: 'Kurz in einem Satz', type: 'text', max: 120, required: true },
      { name: 'beschreibung', label: 'Was genau ist passiert, oder was wünschst du dir?', type: 'textarea', max: 3000, required: true },
      { name: 'wann', label: 'Wann ist es aufgetreten?', type: 'text', max: 80, hint: 'z. B. „heute 7:30 beim Öffnen“', showIf: ['art', 'Fehler'] },
      { name: 'schritte', label: 'Wie kann man es nachstellen?', type: 'textarea', max: 2000, hint: 'Was hast du nacheinander gemacht?', showIf: ['art', 'Fehler'] },
    ],
    umfrage: [
      { name: 'dauer', label: 'Wie lange nutzt du Alltag schon?', type: 'radio', options: ['unter 1 Woche', '1–2 Wochen', '3–4 Wochen', 'länger'], required: true },
      { name: 'haeufigkeit', label: 'Wie oft öffnest du die App?', type: 'radio', options: ['mehrmals täglich', 'täglich', 'ein paarmal pro Woche', 'seltener'], required: true },
      { name: 'geraete', label: 'Auf welchen Geräten nutzt du sie?', type: 'multi', options: ['iPhone', 'Android', 'Tablet', 'PC'], required: true },
      { name: 'frueher', label: 'Hat Alltag dir eine Änderung (Vertretung, Entfall, Nachricht) gemeldet, bevor du sie anders erfahren hättest?', type: 'radio', options: ['nie', '1 Mal', '2–5 Mal', 'öfter'], required: true },
      { name: 'funktionen', label: 'Welche Funktionen nutzt du?', type: 'multi', options: ['Stundenplan', 'Mitteilungen', 'Hausaufgaben', 'Termine/Erinnerungen', 'Noten', 'Lernplan', 'Schulweg', 'Widget'], required: true },
      { name: 'einrichtung', label: 'Wie einfach war die Einrichtung?', type: 'scale', min: 1, max: 5, low: 'schwer', high: 'sehr einfach', required: true },
      { name: 'zuverlaessig', label: 'Wie zuverlässig stimmen die angezeigten Schuldaten?', type: 'scale', min: 1, max: 5, low: 'oft falsch', high: 'immer richtig', required: true },
      { name: 'empfehlung', label: 'Wie wahrscheinlich empfiehlst du Alltag einer Freundin oder einem Freund?', type: 'scale', min: 0, max: 10, low: 'gar nicht', high: 'sehr wahrscheinlich', required: true },
      { name: 'besser', label: 'Was sollte besser werden? (optional)', type: 'textarea', max: 2000 },
      { name: 'fehlt', label: 'Was fehlt dir noch? (optional)', type: 'textarea', max: 2000 },
    ],
  };

  const EMAIL = /^[^\s@<>"(),;:]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i;
  const visible = (f, v) => !f.showIf || v[f.showIf[0]] === f.showIf[1];
  // Antworten prüfen: nur erlaubte Werte, Pflichtfelder, Längen. Gibt { values } oder { error } zurück.
  function check(id, body) {
    const values = {};
    for (const f of FORMS[id] || []) {
      if (!f.name) continue;
      let v = body?.[f.name];
      if (!visible(f, { ...values, ...body })) continue;
      if (f.type === 'multi') {
        v = (Array.isArray(v) ? v : v == null ? [] : [v]).map(String).filter((x) => f.options.includes(x));
        if (f.required && !v.length) return { error: `Bitte bei „${f.label}“ mindestens eins wählen.` };
      } else if (f.type === 'check') {
        v = v === true || v === 'ja' || v === 'on' || v === ZUSTIMMUNG;
        if (f.required && !v) return { error: 'Bitte allen Punkten zu Datenschutz und Teilnahme zustimmen.' };
      } else if (f.type === 'scale' || f.type === 'number') {
        v = v === '' || v == null ? null : Number(v);
        if (v != null && (!Number.isInteger(v) || v < f.min || v > f.max)) return { error: `„${f.label}“: bitte eine Zahl von ${f.min} bis ${f.max}.` };
        if (f.required && v == null) return { error: `Bitte „${f.label}“ beantworten.` };
      } else {
        v = String(v ?? '').trim().slice(0, f.max || 200);
        if ((f.type === 'select' || f.type === 'radio') && v && !f.options.includes(v)) return { error: `„${f.label}“: ungültige Auswahl.` };
        if (f.type === 'email' && v && !EMAIL.test(v)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' };
        if (f.required && !v) return { error: `Bitte „${f.label}“ ausfüllen.` };
      }
      values[f.name] = v;
    }
    return { values };
  }

  // Darstellung im Browser (App und /beta): schlichte, zugängliche Felder; Aussehen in app.css (.frm-…)
  function render(id, esc, prefix = 'f') {
    return (FORMS[id] || []).map((f, i) => {
      if (f.section) return `<h3 class="frm-sec">${esc(f.section)}</h3>`;
      const req = f.required ? ' required' : '', star = f.required ? ' <i aria-hidden="true">*</i>' : '', hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
      const show = f.showIf ? ` data-show-if="${esc(f.showIf[0])}=${esc(f.showIf[1])}"` : '', uid = `${prefix}-${f.name}`;
      if (f.type === 'check') return `<label class="frm-check"${show}><input type="checkbox" name="${f.name}" value="ja"${req}><span>${esc(f.label)}</span></label>`;
      if (f.type === 'radio' || f.type === 'multi' || f.type === 'scale') {
        const opts = f.type === 'scale' ? Array.from({ length: f.max - f.min + 1 }, (_, k) => String(f.min + k)) : f.options;
        const input = f.type === 'multi' ? 'checkbox' : 'radio';
        return `<fieldset class="frm-field frm-${f.type}"${show}><legend>${esc(f.label)}${star}</legend>${hint}
          <div class="frm-chips">${opts.map((o, k) => `<label><input type="${input}" name="${f.name}" value="${esc(o)}"${input === 'radio' && f.required && !k ? ' required' : ''}><span>${esc(o)}</span></label>`).join('')}</div>
          ${f.type === 'scale' ? `<div class="frm-ends"><span>${esc(f.low)}</span><span>${esc(f.high)}</span></div>` : ''}</fieldset>`;
      }
      const field = f.type === 'textarea' ? `<textarea id="${uid}" name="${f.name}" rows="4" maxlength="${f.max}"${req}></textarea>`
        : f.type === 'select' ? `<select id="${uid}" name="${f.name}"${req}><option value="">Bitte wählen</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
          : `<input id="${uid}" name="${f.name}" type="${f.type}"${f.type === 'number' ? ` min="${f.min}" max="${f.max}" inputmode="numeric"` : ''}${f.max && f.type !== 'number' ? ` maxlength="${f.max}"` : ''}${f.auto ? ` autocomplete="${f.auto}"` : ''}${req}>`;
      return `<div class="frm-field"${show}><label for="${uid}">${esc(f.label)}${star}</label>${hint}${field}</div>`;
    }).join('');
  }
  // Werte aus einem Formular lesen (Mehrfachauswahl als Liste) und bedingte Felder ein-/ausblenden
  function read(id, form) {
    const fd = new FormData(form), out = {};
    for (const f of FORMS[id] || []) if (f.name) out[f.name] = f.type === 'multi' ? fd.getAll(f.name) : f.type === 'check' ? fd.has(f.name) : fd.get(f.name);
    return out;
  }
  function wire(form) {
    const update = () => form.querySelectorAll('[data-show-if]').forEach((el) => {
      const [k, v] = el.dataset.showIf.split('='), on = new FormData(form).get(k) === v;
      el.hidden = !on;
    });
    form.addEventListener('change', update);
    update();
  }

  const api = { FORMS, check, render, read, wire };
  if (typeof module !== 'undefined') module.exports = api; else root.Formulare = api;
})(typeof window !== 'undefined' ? window : globalThis);
