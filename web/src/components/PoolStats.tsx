import type { PoolData, PoolHistoryRange, PoolHistoryResolution } from '../api';
import { fmtKrx, fmtNum, fmtTime } from '../format';
import { useSettings } from '../settings';
import HashrateChart from './HashrateChart';

const RANGES: Array<{ label: string; value: PoolHistoryRange }> = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: '1y', value: 'year' },
  { label: '∞', value: 'all' },
];

const RES_KEY: Record<PoolHistoryResolution, string> = {
  raw: 'pool.resRaw',
  hourly: 'pool.resHourly',
  daily: 'pool.resDaily',
};

function fmtGhs(ghs: number): string {
  if (ghs >= 1000) return `${fmtNum(ghs / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TH/s`;
  return `${fmtNum(ghs, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GH/s`;
}

function Card({ title, value, sub, accent }: { title: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`card${accent ? ' card-accent' : ''}`}>
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

export default function PoolStats({
  pool,
  priceUsd,
  range,
  onRangeChange,
}: {
  pool: PoolData;
  priceUsd: number;
  range: PoolHistoryRange;
  onRangeChange: (r: PoolHistoryRange) => void;
}) {
  const { t } = useSettings();
  const isSolo = pool.mode === 'solo';

  function fmtAge(ms: number): string {
    if (!ms) return '—';
    const secs = Math.floor((Date.now() - ms) / 1000);
    if (secs < 60) return t('age.sec', { n: secs });
    if (secs < 3600) return t('age.min', { n: Math.floor(secs / 60) });
    return t('age.hour', { n: Math.floor(secs / 3600) });
  }

  /** Duração legível a partir de ms (para o tempo esperado por bloco). */
  function fmtDuration(ms: number): string {
    if (!ms || !Number.isFinite(ms)) return '—';
    const s = ms / 1000;
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return t('pool.etaMin', { n: Math.round(s / 60) });
    if (s < 86400) return t('pool.etaHours', { n: (s / 3600).toFixed(1) });
    if (s < 86400 * 365) return t('pool.etaDays', { n: (s / 86400).toFixed(1) });
    return t('pool.etaYears', { n: Math.round(s / 86400 / 365.25).toLocaleString('en') });
  }

  const estDailyUsdt = pool.dailyEstKrx * priceUsd;

  return (
    <>
      <div className="card-sub" style={{ margin: '0 0 0.75rem' }}>
        {isSolo ? t('pool.cacheSolo', { time: fmtTime(pool.fetchedMs) }) : t('pool.cache', { time: fmtTime(pool.fetchedMs) })}
      </div>

      {/* Cards principais */}
      <div className="cards" style={{ marginTop: 0 }}>
        <Card
          title={isSolo ? t('pool.currentHashrateEst') : t('pool.currentHashrate')}
          value={fmtGhs(pool.hashrateCurrentGhs)}
          sub={t('pool.avg', { v: fmtGhs(pool.hashrateAverageGhs) })}
        />
        {isSolo ? (
          <Card
            title={t('pool.balanceNode')}
            value={`${fmtKrx(pool.balanceKrx)} KRX`}
            sub={t('pool.balanceNodeSub', { blocks: pool.blocksFound ?? 0 })}
          />
        ) : (
          <Card
            title={t('pool.pendingBalance')}
            value={`${fmtKrx(pool.balanceKrx)} KRX`}
            sub={t('pool.balanceSub', { mature: fmtKrx(pool.matureKrx), immature: fmtKrx(pool.immatureKrx) })}
          />
        )}
        {isSolo && (pool.blockRewardKrx ?? 0) === 0 ? (
          <Card
            title={t('pool.expectedBlocks')}
            value={fmtNum(pool.expectedBlocksPerDay ?? 0, { maximumFractionDigits: 3 })}
            sub={t('pool.expectedBlocksSub', { online: pool.workersOnline, total: pool.workersTotal })}
          />
        ) : (
          <Card
            title={t('pool.dailyEst')}
            value={`${fmtKrx(pool.dailyEstKrx)} KRX`}
            sub={t('pool.dailyEstSub', {
              usdt: fmtKrx(estDailyUsdt),
              online: pool.workersOnline,
              total: pool.workersTotal,
            })}
          />
        )}
      </div>

      {/* Faixa de status: solo mostra ETA de bloco + OPoI; pool mostra threshold. */}
      {isSolo ? (
        <div className="pool-next-payment">
          {t('pool.expectedBlockTime', { eta: fmtDuration(pool.expectedTimeToBlockMs ?? 0) })}
          {' · '}
          {t('pool.opoiHealth', { passes: pool.opoiChallengePasses ?? 0, inf: pool.opoiInferenceResults ?? 0 })}
          <div className="card-sub" style={{ marginTop: '0.35rem' }}>{t('pool.noThreshold')}</div>
          <div className="card-sub" style={{ marginTop: '0.2rem' }}>
            {t('pool.network', {
              diff: fmtNum(pool.networkDifficulty ?? 0, { maximumFractionDigits: 0 }),
              hs: fmtGhs((pool.networkHashrateHs ?? 0) / 1e9),
            })}
          </div>
        </div>
      ) : (
        <div className="pool-next-payment">
          {(() => {
            const threshold = pool.paymentThresholdKrx;
            const toNextPaymentHours =
              pool.matureKrx < threshold && pool.dailyEstKrx > 0
                ? ((threshold - pool.matureKrx) / pool.dailyEstKrx) * 24
                : 0;
            const eta =
              toNextPaymentHours < 1
                ? t('pool.etaMin', { n: Math.round(toNextPaymentHours * 60) })
                : t('pool.etaHours', { n: toNextPaymentHours.toLocaleString('en', { maximumFractionDigits: 1 }) });
            return pool.matureKrx >= threshold ? (
              <span style={{ color: 'var(--bright)' }}>
                {t('pool.paymentReady', { mature: fmtKrx(pool.matureKrx), threshold: threshold.toLocaleString('en') })}
              </span>
            ) : (
              t('pool.nextPayment', {
                eta,
                missing: fmtKrx(threshold - pool.matureKrx),
                threshold: threshold.toLocaleString('en'),
              })
            );
          })()}
        </div>
      )}

      {/* Hashrate histórico */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {t('pool.historyTitle')}
          {pool.history && t('pool.historyMeta', { n: pool.history.snapshots.length, res: t(RES_KEY[pool.history.resolution]) })}
        </h3>
        <div className="ranges">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => onRangeChange(r.value)}
              className={r.value === range ? 'active' : ''}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {pool.history && pool.history.snapshots.length > 0 ? (
        <HashrateChart snapshots={pool.history.snapshots} resolution={pool.history.resolution} />
      ) : (
        <div className="pool-next-payment" style={{ marginTop: '1rem', fontStyle: 'italic' }}>
          {t('pool.accumulating')}
        </div>
      )}

      {/* Workers */}
      <div className="table-wrap" style={{ marginTop: '1rem' }}>
        <table>
          <thead>
            <tr>
              <th>{t('pool.colWorker')}</th>
              <th>{t('pool.colStatus')}</th>
              <th>{t('pool.colHashCurr')}</th>
              <th>{t('pool.colHashAvg')}</th>
              <th>{t('pool.colShares')}</th>
              <th>{t('pool.colLastShare')}</th>
            </tr>
          </thead>
          <tbody>
            {pool.workers.map((w) => (
              <tr key={w.name} style={{ opacity: w.isOffline ? 0.5 : 1 }}>
                <td style={{ color: 'var(--bright)', fontWeight: 600 }}>{w.name}</td>
                <td>
                  <span style={{ color: w.isOffline ? '#ff4444' : 'var(--bright)' }}>
                    {w.isOffline ? t('pool.offline') : t('pool.online')}
                  </span>
                </td>
                <td>{fmtGhs(w.hashrateCurrentGhs)}</td>
                <td>{fmtGhs(w.hashrateAverageGhs)}</td>
                <td>{fmtNum(w.sharesAccepted)}</td>
                <td>{fmtAge(w.lastShareMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Solo: blocos encontrados (eventos de ganho). Pool: últimos pagamentos. */}
      {isSolo ? (
        (pool.blocks?.length ?? 0) > 0 && (
          <>
            <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--muted)' }}>
              {t('pool.blocksTitle', { n: pool.blocks!.length })}
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('pool.colBlock')}</th>
                    <th>{t('pool.colBluescore')}</th>
                    <th>{t('pool.colWorker')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.blocks!.slice(0, 20).map((b) => (
                    <tr key={b.hash || b.nonce}>
                      <td>
                        <a
                          href={`https://keryx-labs.com/block/${b.hash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--bright)', fontFamily: 'monospace', fontSize: '0.75em' }}
                        >
                          {b.hash ? `${b.hash.slice(0, 16)}…` : '—'}
                        </a>
                      </td>
                      <td>{b.bluescore || '—'}</td>
                      <td>{b.worker || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        pool.lastPayments.length > 0 && (
          <>
            <h3 style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--muted)' }}>
              {t('pool.latestPayments', { n: pool.lastPayments.length })}
            </h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('pool.colDateTime')}</th>
                    <th>{t('pool.colAmount')}</th>
                    <th>{t('pool.colTx')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.lastPayments.slice(0, 10).map((p) => (
                    <tr key={p.tx}>
                      <td>{fmtTime(p.timestampMs)}</td>
                      <td>{fmtKrx(p.amountKrx)}</td>
                      <td>
                        <a
                          href={`https://keryx-labs.com/tx/${p.tx}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--bright)', fontFamily: 'monospace', fontSize: '0.75em' }}
                        >
                          {p.tx.slice(0, 16)}…
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </>
  );
}
