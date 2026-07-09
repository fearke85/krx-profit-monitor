import { TIMEZONE } from './config';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function toBrtDay(timestampMs: number): string {
  return dayFormatter.format(new Date(timestampMs));
}

export function todayBrt(): string {
  return toBrtDay(Date.now());
}

export function daysAgoBrt(n: number): string {
  const today = todayBrt();
  const [y, m, d] = today.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d) - n * 86_400_000;
  const dt = new Date(base);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
