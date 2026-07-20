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

    // ---- calculadora de rentabilidade ----
    'tab.dashboard': 'Dashboard',
    'tab.calculator': 'Calculadora',
    'calc.title': 'Calculadora de rentabilidade',
    'calc.intro':
      'Estime a produção de KRX e o lucro a partir do seu hashrate. O cálculo usa hashrate e recompensa de bloco do explorer Keryx Labs e o preço KRX/USDT da nonkyc.',
    'calc.hashrate': 'Hashrate',
    'calc.bracket': 'Bracket (holder reward)',
    'calc.bracketOpt': 'Bracket {id} · {req} produção diária · {pct}%',
    'calc.bracketHint':
      'O bracket vem do holder reward: quanto mais KRX o minerador mantém (effective balance, coin-age) em relação à produção de 24h, maior a fração da recompensa (50% → 100%). Minerando SOLO, vale o SEU bracket (busque seu endereço no Explorer). Minerando em POOL, vale o bracket da POOL — confira o keeper atual na página dela, pois muda com o tempo.',
    'calc.feeToggle': 'Fee (pool/minerador)',
    'calc.currency': 'Moeda',
    'calc.kwh': 'Energia ({cur}/kWh)',
    'calc.power': 'Consumo do rig (W)',
    'calc.loading': 'Carregando dados da rede…',
    'calc.error': 'Não consegui carregar dados da rede: {msg}',
    'calc.fxMissing': 'Câmbio USD→BRL indisponível no momento — valores exibidos em USD.',
    'calc.prodDay': 'Produção 24h',
    'calc.revenueDay': 'Receita 24h',
    'calc.energyDay': 'Energia: {cost}/dia',
    'calc.profitDay': 'Lucro 24h',
    'calc.share': 'Sua fração do hashrate da rede: {pct}%',
    'calc.bracketApplied': 'Bracket {id} aplicado ({pct}% da recompensa)',
    'calc.colPeriod': 'Período',
    'calc.colKrx': 'Produção (KRX)',
    'calc.colRevenue': 'Receita ({cur})',
    'calc.colEnergy': 'Energia ({cur})',
    'calc.colProfit': 'Lucro ({cur})',
    'calc.period24h': '24 horas',
    'calc.periodWeek': 'Semana (7d)',
    'calc.periodMonth': 'Mês (30d)',
    'calc.netMeta':
      'Rede (Keryx Labs): {hashrate}{smoothed} · 10 blocos/s · Recompensa/bloco: {reward} KRX · Preço: {price} USDT (nonkyc)',
    'calc.netMetaSmoothed2h': ' (média ~2h)',
    'calc.fxLabel': ' · USD/BRL: {rate}',
    'calc.disclaimer':
      'Estimativa explorer-first: assume hashrate da rede, bracket e preço constantes. A produção real varia com a sorte e as condições da rede. Estimativas de pool servem só para comparação.',
    'calc.chartTitle': 'Previsto × realizado (KRX/dia)',
    'calc.predicted': 'Previsto',
    'calc.actual': 'Realizado',
    'calc.chartEmpty':
      'O comparativo aparece a partir do primeiro dia com previsão registrada. Configure a calculadora e volte amanhã — cada dia grava um snapshot da previsão para comparar com o que caiu na wallet.',
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

    // ---- profitability calculator ----
    'tab.dashboard': 'Dashboard',
    'tab.calculator': 'Calculator',
    'calc.title': 'Profitability calculator',
    'calc.intro':
      'Estimate KRX production and profit from your hashrate. It uses network hashrate and block reward from the Keryx Labs explorer and the KRX/USDT price from nonkyc.',
    'calc.hashrate': 'Hashrate',
    'calc.bracket': 'Bracket (holder reward)',
    'calc.bracketOpt': 'Bracket {id} · {req} daily production · {pct}%',
    'calc.bracketHint':
      'The bracket comes from the holder reward: the more KRX the miner holds (effective balance, coin-age) relative to 24h production, the bigger the share of the block reward (50% → 100%). Mining SOLO, YOUR bracket applies (search your address on the Explorer). Mining on a POOL, the POOL’s bracket applies — check its current keeper on the pool page, as it drifts over time.',
    'calc.feeToggle': 'Fee (pool/miner)',
    'calc.currency': 'Currency',
    'calc.kwh': 'Electricity ({cur}/kWh)',
    'calc.power': 'Rig power draw (W)',
    'calc.loading': 'Loading network data…',
    'calc.error': 'Could not load network data: {msg}',
    'calc.fxMissing': 'USD→BRL rate unavailable right now — values shown in USD.',
    'calc.prodDay': '24h production',
    'calc.revenueDay': '24h revenue',
    'calc.energyDay': 'Electricity: {cost}/day',
    'calc.profitDay': '24h profit',
    'calc.share': 'Your share of the network hashrate: {pct}%',
    'calc.bracketApplied': 'Bracket {id} applied ({pct}% of the reward)',
    'calc.colPeriod': 'Period',
    'calc.colKrx': 'Production (KRX)',
    'calc.colRevenue': 'Revenue ({cur})',
    'calc.colEnergy': 'Electricity ({cur})',
    'calc.colProfit': 'Profit ({cur})',
    'calc.period24h': '24 hours',
    'calc.periodWeek': 'Week (7d)',
    'calc.periodMonth': 'Month (30d)',
    'calc.netMeta':
      'Network (Keryx Labs): {hashrate}{smoothed} · 10 blocks/s · Reward/block: {reward} KRX · Price: {price} USDT (nonkyc)',
    'calc.netMetaSmoothed2h': ' (~2h avg)',
    'calc.fxLabel': ' · USD/BRL: {rate}',
    'calc.disclaimer':
      'Explorer-first estimate: assumes constant network hashrate, bracket and price. Actual production varies with luck and network conditions. Pool estimates are for comparison only.',
    'calc.chartTitle': 'Predicted × realized (KRX/day)',
    'calc.predicted': 'Predicted',
    'calc.actual': 'Realized',
    'calc.chartEmpty':
      'The comparison starts on the first day with a recorded prediction. Configure the calculator and come back tomorrow — each day stores a snapshot of the prediction to compare against what landed in your wallet.',
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
