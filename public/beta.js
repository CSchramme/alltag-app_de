// Seite /beta: Anmeldung zum Beta-Test (Fragen aus formulare.js, Prüfung auf dem Server)
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const form = document.getElementById('beta-form'), err = form.querySelector('.frm-error'), btn = form.querySelector('button');
  document.getElementById('beta-fields').outerHTML = Formulare.render('beta', esc, 'beta');
  Formulare.wire(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Wird gesendet …';
    try {
      const body = { ...Formulare.read('beta', form), website: form.website.value };
      const res = await fetch('/api/beta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Das hat nicht geklappt. Bitte versuch es gleich noch einmal.');
      document.getElementById('beta-box').innerHTML = `<h2>Danke, du bist angemeldet!</h2>
        <p>Deine Tester-ID: <b>${esc(j.id)}</b>${j.again ? ' (mit dieser E-Mail warst du schon angemeldet)' : ''}.</p>
        <p>Sobald dein Platz frei ist, bekommst du eine Mail mit deinem Einladungscode. Schau auch im Spam-Ordner nach.</p>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (x) {
      err.textContent = x.message;
      btn.disabled = false;
      btn.textContent = 'Anmelden';
    }
  });
})();
