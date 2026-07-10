import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { setLocale } from './format';

export type Lang = 'pt' | 'en';
export type Theme = 'dark' | 'light';

const LOCALE: Record<Lang, string> = { pt: 'pt-BR', en: 'en-US' };

// Dicionário de traduções. Placeholders no formato {nome} são substituídos por t(key, vars).
const DICT: Record<Lang, Record<string, string>> = {
  pt: {
    'app.subtitle': 'Rentabilidade da mineração KERYX · dia fechado em horário de Brasília · auto a cada 5 min',
    'app.updated': 'Atualizado',
    'app.refresh': 'Atualizar',
    'app.refreshing': 'Atualizando…',
    'app.loading': 'Carregando…',
    'app.error': 'Erro: {msg}',
    'app.changeWallet': 'trocar wallet',
    'app.footerNote': 'USDT é estimativa (preço nonkyc); KRX recebido é exato. Dados ficam neste navegador (IndexedDB).',
    'app.themeToggle': 'Alternar tema claro/escuro',

    'wallet.section': 'Histórico diário de produção',
    'wallet.perDay': 'KRX produzido por dia (BRT)',

    'range.7d': '7 dias',
    'range.30d': '30 dias',
    'range.90d': '90 dias',
    'range.all': 'Tudo',

    'summary.todayReceived': 'Produzido hoje (KRX)',
    'summary.todaySub': '≈ {usdt} USDT · {txs} txs · {day}',
    'summary.totalBalance': 'Saldo total',
    'summary.totalBalanceSub': '≈ {usdt} USDT',
    'summary.price': 'Preço KRX (nonkyc)',
    'summary.priceSub': 'lastPrice KRX/USDT',
    'summary.synced': 'Sincronizado · {txs} txs',
    'summary.resolving': ' · resolvendo horários ({n} pendentes)',
    'summary.lastSync': ' · última sync: {time}',
    'summary.backfill': 'Backfill em andamento ({phase})… {ingested}{total} txs',

    'daily.tooltipSub': '{txs} txs · preço {src}',
    'daily.priceCurrent': 'atual',
    'daily.priceDay': 'do dia',
    'daily.colDay': 'Dia (BRT)',
    'daily.colReceived': 'Produzido (KRX)',
    'daily.colTxs': 'Txs',
    'daily.colPrice': 'Preço usado',
    'daily.colEst': 'Estimativa (USDT)',
    'daily.empty': 'Sem produção no período (ainda sincronizando ou sem txs).',
    'daily.total': 'Total do período',
    'daily.avg': 'Média/dia (dias com produção)',
    'daily.periodMeta': '{from} → {to}',

    'wallet.configure': 'Configurar wallet',
    'wallet.hintBefore': 'Cole o endereço KERYX que você quer monitorar (formato ',
    'wallet.hintAfter': '). Ele fica salvo neste navegador (IndexedDB) — não sobe para nenhum servidor nosso.',
    'wallet.placeholder': 'keryx:… (cole seu endereço completo)',
    'wallet.validating': 'Validando…',
    'wallet.save': 'Salvar e sincronizar',
    'wallet.cancel': 'Cancelar',
    'wallet.changeHint': 'Trocar de wallet recarrega o histórico do novo endereço (re-sincronização).',

    'age.sec': '{n}s atrás',
    'age.min': '{n}min atrás',
    'age.hour': '{n}h atrás',

    // ---- estratégia de realização de lucro ----
    'strategy.title': 'Realização de lucro',
    'strategy.batch': 'Lote {acc} / {target} KRX',
    'strategy.batchSub': 'Saldo na carteira: {balance} KRX',
    'strategy.eta': 'ETA: ~ {hours}h ({days}d) ao ritmo atual',
    'strategy.etaNone': 'ETA: — (já atingiu o alvo)',
    'strategy.etaNoRate': 'ETA: — (sem histórico recente on-chain)',
    'strategy.priceWindow': 'Janela de preço 24h',
    'strategy.priceRange': 'Mín {min} · Máx {max} · Atual {cur}',
    'strategy.signalHigh': '▲ Preço em janela alta',
    'strategy.signalNeutral': '● Preço neutro',
    'strategy.signalLow': '▼ Preço em janela baixa',
    'strategy.alertReady': '⚡ Lote de {target} KRX pronto!',
    'strategy.alertPrice': '📈 Preço favorável — hora de depositar!',
    'strategy.alertBoth': '⚡📈 Lote cheio E preço na janela alta — realize o lucro!',
    'strategy.accumulating': 'Aguardando dados de preço… (até 1h para calibrar a janela)',
    'strategy.noWallet': 'Configure uma wallet para ver a estratégia.',
  },
  en: {
    'app.subtitle': 'KERYX mining profitability · day closed in Brasília time · auto every 5 min',
    'app.updated': 'Updated',
    'app.refresh': 'Refresh',
    'app.refreshing': 'Refreshing…',
    'app.loading': 'Loading…',
    'app.error': 'Error: {msg}',
    'app.changeWallet': 'change wallet',
    'app.footerNote': 'USDT is an estimate (nonkyc price); KRX received is exact. Data stays in this browser (IndexedDB).',
    'app.themeToggle': 'Toggle light/dark theme',

    'wallet.section': 'Daily production history',
    'wallet.perDay': 'KRX produced per day (BRT)',

    'range.7d': '7 days',
    'range.30d': '30 days',
    'range.90d': '90 days',
    'range.all': 'All',

    'summary.todayReceived': 'Produced today (KRX)',
    'summary.todaySub': '≈ {usdt} USDT · {txs} txs · {day}',
    'summary.totalBalance': 'Total balance',
    'summary.totalBalanceSub': '≈ {usdt} USDT',
    'summary.price': 'KRX price (nonkyc)',
    'summary.priceSub': 'lastPrice KRX/USDT',
    'summary.synced': 'Synced · {txs} txs',
    'summary.resolving': ' · resolving timestamps ({n} pending)',
    'summary.lastSync': ' · last sync: {time}',
    'summary.backfill': 'Backfill in progress ({phase})… {ingested}{total} txs',

    'daily.tooltipSub': '{txs} txs · {src} price',
    'daily.priceCurrent': 'current',
    'daily.priceDay': 'of the day',
    'daily.colDay': 'Day (BRT)',
    'daily.colReceived': 'Produced (KRX)',
    'daily.colTxs': 'Txs',
    'daily.colPrice': 'Price used',
    'daily.colEst': 'Estimate (USDT)',
    'daily.empty': 'No production in this range (still syncing or no txs).',
    'daily.total': 'Range total',
    'daily.avg': 'Avg/day (days with production)',
    'daily.periodMeta': '{from} → {to}',

    'wallet.configure': 'Configure wallet',
    'wallet.hintBefore': 'Paste the KERYX address you want to monitor (format ',
    'wallet.hintAfter': '). It is stored in this browser (IndexedDB) — it is not uploaded to any server of ours.',
    'wallet.placeholder': 'keryx:… (paste your full address)',
    'wallet.validating': 'Validating…',
    'wallet.save': 'Save and sync',
    'wallet.cancel': 'Cancel',
    'wallet.changeHint': 'Changing the wallet reloads the new address history (re-sync).',

    'age.sec': '{n}s ago',
    'age.min': '{n}min ago',
    'age.hour': '{n}h ago',

    // ---- profit-taking strategy ----
    'strategy.title': 'Profit taking',
    'strategy.batch': 'Batch {acc} / {target} KRX',
    'strategy.batchSub': 'Wallet balance: {balance} KRX',
    'strategy.eta': 'ETA: ~ {hours}h ({days}d) at current rate',
    'strategy.etaNone': 'ETA: — (target already reached)',
    'strategy.etaNoRate': 'ETA: — (no recent on-chain history)',
    'strategy.priceWindow': '24h price window',
    'strategy.priceRange': 'Low {min} · High {max} · Now {cur}',
    'strategy.signalHigh': '▲ Price in high window',
    'strategy.signalNeutral': '● Neutral price',
    'strategy.signalLow': '▼ Price in low window',
    'strategy.alertReady': '⚡ Batch of {target} KRX is ready!',
    'strategy.alertPrice': '📈 Favorable price — time to deposit!',
    'strategy.alertBoth': '⚡📈 Full batch AND high price window — realize profit!',
    'strategy.accumulating': 'Waiting for price data… (up to 1h to calibrate the window)',
    'strategy.noWallet': 'Configure a wallet to see the strategy.',
  },
};

type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface SettingsCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  t: TFn;
}

const Ctx = createContext<SettingsCtx | null>(null);

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStored('krx.lang', ['pt', 'en'] as const, 'pt'));
  const [theme, setThemeState] = useState<Theme>(() =>
    readStored('krx.theme', ['dark', 'light'] as const, 'dark'),
  );

  useEffect(() => {
    setLocale(LOCALE[lang]);
    document.documentElement.lang = LOCALE[lang];
    localStorage.setItem('krx.lang', lang);
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('krx.theme', theme);
  }, [theme]);

  const t: TFn = (key, vars) => {
    let s = DICT[lang][key] ?? DICT.pt[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };

  return (
    <Ctx.Provider
      value={{
        lang,
        setLang: setLangState,
        theme,
        setTheme: setThemeState,
        toggleTheme: () => setThemeState((p) => (p === 'dark' ? 'light' : 'dark')),
        t,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings deve ser usado dentro de <SettingsProvider>');
  return ctx;
}
