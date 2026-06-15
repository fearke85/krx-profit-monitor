import { useCallback, useEffect, useState } from 'react';
import {
  getDaily,
  getSummary,
  type DailyResponse,
  type Summary,
} from './api';
import SummaryCards from './components/SummaryCards';
import DailyChart from './components/DailyChart';
import DailyTable from './components/DailyTable';
import WalletForm from './components/WalletForm';

const RANGES = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
  { label: 'Tudo', days: 3650 },
];

const AUTO_REFRESH_MS = 5 * 60_000; // auto-refresh a cada 5 minutos

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
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
                Atualizado{' '}
                {new Date(lastUpdated).toLocaleTimeString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                })}
              </span>
            )}
            <button className="refresh-btn" onClick={() => void load()} disabled={loading}>
              <span className={loading ? 'spin' : ''}>↻</span>
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
          </div>
        </div>
        <p className="subtitle">
          Rentabilidade da mineração KERYX · dia fechado em horário de Brasília · auto a cada 5 min
        </p>
      </header>

      {error && <div className="error">Erro: {error}</div>}

      {!summary && !error && <div className="sync-bar">Carregando…</div>}

      {summary && (needsAddress || showWalletForm) ? (
        <WalletForm
          current={summary.address}
          onSaved={() => {
            setShowWalletForm(false);
            void load();
          }}
          onCancel={
            summary.address ? () => setShowWalletForm(false) : undefined
          }
        />
      ) : summary ? (
        <>
          <SummaryCards summary={summary} />

          <section className="panel">
            <div className="panel-head">
              <h2>Recebido por dia</h2>
              <div className="ranges">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    className={rangeDays === r.days ? 'active' : ''}
                    onClick={() => setRangeDays(r.days)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {daily && <DailyChart days={daily.days} />}
            {daily && <DailyTable days={daily.days} />}
          </section>
        </>
      ) : null}

      <footer className="footer">
        {summary?.address && (
          <>
            <span className="addr" title={summary.address}>
              {summary.address}
            </span>
            <button className="link-btn" onClick={() => setShowWalletForm(true)}>
              trocar wallet
            </button>
          </>
        )}
        <span> · USDT é estimativa (preço nonkyc); KRX recebido é exato.</span>
      </footer>
    </div>
  );
}
