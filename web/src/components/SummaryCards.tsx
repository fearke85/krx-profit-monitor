import type { Summary } from '../api';
import { fmtKrx, fmtUsdt, fmtPrice, fmtTime, fmtNum } from '../format';
import { useSettings } from '../settings';

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

export default function SummaryCards({ summary }: { summary: Summary }) {
  const { t } = useSettings();
  const { today, sync, balance_krx, balance_usdt, price_usd } = summary;
  if (!today || !sync || balance_krx == null || balance_usdt == null) return null;
  const syncing = !sync.backfill_done || sync.pending_timestamps > 0;

  return (
    <>
      <div className="cards">
        <Card
          title={t('summary.todayReceived')}
          value={`${fmtKrx(today.received_krx)} KRX`}
          sub={t('summary.todaySub', {
            usdt: fmtUsdt(today.est_usdt),
            txs: today.tx_count,
            day: today.day,
          })}
        />
        <Card
          title={t('summary.totalBalance')}
          value={`${fmtKrx(balance_krx)} KRX`}
          sub={t('summary.totalBalanceSub', { usdt: fmtUsdt(balance_usdt) })}
        />
        <Card
          title={t('summary.price')}
          value={`${fmtPrice(price_usd)} USDT`}
          sub={t('summary.priceSub')}
        />
      </div>

      <div className={`sync-bar ${syncing ? 'sync-active' : ''}`}>
        {sync.backfill_done ? (
          <>
            {t('summary.synced', { txs: fmtNum(sync.ingested_txs) })}
            {sync.pending_timestamps > 0 ? t('summary.resolving', { n: sync.pending_timestamps }) : ''}
            {t('summary.lastSync', { time: fmtTime(sync.last_sync_ms) })}
          </>
        ) : (
          t('summary.backfill', {
            phase: sync.phase,
            ingested: fmtNum(sync.ingested_txs),
            total: sync.total_txs ? `/${fmtNum(sync.total_txs)}` : '',
          })
        )}
      </div>
    </>
  );
}
