/** "3m ago", "2h ago", "5d ago" … from an ISO timestamp. */
export function formatRelativeTime(iso: string): string {
  if (!iso) {
    return "";
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 5) {
    return "just now";
  }
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.round(hr / 24);
  if (day < 30) {
    return `${day}d ago`;
  }
  const mo = Math.round(day / 30);
  if (mo < 12) {
    return `${mo}mo ago`;
  }
  return `${Math.round(mo / 12)}y ago`;
}

/** Locale-formatted absolute timestamp, for tooltips. */
export function formatAbsolute(iso: string): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleString();
}
