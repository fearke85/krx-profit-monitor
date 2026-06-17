// Locale dos formatadores numéricos/data. Atualizado pelo SettingsProvider conforme o idioma.
let locale = 'pt-BR';
export function setLocale(l: string): void {
  locale = l;
}

export const fmtNum = (v: number, opts?: Intl.NumberFormatOptions) =>
  v.toLocaleString(locale, opts);

export const fmtKrx = (v: number) =>
  v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export const fmtUsdt = (v: number) =>
  v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const fmtPrice = (v: number) =>
  v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export function fmtTime(ms: number): string {
  if (!ms) return '—';
  // Sempre no fuso do report (Brasília), mas com o locale do idioma selecionado.
  return new Date(ms).toLocaleString(locale, { timeZone: 'America/Sao_Paulo' });
}
