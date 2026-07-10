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

/** Lista inclusiva de dias-calendário "YYYY-MM-DD" entre from e to (ordem crescente). */
export function eachDayBrt(from: string, to: string): string[] {
  if (from > to) return [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let ms = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  const out: string[] = [];
  while (ms <= end) {
    const dt = new Date(ms);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yy}-${mm}-${dd}`);
    ms += 86_400_000;
  }
  return out;
}
