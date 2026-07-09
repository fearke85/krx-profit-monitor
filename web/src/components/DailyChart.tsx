import { useEffect, useState } from 'react';
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

function useNarrow(query = '(max-width: 720px)'): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

export default function DailyChart({ days }: { days: DailyRow[] }) {
  const { t, theme } = useSettings();
  const narrow = useNarrow();
  const C =
    theme === 'light'
      ? { grid: '#e0e7e2', tick: '#5a6b60', bar: '#137a27', cursor: 'rgba(19,122,39,0.08)' }
      : { grid: '#1f2d22', tick: '#8aa896', bar: '#39ff14', cursor: 'rgba(57,255,20,0.08)' };

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={narrow ? 220 : 280}>
        <BarChart data={days} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
          <XAxis
            dataKey="day"
            tick={{ fontSize: narrow ? 10 : 11, fill: C.tick }}
            tickFormatter={(d) => d.slice(5)}
            interval="preserveStartEnd"
            minTickGap={narrow ? 28 : 8}
          />
          <YAxis tick={{ fontSize: narrow ? 10 : 11, fill: C.tick }} width={narrow ? 44 : 56} />
          <Tooltip content={<ChartTooltip t={t} />} cursor={{ fill: C.cursor }} />
          <Bar dataKey="received_krx" fill={C.bar} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
