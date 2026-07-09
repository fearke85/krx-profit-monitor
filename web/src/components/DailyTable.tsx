import type { DailyRow } from '../api';
import { fmtKrx, fmtUsdt, fmtPrice } from '../format';
import { useSettings } from '../settings';

export default function DailyTable({ days }: { days: DailyRow[] }) {
  const { t } = useSettings();
  const totalKrx = days.reduce((a, r) => a + r.received_krx, 0);
  const totalUsdt = days.reduce((a, r) => a + r.est_usdt, 0);

  return (
    <div className="table-wrap">
    <table className="table">
      <thead>
        <tr>
          <th>{t('daily.colDay')}</th>
          <th className="num">{t('daily.colReceived')}</th>
          <th className="num">{t('daily.colTxs')}</th>
          <th className="num">{t('daily.colPrice')}</th>
          <th className="num">{t('daily.colEst')}</th>
        </tr>
      </thead>
      <tbody>
        {days.length === 0 && (
          <tr>
            <td colSpan={5} className="empty">
              {t('daily.empty')}
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
              <span className="price-tag">
                {r.price_source === 'current' ? t('daily.priceCurrent') : t('daily.priceDay')}
              </span>
            </td>
            <td className="num">{fmtUsdt(r.est_usdt)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>{t('daily.total')}</td>
          <td className="num">{fmtKrx(totalKrx)}</td>
          <td className="num">—</td>
          <td className="num">—</td>
          <td className="num">{fmtUsdt(totalUsdt)}</td>
        </tr>
      </tfoot>
    </table>
    </div>
  );
}
