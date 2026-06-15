import { config } from './config.js';

// Formata um timestamp (ms epoch) como dia-calendário "YYYY-MM-DD" no fuso configurado
// (Brasília). 'en-CA' produz exatamente o formato ISO de data.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function toBrtDay(timestampMs: number): string {
  return dayFormatter.format(new Date(timestampMs));
}

// Dia corrente no fuso de Brasília.
export function todayBrt(): string {
  return toBrtDay(Date.now());
}

// "YYYY-MM-DD" de N dias atrás (contagem por dia-calendário simples, baseada em hoje BRT).
export function daysAgoBrt(n: number): string {
  const today = todayBrt();
  const [y, m, d] = today.split('-').map(Number);
  // Usa UTC só como aritmética de calendário; reformatamos como string pura.
  const base = Date.UTC(y, m - 1, d) - n * 86_400_000;
  const dt = new Date(base);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
