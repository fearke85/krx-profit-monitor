import type { Summary } from '../api';
import { fmtKrx, fmtUsdt, fmtPrice, fmtTime } from '../format';

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
  const { today, sync, balance_krx, balance_usdt, price_usd } = summary;
  if (!today || !sync || balance_krx == null || balance_usdt == null) return null;
  const syncing = !sync.backfill_done || sync.pending_timestamps > 0;

  return (
    <>
      <div className="cards">
        <Card
          title="Recebido hoje (KRX)"
          value={`${fmtKrx(today.received_krx)} KRX`}
          sub={`≈ ${fmtUsdt(today.est_usdt)} USDT · ${today.tx_count} txs · ${today.day}`}
        />
        <Card
          title="Saldo total"
          value={`${fmtKrx(balance_krx)} KRX`}
          sub={`≈ ${fmtUsdt(balance_usdt)} USDT`}
        />
        <Card
          title="Preço KRX (nonkyc)"
          value={`${fmtPrice(price_usd)} USDT`}
          sub="lastPrice KRX/USDT"
        />
      </div>

      <div className={`sync-bar ${syncing ? 'sync-active' : ''}`}>
        {sync.backfill_done ? (
          <>
            Sincronizado · {sync.ingested_txs.toLocaleString('pt-BR')} txs
            {sync.pending_timestamps > 0
              ? ` · resolvendo horários (${sync.pending_timestamps} pendentes)`
              : ''}
            {' · '}última sync: {fmtTime(sync.last_sync_ms)}
          </>
        ) : (
          <>
            Backfill em andamento ({sync.phase})… {sync.ingested_txs.toLocaleString('pt-BR')}
            {sync.total_txs ? `/${sync.total_txs.toLocaleString('pt-BR')}` : ''} txs
          </>
        )}
      </div>
    </>
  );
}
