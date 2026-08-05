/** Display helpers shared by the exam timer, result tables and review cards. */

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Seconds → "MM:SS", clamped at zero. Used by every timer readout. */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** Seconds → "38m". Used wherever a duration is summarised. */
export function fmtMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)}m`;
}

/** "Aarav Sharma" → "AS". Falls back to the first character for single-word names. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

/** "12 Jun" — the compact date used in results lists. */
export function fmtShortDate(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** "12 Jun, 09:30 am" — the submitted-at stamp on the result hero. */
export function fmtSubmittedAt(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function greetingFor(date: Date, firstName: string): string {
  const hour = date.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${firstName}.`;
}
