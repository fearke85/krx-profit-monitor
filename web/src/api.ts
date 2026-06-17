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

export interface DailyRow {
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
  days: DailyRow[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function getSummary(): Promise<Summary> {
  return getJson<Summary>('/api/summary');
}

export function getDaily(from?: string, to?: string): Promise<DailyResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return getJson<DailyResponse>(`/api/daily${qs ? `?${qs}` : ''}`);
}

export interface PoolWorker {
  name: string;
  isOffline: boolean;
  hashrateCurrentGhs: number;
  hashrateAverageGhs: number;
  sharesAccepted: number;
  lastShareMs: number;
}

export type PoolHistoryRange = '24h' | '48h' | '7d' | '30d' | '90d' | 'year' | 'all';
export type PoolHistoryResolution = 'raw' | 'hourly' | 'daily';

export interface PoolSnapshot {
  t: number; // timestamp (ms) do ponto/bucket
  hashrate_curr_ghs: number;
  hashrate_avg_ghs: number;
  balance_krx: number;
  immature_krx: number;
  daily_est_krx: number;
  workers_online: number;
  coverage: number; // 1 = sem gaps; < 1 = downtime no bucket
}

export interface PoolWorkerSnap {
  snapshot_id: number;
  name: string;
  is_offline: boolean;
  hashrate_curr_ghs: number;
  hashrate_avg_ghs: number;
  shares_accepted: number;
}

export interface BridgeBlock {
  hash: string;
  nonce: string;
  bluescore: string;
  worker: string;
}

export interface PoolData {
  /** 'solo' = sua pool local (bridge); ausente/'pool' = pool externa (baikalmine). */
  mode?: 'solo' | 'pool';
  isOnline: boolean;
  hashrateCurrentGhs: number;
  hashrateAverageGhs: number;
  dailyEstKrx: number;
  balanceKrx: number;
  immatureKrx: number;
  matureKrx: number;
  paidKrx: number;
  minThresholdKrx: number;
  paymentThresholdKrx: number;
  workersOnline: number;
  workersTotal: number;
  lastShareMs: number;
  roundShares: number;
  workers: PoolWorker[];
  lastPayments: Array<{ timestampMs: number; amountKrx: number; tx: string }>;
  rewardsByPeriods: number[];
  fetchedMs: number;
  history?: {
    resolution: PoolHistoryResolution;
    snapshots: PoolSnapshot[];
    workerSnaps: PoolWorkerSnap[];
  };
  // ---- extras solo (presentes só quando mode === 'solo') ----
  blocksFound?: number;
  blocks?: BridgeBlock[];
  networkHashrateHs?: number;
  networkDifficulty?: number;
  networkBlockCount?: number;
  opoiChallengePasses?: number;
  opoiInferenceResults?: number;
  expectedBlocksPerDay?: number;
  expectedTimeToBlockMs?: number;
  blockRewardKrx?: number;
}

export function getPool(range: PoolHistoryRange = '24h'): Promise<PoolData> {
  return getJson<PoolData>(`/api/pool?range=${range}`);
}

export function getBridge(range: PoolHistoryRange = '24h'): Promise<PoolData> {
  return getJson<PoolData>(`/api/bridge?range=${range}`);
}

export interface PoolPayment {
  tx: string;
  timestamp_ms: number;
  amount_krx: number;
  day_brt: string;
}

export interface PoolPaymentDaily {
  day: string;
  paid_krx: number;
  payment_count: number;
}

export interface PoolPaymentsResponse {
  total_krx: number;
  payments: PoolPayment[];
  daily: PoolPaymentDaily[];
}

export function getPoolPayments(): Promise<PoolPaymentsResponse> {
  return getJson<PoolPaymentsResponse>('/api/pool/payments');
}

export interface PriceRange {
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
  price_range_24h: PriceRange | null;
  price_range_48h: PriceRange | null;
  price_signal: 'high' | 'neutral' | 'low' | null;
  batch_ready: boolean;
  price_favorable: boolean;
  deposit_alert: boolean;
}

export function getStrategy(): Promise<StrategyData> {
  return getJson<StrategyData>('/api/strategy');
}

export async function setAddress(
  address: string,
): Promise<{ address: string; balance_krx: number }> {
  const res = await fetch('/api/address', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return body as { address: string; balance_krx: number };
}
