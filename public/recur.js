// Wiederholungen für Termine und Erinnerungen – dieselbe Regel nutzen Server (Mitteilungen) und App (Kalender).
(function (root) {
  const day = (s) => new Date(`${s}T12:00:00`); // Mittag: Sommer-/Winterzeit verschiebt keinen Tag
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function occursOn(item, date) {
    const start = item.date || item.due;
    if (!start || date < start || (item.until && date > item.until)) return false;
    if (date === start) return true;
    const a = day(start), b = day(date), diff = Math.round((b - a) / 864e5);
    switch (item.repeat) {
      case 'daily': return true;
      case 'weekdays': return b.getDay() % 6 !== 0;
      case 'weekly': return diff % 7 === 0;
      case 'biweekly': return diff % 14 === 0;
      case 'monthly': return b.getDate() === a.getDate();
      default: return false;
    }
  }

  function nextOccurrence(item, after) {
    const d = day(after);
    for (let i = 0; i < 400; i++) {
      d.setDate(d.getDate() + 1);
      const s = iso(d);
      if (item.until && s > item.until) return null;
      if (occursOn(item, s)) return s;
    }
    return null;
  }

  const REPEAT = [['', 'Nie'], ['daily', 'Täglich'], ['weekdays', 'Werktags'], ['weekly', 'Wöchentlich'], ['biweekly', 'Alle 2 Wochen'], ['monthly', 'Monatlich']];
  const api = { occursOn, nextOccurrence, REPEAT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Recur = api;
})(this);
