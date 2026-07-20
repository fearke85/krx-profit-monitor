import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BRACKETS,
  DEFAULT_CONFIG,
  HASH_UNITS,
  buildResult,
  getComparison,
  getUsdBrl,
  loadCalcConfig,
  saveCalcConfig,
  snapshotPrediction,
  type CalcConfig,
  type CompareRow,
  type Currency,
} from '../lib/calculator';
import { getEffectiveNetworkHashrate, getNetworkInfo, type HashrateSource, type NetworkInfo } from '../lib/keryx';
import { currentPrice } from '../lib/dashboard';
import { fmtKrx, fmtMoney, fmtNum, fmtPrice } from '../format';
import { useSettings } from '../settings';
import CalcCompareChart from './CalcCompareChart';
const REFRESH_MS = 5 * 60_000;

function fmtHashrate(hps: number): string {
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let v = hps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${fmtNum(v, { maximumFractionDigits: 2 })} ${units[i]}`;
}

/** Input numérico que tolera campo vazio/decimal em digitação. */
function NumField({
  value,
  min,
  max,
  step,
  onValue,
  disabled,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number | 'any';
  onValue: (n: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step ?? 'any'}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onValue(n);
      }}
    />
  );
}

export default function CalculatorPanel() {
  const { t } = useSettings();
  const [cfg, setCfg] = useState<CalcConfig | null>(null);
  const [net, setNet] = useState<NetworkInfo | null>(null);
  /** Fonte do hashrate exibido: média 1h / 24h do history, ou instantâneo /info. */
  const [hashSource, setHashSource] = useState<HashrateSource>('info');
  const [priceUsd, setPriceUsd] = useState(0);
  const [usdBrl, setUsdBrl] = useState(0);
  const [compare, setCompare] = useState<CompareRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Config salva (ou defaults na primeira visita).
  useEffect(() => {
    void loadCalcConfig().then((saved) => setCfg(saved ?? DEFAULT_CONFIG));
  }, []);

  // Dados de rede/preço/câmbio — no mount e a cada 5 min.
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const [n, eff, p, fx] = await Promise.all([
          getNetworkInfo(),
          getEffectiveNetworkHashrate(),
          currentPrice(),
          getUsdBrl(),
        ]);
        if (cancelled) return;
        const hps = eff.hashrateHps > 0 ? eff.hashrateHps : n.hashrateHps;
        setNet({ ...n, hashrateHps: hps });
        setHashSource(eff.hashrateHps > 0 ? eff.source : 'info');
        setPriceUsd(p);
        setUsdBrl(fx);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void fetchData();
    const id = setInterval(() => void fetchData(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const refreshCompare = () => void getComparison(30).then(setCompare);
  useEffect(refreshCompare, []);

  const result = useMemo(
    () => (cfg && net && priceUsd > 0 ? buildResult(cfg, net, priceUsd, usdBrl) : null),
    [cfg, net, priceUsd, usdBrl],
  );

  // Persiste config + snapshot da previsão do dia (debounced).
  useEffect(() => {
    if (!cfg) return;
    const id = setTimeout(() => {
      void saveCalcConfig(cfg);
      if (result && result.krxPerDay > 0) {
        void snapshotPrediction(result.krxPerDay, result.priceUsd).then(refreshCompare);
      }
    }, 600);
    return () => clearTimeout(id);
  }, [cfg, result]);

  if (!cfg) return <div className="sync-bar">{t('app.loading')}</div>;

  const set = <K extends keyof CalcConfig>(key: K, value: CalcConfig[K]) =>
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));

  const cur: Currency = result?.currency ?? cfg.currency;

  return (
    <>
      <div className="panel calc-panel">
        <h2 className="panel-title">{t('calc.title')}</h2>
        <p className="calc-intro">{t('calc.intro')}</p>

        <div className="calc-grid">
          <label className="calc-field">
            <span>{t('calc.hashrate')}</span>
            <div className="calc-inline">
              <NumField value={cfg.hashrate} min={0} onValue={(n) => set('hashrate', Math.max(0, n))} />
              <select value={cfg.unit} onChange={(e) => set('unit', e.target.value)}>
                {HASH_UNITS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.key}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="calc-field">
            <span>{t('calc.bracket')}</span>
            <select
              value={cfg.bracket}
              onChange={(e) => set('bracket', Number(e.target.value))}
            >
              {BRACKETS.map((b) => (
                <option key={b.id} value={b.id}>
                  {t('calc.bracketOpt', {
                    id: b.id,
                    req: b.requirement,
                    pct: Math.round(b.multiplier * 100),
                  })}
                </option>
              ))}
            </select>
          </label>

          <label className="calc-field">
            <span>{t('calc.currency')}</span>
            <select
              value={cfg.currency}
              onChange={(e) => {
                const next = e.target.value as Currency;
                setCfg((prev) => {
                  if (!prev || prev.currency === next) return prev;
                  let kwhCost = prev.kwhCost;
                  if (usdBrl > 0) {
                    if (prev.currency === 'USD' && next === 'BRL') {
                      kwhCost = prev.kwhCost * usdBrl;
                    } else if (prev.currency === 'BRL' && next === 'USD') {
                      kwhCost = prev.kwhCost / usdBrl;
                    }
                    // Arredonda para evitar lixo de float no input.
                    kwhCost = Math.round(kwhCost * 1e4) / 1e4;
                  }
                  return { ...prev, currency: next, kwhCost };
                });
              }}
            >
              <option value="USD">USD</option>
              <option value="BRL">BRL</option>
            </select>
          </label>

          <label className="calc-field calc-check">
            <span>{t('calc.feeToggle')}</span>
            <div className="calc-inline">
              <input
                type="checkbox"
                checked={cfg.feeEnabled}
                onChange={(e) => set('feeEnabled', e.target.checked)}
              />
              <NumField
                value={cfg.feePct}
                min={0}
                max={100}
                step={0.1}
                disabled={!cfg.feeEnabled}
                onValue={(n) => set('feePct', Math.min(100, Math.max(0, n)))}
              />
              <span className="calc-unit">%</span>
            </div>
          </label>

          <label className="calc-field">
            <span>{t('calc.kwh', { cur: cfg.currency })}</span>
            <NumField value={cfg.kwhCost} min={0} step={0.01} onValue={(n) => set('kwhCost', Math.max(0, n))} />
          </label>

          <label className="calc-field">
            <span>{t('calc.power')}</span>
            <NumField value={cfg.powerW} min={0} onValue={(n) => set('powerW', Math.max(0, n))} />
          </label>
        </div>

        <p className="calc-hint">{t('calc.bracketHint')}</p>

        {error && <div className="error">{t('calc.error', { msg: error })}</div>}
        {!result && !error && <div className="sync-bar">{t('calc.loading')}</div>}

        {result && (
          <>
            {result.fxMissing && <div className="error">{t('calc.fxMissing')}</div>}

            <div className="cards calc-cards">
              <div className="card">
                <div className="card-title">{t('calc.prodDay')}</div>
                <div className="card-value">{fmtKrx(result.krxPerDay)} KRX</div>
                <div className="card-sub">
                  {t('calc.share', {
                    pct: fmtNum(result.sharePct, { maximumFractionDigits: 4 }),
                  })}
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('calc.revenueDay')}</div>
                <div className="card-value">{fmtMoney(result.periods[0].revenue, cur)}</div>
                <div className="card-sub">
                  {t('calc.energyDay', {
                    cost: fmtMoney(result.periods[0].energyCost, cur),
                  })}
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('calc.profitDay')}</div>
                <div
                  className="card-value"
                  style={{ color: result.periods[0].profit >= 0 ? 'var(--bright)' : '#ff6644' }}
                >
                  {fmtMoney(result.periods[0].profit, cur)}
                </div>
                <div className="card-sub">
                  {t('calc.bracketApplied', {
                    id: cfg.bracket,
                    pct: Math.round((BRACKETS[cfg.bracket]?.multiplier ?? 0.5) * 100),
                  })}
                </div>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('calc.colPeriod')}</th>
                    <th className="num">{t('calc.colKrx')}</th>
                    <th className="num">{t('calc.colRevenue', { cur })}</th>
                    <th className="num">{t('calc.colEnergy', { cur })}</th>
                    <th className="num">{t('calc.colProfit', { cur })}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.periods.map((p) => (
                    <tr key={p.key}>
                      <td>{t(p.key)}</td>
                      <td className="num">{fmtKrx(p.krx)}</td>
                      <td className="num">{fmtMoney(p.revenue, cur)}</td>
                      <td className="num">{fmtMoney(p.energyCost, cur)}</td>
                      <td
                        className="num"
                        style={{ color: p.profit >= 0 ? 'var(--bright)' : '#ff6644' }}
                      >
                        {fmtMoney(p.profit, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="calc-meta">
              {t('calc.netMeta', {
                hashrate: fmtHashrate(result.network.hashrateHps),
                smoothed: hashSource === '2h' ? t('calc.netMetaSmoothed2h') : '',
                reward: fmtKrx(result.network.blockRewardKrx),
                price: fmtPrice(result.priceUsd),
              })}
              {cfg.currency === 'BRL' && result.usdBrl > 0 &&
                t('calc.fxLabel', { rate: fmtNum(result.usdBrl, { maximumFractionDigits: 4 }) })}
            </p>            <p className="calc-hint">{t('calc.disclaimer')}</p>
          </>
        )}
      </div>

      <div className="panel calc-panel">
        <h2 className="panel-title">{t('calc.chartTitle')}</h2>
        {compare.length > 0 ? (
          <CalcCompareChart rows={compare} />
        ) : (
          <p className="calc-hint">{t('calc.chartEmpty')}</p>
        )}
      </div>
    </>
  );
}
