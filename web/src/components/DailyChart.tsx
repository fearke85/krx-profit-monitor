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

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row: DailyRow = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="tooltip-day">{row.day}</div>
      <div>{fmtKrx(row.received_krx)} KRX</div>
      <div>≈ {fmtUsdt(row.est_usdt)} USDT</div>
      <div className="tooltip-sub">
        {row.tx_count} txs · preço {row.price_source === 'current' ? 'atual' : 'do dia'}
      </div>
    </div>
  );
}

export default function DailyChart({ days }: { days: DailyRow[] }) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={days} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2d22" />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#8aa896' }} tickFormatter={(d) => d.slice(5)} />
          <YAxis tick={{ fontSize: 11, fill: '#8aa896' }} width={56} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(57,255,20,0.08)' }} />
          <Bar dataKey="received_krx" fill="#39ff14" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
