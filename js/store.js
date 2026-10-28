// Sparar på telefonen (localStorage). Tål att lagringen är full eller avstängd.
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {
      // Fullt: släng gamla analyser och försök igen.
      try {
        Object.keys(localStorage).filter(x => x.startsWith('pos:')).slice(0, 10).forEach(x => localStorage.removeItem(x));
        localStorage.setItem(k, JSON.stringify(v));
      } catch { /* ingen lagring */ }
    }
  },
};

export const hash = s => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + s.length;
};

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => iso(new Date());
export const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
