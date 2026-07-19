import { SOMPI_PER_KRX, BATCH_TARGET_KRX, TIMEZONE } from './config';
import { getBalanceSompi } from './keryx';
import {
  getActiveAddress,
  setActiveAddress,
  isValidAddressFormat,
  normalizeAddress,
  dailyReceived,
  receivedOnDay,
  firstReceivedDay,
  getPriceSnapshot,
  getPriceRange,
  getMeta,
  txCount,
  pendingCount,
} from './db';
import { todayBrt, daysAgoBrt, eachDayBrt } from './day';
import { syncStatus } from './sync';

const toKrx = (sompi: number) => sompi / SOMPI_PER_KRX;

export interface Summary {
  address: string | null;
  needs_address?: boolean;
  timezone: string;
  price_usd: number;
  balance_krx?: number;
  balance_usdt?: number;
  today?: {
    day: string;
    received_krx: number;
    tx_count: number;
    est_usdt: number;
  };
  sync?: {
    backfill_done: boolean;
    phase: string;
    ingested_txs: number;
    total_txs: number;
    pending_timestamps: number;
    last_sync_ms: number;
  };
}

export interface DailyRowView {
  day: string;
  received_krx: number;
  tx_count: number;
  price_usd_used: number;
  price_source: 'current' | 'snapshot';
  est_usdt: number;
}

export interface DailyResponse {
  from: string;
  to: string;
  days: DailyRowView[];
}

export interface PriceRangeView {
  min: number;
  max: number;
  first: number;
  last: number;
}

export interface StrategyData {
  batch_target_krx: number;
  wallet_balance_krx: number;
  daily_est_krx: number;
  accumulated_krx: number;
  remaining_krx: number;
  eta_hours: number;
  current_price_usd: number;
  price_range_24h: PriceRangeView | null;
  price_range_48h: PriceRangeView | null;
  price_signal: 'high' | 'neutral' | 'low' | null;
  batch_ready: boolean;
  price_favorable: boolean;
  deposit_alert: boolean;
}

export async function currentPrice(): Promise<number> {
  const snap = await getPriceSnapshot(todayBrt());
  if (snap && snap > 0) return snap;
  try {
    const res = await fetch('/api/price');
    if (!res.ok) return 0;
    const data = (await res.json()) as { price_usd?: number };
    return data.price_usd && data.price_usd > 0 ? data.price_usd : 0;
  } catch {
    return 0;
  }
}

export async function getSummary(): Promise<Summary> {
  const price = await currentPrice();
  const address = await getActiveAddress();

  if (!address) {
    return {
      address: null,
      needs_address: true,
      timezone: TIMEZONE,
      price_usd: price,
    };
  }

  const balanceSompi = await getBalanceSompi(address);
  const today = todayBrt();
  const todayRecv = await receivedOnDay(today);
  const todayKrx = toKrx(todayRecv.received_sompi);

  return {
    address,
    needs_address: false,
    timezone: TIMEZONE,
    price_usd: price,
    balance_krx: toKrx(balanceSompi),
    balance_usdt: toKrx(balanceSompi) * price,
    today: {
      day: today,
      received_krx: todayKrx,
      tx_count: todayRecv.tx_count,
      est_usdt: todayKrx * price,
    },
    sync: {
      backfill_done: syncStatus.backfillDone || (await getMeta('backfill_done')) === '1',
      phase: syncStatus.phase,
      ingested_txs: syncStatus.ingestedTxs || (await txCount()),
      total_txs: syncStatus.totalTxCount,
      pending_timestamps: syncStatus.pendingTimestamps || (await pendingCount()),
      last_sync_ms: syncStatus.lastSyncMs,
    },
  };
}

async function priceForDay(
  day: string,
  today: string,
  current: number,
): Promise<{ priceUsed: number; priceSource: 'current' | 'snapshot' }> {
  if (day === today) return { priceUsed: current, priceSource: 'current' };
  const snapshot = await getPriceSnapshot(day);
  if (snapshot !== undefined) return { priceUsed: snapshot, priceSource: 'snapshot' };
  return { priceUsed: current, priceSource: 'current' };
}

/**
 * Histórico diário de KRX produzido (recebido on-chain).
 * Preenche todos os dias-calendário do intervalo (zeros nos dias sem produção),
 * para o gráfico/tabela mostrarem a série contínua.
 */
export async function getDaily(from?: string, to?: string): Promise<DailyResponse> {
  const toDay = to ?? todayBrt();
  let fromDay = from ?? daysAgoBrt(29);

  // "Tudo" (from omitido): começa no primeiro dia com produção.
  if (from === undefined) {
    fromDay = (await firstReceivedDay()) ?? todayBrt();
  } else if (fromDay < daysAgoBrt(120)) {
    // Janelas longas: não preencher zeros antes da primeira produção.
    const first = await firstReceivedDay();
    if (first && first > fromDay) fromDay = first;
  }

  const current = await currentPrice();
  const today = todayBrt();
  const rows = await dailyReceived(fromDay, toDay);
  const byDay = new Map(rows.map((r) => [r.day, r]));

  const days: DailyRowView[] = [];
  for (const day of eachDayBrt(fromDay, toDay)) {
    const r = byDay.get(day);
    const receivedKrx = r ? toKrx(r.received_sompi) : 0;
    const txCount = r?.tx_count ?? 0;
    const { priceUsed, priceSource } = await priceForDay(day, today, current);
    days.push({
      day,
      received_krx: receivedKrx,
      tx_count: txCount,
      price_usd_used: priceUsed,
      price_source: priceSource,
      est_usdt: receivedKrx * priceUsed,
    });
  }

  return { from: fromDay, to: toDay, days };
}

export async function getStrategy(): Promise<StrategyData> {
  const address = await getActiveAddress();
  const currentPriceUsd = await currentPrice();

  let walletBalanceKrx = 0;
  if (address) {
    walletBalanceKrx = toKrx(await getBalanceSompi(address));
  }

  const recent = await dailyReceived(daysAgoBrt(6), todayBrt());
  const dailyEstKrx =
    recent.length > 0
      ? recent.reduce((s, r) => s + toKrx(r.received_sompi), 0) / recent.length
      : 0;

  const now = Date.now();
  const DAY_MS = 86_400_000;
  const range24h = await getPriceRange(now - DAY_MS);
  const range48h = await getPriceRange(now - 2 * DAY_MS);

  let priceSignal: 'high' | 'neutral' | 'low' | null = null;
  if (range24h && range24h.max > range24h.min) {
    const pct = (currentPriceUsd - range24h.min) / (range24h.max - range24h.min);
    if (pct >= 0.66) priceSignal = 'high';
    else if (pct <= 0.33) priceSignal = 'low';
    else priceSignal = 'neutral';
  }

  const accumulatedKrx = Math.min(walletBalanceKrx, BATCH_TARGET_KRX);
  const remainingKrx = Math.max(0, BATCH_TARGET_KRX - walletBalanceKrx);
  const etaHours =
    remainingKrx > 0 && dailyEstKrx > 0 ? (remainingKrx / dailyEstKrx) * 24 : 0;
  const batchReady = walletBalanceKrx >= BATCH_TARGET_KRX;
  const priceFavorable = priceSignal === 'high';

  return {
    batch_target_krx: BATCH_TARGET_KRX,
    wallet_balance_krx: walletBalanceKrx,
    daily_est_krx: dailyEstKrx,
    accumulated_krx: accumulatedKrx,
    remaining_krx: remainingKrx,
    eta_hours: etaHours,
    current_price_usd: currentPriceUsd,
    price_range_24h: range24h,
    price_range_48h: range48h,
    price_signal: priceSignal,
    batch_ready: batchReady,
    price_favorable: priceFavorable,
    deposit_alert: batchReady && priceFavorable,
  };
}

export async function setAddress(
  address: string,
): Promise<{ address: string; balance_krx: number }> {
  const normalized = normalizeAddress(address);
  if (!isValidAddressFormat(normalized)) {
    throw new Error('Endereço inválido. Use o formato keryx:... do explorer.');
  }
  try {
    const balanceSompi = await getBalanceSompi(normalized);
    await setActiveAddress(normalized);
    return { address: normalized, balance_krx: toKrx(balanceSompi) };
  } catch {
    throw new Error(
      'Não consegui consultar esse endereço na API do Keryx. Verifique e tente de novo.',
    );
  }
}
