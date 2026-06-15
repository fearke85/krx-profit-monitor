import type { DailyRow } from '../api';
import { fmtKrx, fmtUsdt, fmtPrice } from '../format';

export default function DailyTable({ days }: { days: DailyRow[] }) {
  const totalKrx = days.reduce((a, r) => a + r.received_krx, 0);
  const totalUsdt = days.reduce((a, r) => a + r.est_usdt, 0);

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Dia (BRT)</th>
          <th className="num">Recebido (KRX)</th>
          <th className="num">Txs</th>
          <th className="num">Preço usado</th>
          <th className="num">Estimativa (USDT)</th>
        </tr>
      </thead>
      <tbody>
        {days.length === 0 && (
          <tr>
            <td colSpan={5} className="empty">
              Sem dados no período.
            </td>
          </tr>
        )}
        {[...days].reverse().map((r) => (
          <tr key={r.day}>
            <td>{r.day}</td>
            <td className="num">{fmtKrx(r.received_krx)}</td>
            <td className="num">{r.tx_count}</td>
            <td className="num">
              {fmtPrice(r.price_usd_used)}
              <span className="price-tag">{r.price_source === 'current' ? 'atual' : 'do dia'}</span>
            </td>
            <td className="num">{fmtUsdt(r.est_usdt)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total do período</td>
          <td className="num">{fmtKrx(totalKrx)}</td>
          <td className="num">—</td>
          <td className="num">—</td>
          <td className="num">{fmtUsdt(totalUsdt)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
