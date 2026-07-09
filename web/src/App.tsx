import { useCallback, useEffect, useState } from 'react';
import {
  getDaily,
  getSummary,
  type DailyResponse,
  type Summary,
} from './api';
import { useSettings } from './settings';
import SummaryCards from './components/SummaryCards';
import DailyChart from './components/DailyChart';
import DailyTable from './components/DailyTable';
import WalletForm from './components/WalletForm';
import AccordionItem from './components/Accordion';
import StrategyPanel from './components/StrategyPanel';
import { startSync, subscribeSync, syncStatus, triggerSync } from './lib/sync';

const RANGES: Array<{ key: string; days: number }> = [
  { key: 'range.7d', days: 7 },
  { key: 'range.30d', days: 30 },
  { key: 'range.90d', days: 90 },
  { key: 'range.all', days: 3650 },
];

const AUTO_REFRESH_MS = 5 * 60_000;

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const { t, lang, setLang, theme, toggleTheme } = useSettings();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [rangeDays, setRangeDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [syncTick, setSyncTick] = useState(0);

  useEffect(() => {
    startSync();
    return subscribeSync(() => setSyncTick((n) => n + 1));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = isoDaysAgo(rangeDays - 1);
      const [s, d] = await Promise.all([getSummary(), getDaily(from)]);
      setSummary(s);
      setDaily(d);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Atualiza o dashboard quando um ciclo de sync termina (ou a cada ~100 txs no backfill).
  useEffect(() => {
    if (syncTick === 0) return;
    if (!syncStatus.running || syncStatus.ingestedTxs % 100 === 0) {
      void load();
    }
  }, [syncTick, load]);

  const needsAddress = !!summary && (summary.needs_address || !summary.address);

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
            <button
              className="refresh-btn"
              onClick={() => {
                triggerSync();
                void load();
              }}
              disabled={loading}
            >
              <span className={loading || syncStatus.running ? 'spin' : ''}>↻</span>
              {loading || syncStatus.running ? t('app.refreshing') : t('app.refresh')}
            </button>
          </div>
        </div>
        <p className="subtitle">{t('app.subtitle')}</p>
      </header>

      {error && <div className="error">{t('app.error', { msg: error })}</div>}

      {!summary && !error && <div className="sync-bar">{t('app.loading')}</div>}

      {syncStatus.address && (!syncStatus.backfillDone || syncStatus.phase !== 'idle') && (
        <div className="sync-bar">
          {t('summary.backfill', {
            phase: syncStatus.phase,
            ingested: syncStatus.ingestedTxs,
            total: syncStatus.totalTxCount ? `/${syncStatus.totalTxCount}` : '',
          })}
        </div>
      )}

      {summary && (needsAddress || showWalletForm) ? (
        <WalletForm
          current={summary.address}
          onSaved={() => {
            setShowWalletForm(false);
            triggerSync();
            void load();
          }}
          onCancel={summary.address ? () => setShowWalletForm(false) : undefined}
        />
      ) : summary ? (
        <>
          <SummaryCards summary={summary} />

          <StrategyPanel />

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
