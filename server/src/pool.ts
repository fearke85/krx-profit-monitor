const POOL_API = 'https://baikalmine.com/api/engines/GetPoolMiner';
const CACHE_TTL_MS = 30_000;
const GH = 1e9;

interface RawWorker {
  name: string;
  isOffline: boolean;
  hashrate: { current: number; average: number };
  shares: { lastShare: number; accepted: number; stale: number; invalid: number };
}

interface RawPoolResponse {
  entity: {
    isOnline: boolean;
    hashrate: { current: number; average: number };
    shareStats: { accepted: number; stale: number; invalid: number; lastShare: number };
    stats: {
      dayliProfit: number;
      balance: number;
      immature: number;
      paid: number;
      blocksFound: number;
      roundShares: number;
    };
    info: { minThreshold: number };
    settings: { paymentThreshold: number };
    workers: {
      online: number;
      offline: number;
      total: number;
      list: RawWorker[];
    };
    payments: {
      total: number;
      list: Array<{ timestamp: number; amount: number; tx: string }>;
    };
    rewardsByPeriods: Array<{ reward: number }>;
  };
}

export interface PoolWorker {
  name: string;
  isOffline: boolean;
  hashrateCurrentGhs: number;
  hashrateAverageGhs: number;
  sharesAccepted: number;
  lastShareMs: number;
}

export interface PoolPayment {
  timestampMs: number;
  amountKrx: number;
  tx: string;
}

export interface PoolData {
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
  /** Lista completa de pagamentos que a API expõe (verdade-fonte dos ganhos, dedup por tx). */
  lastPayments: PoolPayment[];
  /** [1h, 12h, 24h, 48h, ...] KRX earned per period */
  rewardsByPeriods: number[];
  fetchedMs: number;
}

let cache: { data: PoolData; fetchedMs: number } | null = null;

export async function getPoolData(
  address: string,
  opts: { force?: boolean } = {},
): Promise<PoolData> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.fetchedMs < CACHE_TTL_MS) return cache.data;

  const res = await fetch(POOL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      Origin: 'https://baikalmine.com',
      Referer: 'https://baikalmine.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ type: 'pplns', coin: 'krx', miner: address }),
  });
  if (!res.ok) throw new Error(`baikalmine HTTP ${res.status}`);

  const raw = (await res.json()) as RawPoolResponse;
  const e = raw.entity;

  const data: PoolData = {
    isOnline: e.isOnline,
    hashrateCurrentGhs: e.hashrate.current / GH,
    hashrateAverageGhs: e.hashrate.average / GH,
    dailyEstKrx: e.stats.dayliProfit,
    balanceKrx: e.stats.balance,
    immatureKrx: e.stats.immature,
    matureKrx: e.stats.balance - e.stats.immature,
    paidKrx: e.stats.paid,
    minThresholdKrx: e.info.minThreshold,
    paymentThresholdKrx: e.settings?.paymentThreshold ?? e.info.minThreshold,
    workersOnline: e.workers.online,
    workersTotal: e.workers.total,
    lastShareMs: e.shareStats.lastShare * 1000,
    roundShares: e.stats.roundShares,
    workers: e.workers.list.map((w) => ({
      name: w.name,
      isOffline: w.isOffline,
      hashrateCurrentGhs: w.hashrate.current / GH,
      hashrateAverageGhs: w.hashrate.average / GH,
      sharesAccepted: w.shares.accepted,
      lastShareMs: w.shares.lastShare * 1000,
    })),
    // Lista completa (não fatiada): ingerida e deduplicada por tx no poolSync.
    lastPayments: (e.payments?.list ?? []).map((p) => ({
      timestampMs: p.timestamp * 1000,
      amountKrx: p.amount,
      tx: p.tx,
    })),
    rewardsByPeriods: (e.rewardsByPeriods ?? []).map((r) => r.reward),
    fetchedMs: now,
  };

  cache = { data, fetchedMs: now };
  return data;
}

/** Limpa o cache quando a carteira muda (novo endereço). */
export function clearPoolCache() {
  cache = null;
}
