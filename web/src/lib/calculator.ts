import { getEffectiveNetworkHashrate, getNetworkInfo, type NetworkInfo } from './keryx';
import {
  getMeta,
  setMeta,
  putCalcSnapshot,
  getCalcSnapshots,
  dailyReceived,
} from './db';
import { SOMPI_PER_KRX } from './config';
import { todayBrt, daysAgoBrt, eachDayBrt } from './day';
import { currentPrice } from './dashboard';

/**
 * A rede Keryx (BlockDAG estilo Kaspa/Crescendo) produz 10 blocos por segundo
 * (blockTime = 0.1 s) — ver emission schedule do explorer Keryx Labs
 * (https://keryx-labs.com/emission): 10 BPS · KRX/block × 10 = KRX/s.
 * (O total_blocks do /info é estático/desatualizado — não usar para BPS.)
 */
export const BLOCKS_PER_DAY = 864_000;

export type Currency = 'USD' | 'BRL';

/** Fonte do hashrate da rede na calculadora. */
export type NetHashMode = 'current' | 'avg';

export interface HashUnit {
  key: string;
  mult: number;
}

export const HASH_UNITS: HashUnit[] = [
  { key: 'H/s', mult: 1 },
  { key: 'kH/s', mult: 1e3 },
  { key: 'MH/s', mult: 1e6 },
  { key: 'GH/s', mult: 1e9 },
  { key: 'TH/s', mult: 1e12 },
];

/**
 * Brackets do holder reward (hardfork): o minerador recebe uma fração da
 * recompensa cheia conforme o effective balance (coin-age) vs produção 24h.
 */
export interface Bracket {
  id: number;
  /** Fração da recompensa de bloco que o minerador recebe (0.5 → 1.0). */
  multiplier: number;
  /** Requisito de effective balance vs produção diária (ex.: "≥ 3×"). */
  requirement: string;
}

export const BRACKETS: Bracket[] = [
  { id: 0, multiplier: 0.5, requirement: '< 3×' },
  { id: 1, multiplier: 0.55, requirement: '≥ 3×' },
  { id: 2, multiplier: 0.6, requirement: '≥ 7×' },
  { id: 3, multiplier: 0.65, requirement: '≥ 15×' },
  { id: 4, multiplier: 0.7, requirement: '≥ 30×' },
  { id: 5, multiplier: 0.75, requirement: '≥ 45×' },
  { id: 6, multiplier: 0.8, requirement: '≥ 60×' },
  { id: 7, multiplier: 0.9, requirement: '≥ 75×' },
  { id: 8, multiplier: 1.0, requirement: '≥ 90×' },
];

export interface CalcConfig {
  hashrate: number;
  /** key de HASH_UNITS */
  unit: string;
  /** 0–8 (índice em BRACKETS) */
  bracket: number;
  feeEnabled: boolean;
  /** % descontado pela pool/minerador (0–100) */
  feePct: number;
  currency: Currency;
  /** custo do kWh na moeda escolhida */
  kwhCost: number;
  /** consumo do rig em watts */
  powerW: number;
  /** current = /info instantâneo; avg = média client-side das últimas N horas */
  netHashMode: NetHashMode;
  /** Janela da média (1–24), só usada quando netHashMode === 'avg' */
  netHashAvgHours: number;
}

export const DEFAULT_CONFIG: CalcConfig = {
  hashrate: 100,
  unit: 'MH/s',
  // Bracket 7 (90%) como chute inicial; o usuário deve ajustar ao keeper
  // real (solo = endereço no Explorer; pool = bracket da pool).
  bracket: 7,
  feeEnabled: false,
  feePct: 1,
  currency: 'USD',
  kwhCost: 0.1,
  powerW: 100,
  netHashMode: 'current',
  netHashAvgHours: 2,
};

const CONFIG_KEY = 'calc_config';

function clampAvgHours(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_CONFIG.netHashAvgHours;
  return Math.min(24, Math.max(1, Math.round(v)));
}

export async function loadCalcConfig(): Promise<CalcConfig | null> {
  const raw = await getMeta(CONFIG_KEY);
  if (!raw) return null;
  try {
    // Descarta campos legados (hashScale / escala pool→nó) de configs antigas.
    const parsed = JSON.parse(raw) as Partial<CalcConfig> & { hashScale?: unknown };
    const { hashScale: _legacy, ...rest } = parsed;
    const merged: CalcConfig = { ...DEFAULT_CONFIG, ...rest };
    merged.netHashMode = rest.netHashMode === 'avg' ? 'avg' : 'current';
    merged.netHashAvgHours = clampAvgHours(rest.netHashAvgHours ?? merged.netHashAvgHours);
    return merged;
  } catch {
    return null;
  }
}

export async function saveCalcConfig(cfg: CalcConfig): Promise<void> {
  await setMeta(CONFIG_KEY, JSON.stringify(cfg));
}

/** Câmbio USD→BRL via /api/fx (AwesomeAPI). 0 = indisponível. */
export async function getUsdBrl(): Promise<number> {
  try {
    const res = await fetch('/api/fx');
    if (!res.ok) return 0;
    const data = (await res.json()) as { usd_brl?: number };
    return data.usd_brl && data.usd_brl > 0 ? data.usd_brl : 0;
  } catch {
    return 0;
  }
}

export function unitMult(unitKey: string): number {
  return HASH_UNITS.find((u) => u.key === unitKey)?.mult ?? 1;
}

/** Fração do hashrate da rede que pertence ao usuário (0–1). */
export function hashShare(cfg: CalcConfig, net: NetworkInfo): number {
  const userHps = cfg.hashrate * unitMult(cfg.unit);
  if (userHps <= 0 || net.hashrateHps <= 0) return 0;
  return userHps / net.hashrateHps;
}

/**
 * Produção esperada em KRX/dia, já aplicando o bracket do holder reward
 * e a fee de pool/minerador (quando habilitada).
 *
 * Fonte da verdade: explorer Keryx Labs — hashrate_rede e block_reward_krx
 * de /api/v1/info (+ média de /hashrate-history); 10 BPS da emission schedule.
 * Sem fatores de calibração de pool (×0,5 / ×⅔ do hardfork H4).
 */
export function computeKrxPerDay(cfg: CalcConfig, net: NetworkInfo): number {
  const share = hashShare(cfg, net);
  if (share <= 0) return 0;
  const bracketMult = BRACKETS[cfg.bracket]?.multiplier ?? BRACKETS[0].multiplier;
  const fee = cfg.feeEnabled ? Math.min(Math.max(cfg.feePct, 0), 100) / 100 : 0;
  // A dificuldade já está embutida: o hashrate da rede é derivado dela pelo nó.
  return share * BLOCKS_PER_DAY * net.blockRewardKrx * bracketMult * (1 - fee);
}

export interface PeriodResult {
  /** rótulo i18n: calc.period24h / calc.periodWeek / calc.periodMonth */
  key: string;
  days: number;
  krx: number;
  revenue: number;
  energyCost: number;
  profit: number;
}

export interface CalcResult {
  krxPerDay: number;
  sharePct: number;
  priceUsd: number;
  usdBrl: number;
  currency: Currency;
  /** BRL escolhido mas câmbio indisponível → valores exibidos em USD. */
  fxMissing: boolean;
  periods: PeriodResult[];
  network: NetworkInfo;
}

export function buildResult(
  cfg: CalcConfig,
  net: NetworkInfo,
  priceUsd: number,
  usdBrl: number,
): CalcResult {
  const krxPerDay = computeKrxPerDay(cfg, net);
  const fxMissing = cfg.currency === 'BRL' && usdBrl <= 0;
  const rate = cfg.currency === 'BRL' && usdBrl > 0 ? usdBrl : 1;
  const revenuePerDay = krxPerDay * priceUsd * rate;
  const energyPerDay = (cfg.powerW / 1000) * 24 * cfg.kwhCost;

  const mk = (key: string, days: number): PeriodResult => ({
    key,
    days,
    krx: krxPerDay * days,
    revenue: revenuePerDay * days,
    energyCost: energyPerDay * days,
    profit: (revenuePerDay - energyPerDay) * days,
  });

  return {
    krxPerDay,
    sharePct: hashShare(cfg, net) * 100,
    priceUsd,
    usdBrl,
    currency: fxMissing ? 'USD' : cfg.currency,
    fxMissing,
    periods: [mk('calc.period24h', 1), mk('calc.periodWeek', 7), mk('calc.periodMonth', 30)],
    network: net,
  };
}

/** Grava/atualiza a previsão do dia (snapshot usado no gráfico previsto × realizado). */
export async function snapshotPrediction(krxPerDay: number, priceUsd: number): Promise<void> {
  if (!(krxPerDay > 0)) return;
  await putCalcSnapshot({
    day_brt: todayBrt(),
    predicted_krx: krxPerDay,
    price_usd: priceUsd,
    captured_ms: Date.now(),
  });
}

/**
 * Chamado no boot do app: se a calculadora já foi configurada, registra a
 * previsão de hoje mesmo sem abrir a aba (mantém a série diária contínua).
 */
export async function snapshotTodayIfConfigured(): Promise<void> {
  try {
    const cfg = await loadCalcConfig();
    if (!cfg) return;
    const [net, eff, priceUsd] = await Promise.all([
      getNetworkInfo(),
      getEffectiveNetworkHashrate(cfg.netHashMode, cfg.netHashAvgHours),
      currentPrice(),
    ]);
    const effNet = { ...net, hashrateHps: eff.hashrateHps > 0 ? eff.hashrateHps : net.hashrateHps };
    await snapshotPrediction(computeKrxPerDay(cfg, effNet), priceUsd);
  } catch {
    // silencioso: snapshot é best-effort
  }
}

export interface CompareRow {
  day: string;
  predicted_krx: number | null;
  actual_krx: number;
}

/**
 * Série previsto × realizado, do primeiro dia com snapshot até hoje
 * (limitado a `days` dias-calendário).
 */
export async function getComparison(days = 30): Promise<CompareRow[]> {
  const to = todayBrt();
  const from = daysAgoBrt(days - 1);
  const [snaps, recv] = await Promise.all([
    getCalcSnapshots(from, to),
    dailyReceived(from, to),
  ]);
  if (snaps.length === 0) return [];

  const snapMap = new Map(snaps.map((s) => [s.day_brt, s.predicted_krx]));
  const recvMap = new Map(recv.map((r) => [r.day, r.received_sompi / SOMPI_PER_KRX]));
  const start = snaps[0].day_brt > from ? snaps[0].day_brt : from;

  return eachDayBrt(start, to).map((day) => ({
    day,
    predicted_krx: snapMap.get(day) ?? null,
    actual_krx: recvMap.get(day) ?? 0,
  }));
}
