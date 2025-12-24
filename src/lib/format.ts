export function shortAddr(addr: string) {
  if (!addr) return "";
  const a = addr.toLowerCase();
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function hhmm(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
