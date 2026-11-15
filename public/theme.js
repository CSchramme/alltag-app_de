// Erscheinungsbild (Hell/Dunkel/Automatisch) und Glas (Getönt/Klar) vor dem ersten Zeichnen setzen –
// sonst blitzt kurz der helle Modus auf. Einstellungen gelten pro Gerät, wie bei Apple.
(function () {
  const root = document.documentElement, mq = matchMedia('(prefers-color-scheme: dark)');
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  window.applyLook = function () {
    const mode = get('look', 'auto'), dark = mode === 'dark' || (mode === 'auto' && mq.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.glass = get('glass', 'tinted');
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = dark ? '#0b0d14' : '#EEF1F8';
  };
  window.applyLook();
  if (mq.addEventListener) mq.addEventListener('change', window.applyLook);
})();
