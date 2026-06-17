import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { PoolSnapshot, PoolHistoryResolution } from '../api';
import { useSettings } from '../settings';

function fmtGhs(ghs: number): string {
  if (ghs >= 1000) return `${(ghs / 1000).toFixed(2)} TH/s`;
  return `${ghs.toFixed(2)} GH/s`;
}

// Cobertura abaixo deste limiar = gap de downtime: quebramos a linha (null) em vez de interpolar.
const COVERAGE_MIN = 0.5;

interface Props {
  snapshots: PoolSnapshot[];
  resolution: PoolHistoryResolution;
}

export default function HashrateChart({ snapshots, resolution }: Props) {
  const { t, lang, theme } = useSettings();
  const locale = lang === 'pt' ? 'pt-BR' : 'en-US';
  const C =
    theme === 'light'
      ? { grid: '#e0e7e2', tick: '#5a6b60', line: '#137a27', line2: '#6aa37e', panel: '#ffffff', accent: '#137a27' }
      : { grid: '#1f2d22', tick: '#8aa896', line: '#39ff14', line2: '#5a8a6a', panel: '#0a0f0c', accent: '#39ff14' };

  const fmtAxis = (ms: number): string =>
    resolution === 'daily'
      ? new Date(ms).toLocaleDateString(locale, { timeZone: 'UTC', day: '2-digit', month: '2-digit' })
      : new Date(ms).toLocaleTimeString(locale, {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
        });

  if (snapshots.length < 2) {
    return <div className="chart-empty">{t('chart.accumulating')}</div>;
  }

  const data = snapshots.map((s) => {
    const gap = s.coverage < COVERAGE_MIN;
    return {
      t: s.t,
      // Em buckets com gap, valor null faz a linha "abrir" (sem interpolar por cima do downtime).
      curr: gap ? null : parseFloat(s.hashrate_curr_ghs.toFixed(3)),
      avg: gap ? null : parseFloat(s.hashrate_avg_ghs.toFixed(3)),
    };
  });

  const allValues = data.flatMap((d) => [d.curr, d.avg]).filter((v): v is number => v != null);
  const minVal = Math.max(0, Math.min(...allValues) * 0.95);
  const maxVal = Math.max(...allValues) * 1.05;

  return (
    <div className="chart" style={{ marginTop: '1rem' }}>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
          <XAxis
            dataKey="t"
            tickFormatter={fmtAxis}
            tick={{ fill: C.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={60}
          />
          <YAxis
            domain={[minVal, maxVal]}
            tickFormatter={(v: number) => fmtGhs(v)}
            tick={{ fill: C.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            contentStyle={{ background: C.panel, border: `1px solid ${C.accent}`, borderRadius: 8 }}
            labelStyle={{ color: C.tick, fontSize: 11 }}
            labelFormatter={(v: number) =>
              new Date(v).toLocaleString(locale, { timeZone: 'America/Sao_Paulo' })
            }
            formatter={(v: number, name: string) => [
              fmtGhs(v),
              name === 'curr' ? t('chart.current') : t('chart.average'),
            ]}
          />
          <Legend
            formatter={(v) => (v === 'curr' ? t('chart.current') : t('chart.average'))}
            wrapperStyle={{ fontSize: 12, color: C.tick }}
          />
          <Line
            type="monotone"
            dataKey="curr"
            stroke={C.line}
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="avg"
            stroke={C.line2}
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
