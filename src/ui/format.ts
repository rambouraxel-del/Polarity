/** Temps au format m:ss,d (virgule décimale française). */
export function formatTime(seconds: number, decimals = 1): string {
  const s = Math.max(0, seconds);
  const factor = Math.pow(10, decimals);
  const total = Math.floor(s * factor + 1e-6) / factor;
  const m = Math.floor(total / 60);
  const rest = total - m * 60;
  const whole = Math.floor(rest + 1e-9);
  let out = `${m}:${String(whole).padStart(2, '0')}`;
  if (decimals > 0) {
    const frac = Math.round((rest - whole) * factor);
    out += `,${String(Math.min(frac, factor - 1)).padStart(decimals, '0')}`;
  }
  return out;
}

/** Durée signée courte : « +3,2 s » ou « −1:04,5 ». */
export function formatDelta(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '−';
  const a = Math.abs(seconds);
  if (a < 60) return `${sign}${a.toFixed(1).replace('.', ',')} s`;
  return `${sign}${formatTime(a)}`;
}

/** Nombre avec espaces fines comme séparateurs de milliers. */
export function formatScore(n: number): string {
  const s = String(Math.floor(Math.max(0, n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function starsHtml(n: number, total = 3): string {
  let out = '';
  for (let i = 0; i < total; i++) out += i < n ? '★' : '<span class="off">★</span>';
  return out;
}
