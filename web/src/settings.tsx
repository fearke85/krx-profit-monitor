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
    'app.poolUnavailable': 'Pool indisponível: {msg}',
    'app.changeWallet': 'trocar wallet',
    'app.footerNote': 'USDT é estimativa (preço nonkyc); KRX recebido é exato.',
    'app.themeToggle': 'Alternar tema claro/escuro',

    'pools.title': 'Pools',
    'wallet.section': 'Recebido na carteira',
    'wallet.perDay': 'Recebido por dia',

    'range.7d': '7 dias',
    'range.30d': '30 dias',
    'range.90d': '90 dias',
    'range.all': 'Tudo',

    'summary.todayReceived': 'Recebido hoje (KRX)',
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
    'daily.colReceived': 'Recebido (KRX)',
    'daily.colTxs': 'Txs',
    'daily.colPrice': 'Preço usado',
    'daily.colEst': 'Estimativa (USDT)',
    'daily.empty': 'Sem dados no período.',
    'daily.total': 'Total do período',

    'wallet.configure': 'Configurar wallet',
    'wallet.hintBefore': 'Cole o endereço KERYX que você quer monitorar (formato ',
    'wallet.hintAfter': '). Ele fica salvo localmente, no banco da aplicação — nunca vai para o repositório.',
    'wallet.placeholder': 'keryx:… (cole seu endereço completo)',
    'wallet.validating': 'Validando…',
    'wallet.save': 'Salvar e sincronizar',
    'wallet.cancel': 'Cancelar',
    'wallet.changeHint': 'Trocar de wallet recarrega o histórico do novo endereço (re-sincronização).',

    'pool.title': 'Pool · {name}',
    'pool.online': '● online',
    'pool.offline': '● offline',
    'pool.cache': 'cache 30s · {time}',
    'pool.currentHashrate': 'Hashrate atual',
    'pool.avg': 'média: {v}',
    'pool.pendingBalance': 'Saldo pendente na pool',
    'pool.balanceSub': 'mature: {mature} · imature: {immature}',
    'pool.dailyEst': 'Estimativa diária',
    'pool.dailyEstSub': '≈ {usdt} USDT · {online}/{total} workers',
    'pool.paymentReady': '✓ Pagamento disponível — saldo mature ({mature} KRX) atingiu o threshold ({threshold} KRX)',
    'pool.nextPayment': 'Próximo pagamento em ~ {eta} · faltam {missing} KRX mature para o threshold ({threshold} KRX)',
    'pool.etaMin': '{n} min',
    'pool.etaHours': '{n} h',
    'pool.historyTitle': 'Hashrate histórico',
    'pool.historyMeta': ' · {n} pontos · {res}',
    'pool.resRaw': 'amostras de 15s',
    'pool.resHourly': 'agregado por hora',
    'pool.resDaily': 'agregado por dia',
    'pool.accumulating': 'Histórico acumulando… snapshots gravados a cada 15s.',
    'pool.colWorker': 'Worker',
    'pool.colStatus': 'Status',
    'pool.colHashCurr': 'Hashrate atual',
    'pool.colHashAvg': 'Hashrate médio',
    'pool.colShares': 'Shares',
    'pool.colLastShare': 'Último share',
    'pool.latestPayments': 'Últimos pagamentos ({n})',
    'pool.colDateTime': 'Data/hora',
    'pool.colAmount': 'Valor (KRX)',
    'pool.colTx': 'Tx',

    // ---- pool SOLO local (bridge) ----
    'app.bridgeUnavailable': 'Pool solo (bridge) indisponível: {msg}',
    'pool.soloName': 'solo local (bridge)',
    'pool.titleSolo': 'Pool solo · {name}',
    'pool.cacheSolo': 'bridge /metrics · cache 10s · {time}',
    'pool.currentHashrateEst': 'Hashrate atual (estimado)',
    'pool.balanceNode': 'Saldo na carteira (nó)',
    'pool.balanceNodeSub': 'blocos encontrados: {blocks} · maturity é on-chain',
    'pool.expectedBlocks': 'Blocos/dia esperados',
    'pool.expectedBlocksSub': '{online}/{total} workers · recompensa em KRX não configurada',
    'pool.expectedBlockTime': 'Tempo esperado por bloco: ~ {eta}',
    'pool.opoiHealth': 'OPoI: {passes} desafios OK · {inf} inferências',
    'pool.noThreshold': 'Solo: sem threshold — cada bloco achado paga a recompensa cheia direto na sua carteira. A verdade dos ganhos é on-chain (seção “Recebido na carteira”).',
    'pool.network': 'Rede: dificuldade {diff} · {hs}',
    'pool.etaDays': '{n} d',
    'pool.etaYears': '{n} anos',
    'pool.blocksTitle': 'Blocos encontrados ({n})',
    'pool.colBlock': 'Bloco (hash)',
    'pool.colBluescore': 'Bluescore',

    'chart.accumulating': 'Histórico acumulando…',
    'chart.current': 'Atual',
    'chart.average': 'Média',

    'age.sec': '{n}s atrás',
    'age.min': '{n}min atrás',
    'age.hour': '{n}h atrás',

    // ---- estratégia de realização de lucro ----
    'strategy.title': 'Realização de lucro',
    'strategy.batch': 'Lote {acc} / {target} KRX',
    'strategy.batchSub': 'Saldo na carteira: {balance} KRX',
    'strategy.eta': 'ETA: ~ {hours}h ({days}d) ao ritmo atual',
    'strategy.etaNone': 'ETA: — (já atingiu o alvo)',
    'strategy.etaNoRate': 'ETA: — (sem estimativa da pool)',
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
    'app.poolUnavailable': 'Pool unavailable: {msg}',
    'app.changeWallet': 'change wallet',
    'app.footerNote': 'USDT is an estimate (nonkyc price); KRX received is exact.',
    'app.themeToggle': 'Toggle light/dark theme',

    'pools.title': 'Pools',
    'wallet.section': 'Wallet earnings',
    'wallet.perDay': 'Received per day',

    'range.7d': '7 days',
    'range.30d': '30 days',
    'range.90d': '90 days',
    'range.all': 'All',

    'summary.todayReceived': 'Received today (KRX)',
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
    'daily.colReceived': 'Received (KRX)',
    'daily.colTxs': 'Txs',
    'daily.colPrice': 'Price used',
    'daily.colEst': 'Estimate (USDT)',
    'daily.empty': 'No data in this range.',
    'daily.total': 'Range total',

    'wallet.configure': 'Configure wallet',
    'wallet.hintBefore': 'Paste the KERYX address you want to monitor (format ',
    'wallet.hintAfter': '). It is stored locally in the app database — it never goes to the repository.',
    'wallet.placeholder': 'keryx:… (paste your full address)',
    'wallet.validating': 'Validating…',
    'wallet.save': 'Save and sync',
    'wallet.cancel': 'Cancel',
    'wallet.changeHint': 'Changing the wallet reloads the new address history (re-sync).',

    'pool.title': 'Pool · {name}',
    'pool.online': '● online',
    'pool.offline': '● offline',
    'pool.cache': 'cache 30s · {time}',
    'pool.currentHashrate': 'Current hashrate',
    'pool.avg': 'avg: {v}',
    'pool.pendingBalance': 'Pending pool balance',
    'pool.balanceSub': 'mature: {mature} · immature: {immature}',
    'pool.dailyEst': 'Daily estimate',
    'pool.dailyEstSub': '≈ {usdt} USDT · {online}/{total} workers',
    'pool.paymentReady': '✓ Payment available — mature balance ({mature} KRX) reached the threshold ({threshold} KRX)',
    'pool.nextPayment': 'Next payment in ~ {eta} · {missing} KRX mature left to reach the threshold ({threshold} KRX)',
    'pool.etaMin': '{n} min',
    'pool.etaHours': '{n} h',
    'pool.historyTitle': 'Hashrate history',
    'pool.historyMeta': ' · {n} points · {res}',
    'pool.resRaw': '15s samples',
    'pool.resHourly': 'hourly aggregate',
    'pool.resDaily': 'daily aggregate',
    'pool.accumulating': 'Accumulating history… snapshots saved every 15s.',
    'pool.colWorker': 'Worker',
    'pool.colStatus': 'Status',
    'pool.colHashCurr': 'Current hashrate',
    'pool.colHashAvg': 'Avg hashrate',
    'pool.colShares': 'Shares',
    'pool.colLastShare': 'Last share',
    'pool.latestPayments': 'Latest payments ({n})',
    'pool.colDateTime': 'Date/time',
    'pool.colAmount': 'Amount (KRX)',
    'pool.colTx': 'Tx',

    // ---- local SOLO pool (bridge) ----
    'app.bridgeUnavailable': 'Solo pool (bridge) unavailable: {msg}',
    'pool.soloName': 'local solo (bridge)',
    'pool.titleSolo': 'Solo pool · {name}',
    'pool.cacheSolo': 'bridge /metrics · 10s cache · {time}',
    'pool.currentHashrateEst': 'Current hashrate (estimated)',
    'pool.balanceNode': 'Wallet balance (node)',
    'pool.balanceNodeSub': 'blocks found: {blocks} · maturity is on-chain',
    'pool.expectedBlocks': 'Expected blocks/day',
    'pool.expectedBlocksSub': '{online}/{total} workers · KRX reward not configured',
    'pool.expectedBlockTime': 'Expected time per block: ~ {eta}',
    'pool.opoiHealth': 'OPoI: {passes} challenges OK · {inf} inferences',
    'pool.noThreshold': 'Solo: no threshold — each block found pays the full reward straight to your wallet. The earnings truth is on-chain (“Wallet earnings” section).',
    'pool.network': 'Network: difficulty {diff} · {hs}',
    'pool.etaDays': '{n} d',
    'pool.etaYears': '{n} years',
    'pool.blocksTitle': 'Blocks found ({n})',
    'pool.colBlock': 'Block (hash)',
    'pool.colBluescore': 'Bluescore',

    'chart.accumulating': 'Accumulating history…',
    'chart.current': 'Current',
    'chart.average': 'Average',

    'age.sec': '{n}s ago',
    'age.min': '{n}min ago',
    'age.hour': '{n}h ago',

    // ---- profit-taking strategy ----
    'strategy.title': 'Profit taking',
    'strategy.batch': 'Batch {acc} / {target} KRX',
    'strategy.batchSub': 'Wallet balance: {balance} KRX',
    'strategy.eta': 'ETA: ~ {hours}h ({days}d) at current rate',
    'strategy.etaNone': 'ETA: — (target already reached)',
    'strategy.etaNoRate': 'ETA: — (no pool estimate)',
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
