import { useCallback, useEffect, useState } from 'react';
import {
  getDaily,
  getPool,
  getSummary,
  type DailyResponse,
  type PoolData,
  type PoolHistoryRange,
  type Summary,
} from './api';
import { useSettings } from './settings';
import SummaryCards from './components/SummaryCards';
import DailyChart from './components/DailyChart';
import DailyTable from './components/DailyTable';
import WalletForm from './components/WalletForm';
import PoolStats from './components/PoolStats';
import AccordionItem from './components/Accordion';
import StrategyPanel from './components/StrategyPanel';

const RANGES: Array<{ key: string; days: number }> = [
  { key: 'range.7d', days: 7 },
  { key: 'range.30d', days: 30 },
  { key: 'range.90d', days: 90 },
  { key: 'range.all', days: 3650 },
];

const AUTO_REFRESH_MS = 5 * 60_000; // auto-refresh a cada 5 minutos

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const { t, lang, setLang, theme, toggleTheme } = useSettings();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [pool, setPool] = useState<PoolData | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolRange, setPoolRange] = useState<PoolHistoryRange>('24h');
  const [bridgeRange] = useState<PoolHistoryRange>('24h');
  const [rangeDays, setRangeDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [showWalletForm, setShowWalletForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = isoDaysAgo(rangeDays - 1);
      const [s, d] = await Promise.all([getSummary(), getDaily(from)]);
      setSummary(s);
      setDaily(d);
      setError(null);
      setLastUpdated(Date.now());
      // Pools carregam em paralelo sem bloquear o dashboard principal
      if (!s.needs_address && s.address) {
        getPool(poolRange)
          .then(setPool)
          .catch((e: Error) => setPoolError(e.message));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [rangeDays, poolRange, bridgeRange]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const needsAddress = !!summary && (summary.needs_address || !summary.address);

  const pools: Array<{
    id: string;
    name: string;
    data: PoolData;
    range: PoolHistoryRange;
    onRangeChange: (r: PoolHistoryRange) => void;
  }> = [];
  if (pool)
    pools.push({ id: 'baikal', name: 'baikalmine.com', data: pool, range: poolRange, onRangeChange: setPoolRange });

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <h1>
            <span className="logo">◈</span> KRX Profit Monitor
          </h1>
          <div className="refresh">
            {lastUpdated && (
              <span className="updated">
                {t('app.updated')}{' '}
                {new Date(lastUpdated).toLocaleTimeString(lang === 'pt' ? 'pt-BR' : 'en-US', {
                  timeZone: 'America/Sao_Paulo',
                })}
              </span>
            )}
            <div className="controls">
              <button
                className="icon-btn"
                onClick={toggleTheme}
                title={t('app.themeToggle')}
                aria-label={t('app.themeToggle')}
              >
                {theme === 'dark' ? '☀' : '☾'}
              </button>
              <button
                className={`lang-btn${lang === 'pt' ? ' active' : ''}`}
                onClick={() => setLang('pt')}
              >
                PT
              </button>
              <button
                className={`lang-btn${lang === 'en' ? ' active' : ''}`}
                onClick={() => setLang('en')}
              >
                EN
              </button>
            </div>
            <button className="refresh-btn" onClick={() => void load()} disabled={loading}>
              <span className={loading ? 'spin' : ''}>↻</span>
              {loading ? t('app.refreshing') : t('app.refresh')}
            </button>
          </div>
        </div>
        <p className="subtitle">{t('app.subtitle')}</p>
      </header>

      {error && <div className="error">{t('app.error', { msg: error })}</div>}

      {!summary && !error && <div className="sync-bar">{t('app.loading')}</div>}

      {summary && (needsAddress || showWalletForm) ? (
        <WalletForm
          current={summary.address}
          onSaved={() => {
            setShowWalletForm(false);
            void load();
          }}
          onCancel={summary.address ? () => setShowWalletForm(false) : undefined}
        />
      ) : summary ? (
        <>
          <SummaryCards summary={summary} />

          <StrategyPanel />

          {poolError && (
            <div className="error" style={{ fontSize: '0.85rem' }}>
              {t('app.poolUnavailable', { msg: poolError })}
            </div>
          )}

          {/* Pools (accordion — solo local + externa) */}
          {pools.map((p, i) => (
            <AccordionItem
              key={p.id}
              defaultOpen={p.data.isOnline}
              title={
                p.data.mode === 'solo'
                  ? t('pool.titleSolo', { name: p.name })
                  : t('pool.title', { name: p.name })
              }
              right={
                <span style={{ color: p.data.isOnline ? 'var(--bright)' : '#ff4444' }}>
                  {p.data.isOnline ? t('pool.online') : t('pool.offline')}
                </span>
              }
            >
              <PoolStats
                pool={p.data}
                priceUsd={summary.price_usd ?? 0}
                range={p.range}
                onRangeChange={p.onRangeChange}
              />
            </AccordionItem>
          ))}

          {/* Recebido na carteira (accordion) */}
          <AccordionItem title={t('wallet.section')} defaultOpen>
            <div className="panel-head" style={{ marginTop: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: 15, color: 'var(--muted)' }}>{t('wallet.perDay')}</h3>
              <div className="ranges">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    className={rangeDays === r.days ? 'active' : ''}
                    onClick={() => setRangeDays(r.days)}
                  >
                    {t(r.key)}
                  </button>
                ))}
              </div>
            </div>
            {daily && <DailyChart days={daily.days} />}
            {daily && <DailyTable days={daily.days} />}
          </AccordionItem>
        </>
      ) : null}

      <footer className="footer">
        {summary?.address && (
          <>
            <span className="addr" title={summary.address}>
              {summary.address}
            </span>
            <button className="link-btn" onClick={() => setShowWalletForm(true)}>
              {t('app.changeWallet')}
            </button>
          </>
        )}
        <span> · {t('app.footerNote')}</span>
      </footer>
    </div>
  );
}
