import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyRow } from '../api';
import { fmtKrx, fmtUsdt } from '../format';
import { useSettings } from '../settings';

function ChartTooltip({ active, payload, t }: any) {
  if (!active || !payload?.length) return null;
  const row: DailyRow = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="tooltip-day">{row.day}</div>
      <div>{fmtKrx(row.received_krx)} KRX</div>
      <div>≈ {fmtUsdt(row.est_usdt)} USDT</div>
      <div className="tooltip-sub">
        {t('daily.tooltipSub', {
          txs: row.tx_count,
          src: row.price_source === 'current' ? t('daily.priceCurrent') : t('daily.priceDay'),
        })}
      </div>
    </div>
  );
}

export default function DailyChart({ days }: { days: DailyRow[] }) {
  const { t, theme } = useSettings();
  const C =
    theme === 'light'
      ? { grid: '#e0e7e2', tick: '#5a6b60', bar: '#137a27', cursor: 'rgba(19,122,39,0.08)' }
      : { grid: '#1f2d22', tick: '#8aa896', bar: '#39ff14', cursor: 'rgba(57,255,20,0.08)' };

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={days} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.tick }} tickFormatter={(d) => d.slice(5)} />
          <YAxis tick={{ fontSize: 11, fill: C.tick }} width={56} />
          <Tooltip content={<ChartTooltip t={t} />} cursor={{ fill: C.cursor }} />
          <Bar dataKey="received_krx" fill={C.bar} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
