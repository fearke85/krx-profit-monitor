import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompareRow } from '../lib/calculator';
import { fmtKrx } from '../format';
import { useSettings } from '../settings';

function ChartTooltip({ active, payload, t }: any) {
  if (!active || !payload?.length) return null;
  const row: CompareRow = payload[0].payload;
  const predicted = row.predicted_krx;
  const delta =
    predicted && predicted > 0 ? ((row.actual_krx - predicted) / predicted) * 100 : null;
  return (
    <div className="tooltip">
      <div className="tooltip-day">{row.day}</div>
      <div>
        {t('calc.predicted')}: {predicted != null ? `${fmtKrx(predicted)} KRX` : '—'}
      </div>
      <div>
        {t('calc.actual')}: {fmtKrx(row.actual_krx)} KRX
      </div>
      {delta != null && (
        <div className="tooltip-sub">
          Δ {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}%
        </div>
      )}
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

export default function CalcCompareChart({ rows }: { rows: CompareRow[] }) {
  const { t, theme } = useSettings();
  const narrow = useNarrow();
  const C =
    theme === 'light'
      ? {
          grid: '#e0e7e2',
          tick: '#5a6b60',
          actual: '#137a27',
          predicted: '#6aa37e',
          cursor: 'rgba(19,122,39,0.08)',
        }
      : {
          grid: '#1f2d22',
          tick: '#8aa896',
          actual: '#39ff14',
          predicted: '#5a8a6a',
          cursor: 'rgba(57,255,20,0.08)',
        };

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={narrow ? 220 : 280}>
        <BarChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
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
          <Legend
            wrapperStyle={{ fontSize: narrow ? 11 : 12 }}
            formatter={(value) =>
              value === 'predicted_krx' ? t('calc.predicted') : t('calc.actual')
            }
          />
          <Bar dataKey="predicted_krx" fill={C.predicted} radius={[3, 3, 0, 0]} />
          <Bar dataKey="actual_krx" fill={C.actual} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
