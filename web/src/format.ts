export const fmtKrx = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export const fmtUsdt = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const fmtPrice = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export function fmtTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
