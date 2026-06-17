import { useEffect, useState } from 'react';
import { getStrategy, type StrategyData } from '../api';
import { fmtKrx, fmtPrice } from '../format';
import { useSettings } from '../settings';

export default function StrategyPanel() {
  const { t } = useSettings();
  const [data, setData] = useState<StrategyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function fetchStrategy() {
      getStrategy()
        .then((d) => {
          if (!cancelled) { setData(d); setError(null); }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    }
    fetchStrategy();
    const id = setInterval(fetchStrategy, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (error) return null;
  if (!data) return null;

  const pct = data.batch_target_krx > 0
    ? Math.min(100, (data.accumulated_krx / data.batch_target_krx) * 100)
    : 0;

  const etaHours = data.eta_hours;
  const etaDays = etaHours > 0 ? (etaHours / 24).toFixed(1) : '0';
  const etaDisplay = etaHours > 0
    ? t('strategy.eta', { hours: etaHours.toFixed(0), days: etaDays })
    : data.wallet_balance_krx >= data.batch_target_krx
      ? t('strategy.etaNone')
      : t('strategy.etaNoRate');

  let alertMsg = '';
  if (data.batch_ready && data.price_favorable) alertMsg = t('strategy.alertBoth');
  else if (data.batch_ready) alertMsg = t('strategy.alertReady');
  else if (data.price_favorable) alertMsg = t('strategy.alertPrice');

  return (
    <div className={`panel strategy-panel${alertMsg ? ' strategy-alert' : ''}`}>
      <h2 className="panel-head" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {t('strategy.title')}
      </h2>

      {alertMsg && (
        <div className="strategy-alert-bar">{alertMsg}</div>
      )}

      <div className="strategy-body">
        {/* Barra de progresso do lote */}
        <div className="strategy-section">
          <div className="strategy-label">
            {t('strategy.batch', { acc: fmtKrx(data.accumulated_krx), target: data.batch_target_krx.toLocaleString() })}
          </div>
          <div className="strategy-bar-track">
            <div className="strategy-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="strategy-sub">
            {t('strategy.batchSub', { balance: fmtKrx(data.wallet_balance_krx) })} · {etaDisplay}
          </div>
        </div>

        {/* Janela de preço */}
        <div className="strategy-section">
          <div className="strategy-label">{t('strategy.priceWindow')}</div>
          {data.price_range_24h ? (
            <>
              <div className="strategy-range-row">
                <span className="strategy-range-label">Low</span>
                <span className="strategy-range-val">{fmtPrice(data.price_range_24h.min)}</span>
                <div className="strategy-range-track">
                  <div
                    className="strategy-range-dot"
                    style={{
                      left: `${Math.min(100, Math.max(0, ((data.current_price_usd - data.price_range_24h.min) / (data.price_range_24h.max - data.price_range_24h.min + 0.0001)) * 100))}%`,
                    }}
                  />
                </div>
                <span className="strategy-range-val">{fmtPrice(data.price_range_24h.max)}</span>
                <span className="strategy-range-label">High</span>
              </div>
              <div className="strategy-sub">
                {data.price_signal === 'high' && (
                  <span style={{ color: 'var(--bright)' }}>{t('strategy.signalHigh')}</span>
                )}
                {data.price_signal === 'neutral' && (
                  <span style={{ color: 'var(--muted)' }}>{t('strategy.signalNeutral')}</span>
                )}
                {data.price_signal === 'low' && (
                  <span style={{ color: '#ff8844' }}>{t('strategy.signalLow')}</span>
                )}
              </div>
            </>
          ) : (
            <div className="strategy-sub">{t('strategy.accumulating')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
