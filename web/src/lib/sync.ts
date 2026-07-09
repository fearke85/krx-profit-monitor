import { POLL_INTERVAL_MS } from './config';
import { getAddressTxsPage, getTxDetail } from './keryx';
import {
  insertTxIfNew,
  pendingTxIds,
  pendingCount,
  applyTxDetail,
  txCount,
  wipeTxs,
  getMeta,
  setMeta,
  snapshotPrice,
  insertPricePoint,
  prunePriceHistory,
  getActiveAddress,
} from './db';
import { toBrtDay, todayBrt } from './day';

const PAGE = 100;
const DETAIL_CONCURRENCY = 6;

export type SyncPhase = 'idle' | 'backfill' | 'incremental' | 'details';

export interface SyncStatus {
  address: string | null;
  backfillDone: boolean;
  ingestedTxs: number;
  pendingTimestamps: number;
  lastSyncMs: number;
  totalTxCount: number;
  running: boolean;
  phase: SyncPhase;
  lastError: string | null;
}

export const syncStatus: SyncStatus = {
  address: null,
  backfillDone: false,
  ingestedTxs: 0,
  pendingTimestamps: 0,
  lastSyncMs: 0,
  totalTxCount: 0,
  running: false,
  phase: 'idle',
  lastError: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchPriceUsd(): Promise<number> {
  const res = await fetch('/api/price');
  if (!res.ok) throw new Error(`price HTTP ${res.status}`);
  const data = (await res.json()) as { price_usd?: number };
  const price = data.price_usd ?? NaN;
  if (!Number.isFinite(price) || price <= 0) throw new Error('preço inválido');
  return price;
}

async function capturePrice(): Promise<void> {
  try {
    const price = await fetchPriceUsd();
    const now = Date.now();
    await snapshotPrice(todayBrt(), price, now);
    await insertPricePoint(now, price);
    await prunePriceHistory(48);
  } catch (err) {
    console.warn('[price]', (err as Error).message);
  }
}

async function backfill(address: string): Promise<void> {
  if ((await getMeta('backfill_done')) === '1') return;
  syncStatus.phase = 'backfill';
  notify();
  let offset = 0;
  let inserted = 0;
  for (;;) {
    const page = await getAddressTxsPage(address, PAGE, offset);
    syncStatus.totalTxCount = page.totalTxCount;
    if (page.txs.length === 0) break;
    for (const tx of page.txs) {
      if (await insertTxIfNew(tx)) inserted++;
    }
    offset += page.txs.length;
    syncStatus.ingestedTxs = await txCount();
    notify();
    if (offset >= page.totalTxCount) break;
  }
  await setMeta('backfill_done', '1');
  syncStatus.backfillDone = true;
  notify();
}

async function ingestRecent(address: string): Promise<void> {
  syncStatus.phase = 'incremental';
  notify();
  let offset = 0;
  for (let guard = 0; guard < 20; guard++) {
    const page = await getAddressTxsPage(address, PAGE, offset);
    syncStatus.totalTxCount = page.totalTxCount;
    if (page.txs.length === 0) break;
    let newInPage = 0;
    for (const tx of page.txs) {
      if (await insertTxIfNew(tx)) newInPage++;
    }
    offset += page.txs.length;
    if (newInPage === 0) break;
    if (offset >= page.totalTxCount) break;
  }
  syncStatus.ingestedTxs = await txCount();
  notify();
}

async function resolveTxDetails(address: string, maxTxs = 20_000): Promise<void> {
  syncStatus.phase = 'details';
  notify();
  let resolved = 0;
  for (;;) {
    const ids = await pendingTxIds(Math.min(DETAIL_CONCURRENCY * 8, maxTxs - resolved));
    if (ids.length === 0) break;
    await mapPool(ids, DETAIL_CONCURRENCY, async (txId) => {
      try {
        const d = await getTxDetail(address, txId);
        await applyTxDetail(txId, d.netSompi, d.timestampMs, toBrtDay(d.timestampMs));
      } catch (err) {
        console.warn(`[details] ${txId}:`, (err as Error).message);
      }
    });
    resolved += ids.length;
    syncStatus.pendingTimestamps = await pendingCount();
    syncStatus.ingestedTxs = await txCount();
    notify();
    if (resolved >= maxTxs) break;
  }
}

async function reconcileAddress(address: string): Promise<void> {
  const synced = await getMeta('synced_address');
  if (synced !== address) {
    await wipeTxs();
    await setMeta('synced_address', address);
    await setMeta('backfill_done', '0');
    syncStatus.backfillDone = false;
    syncStatus.ingestedTxs = 0;
    syncStatus.pendingTimestamps = 0;
    syncStatus.totalTxCount = 0;
    notify();
  }
}

async function runCycle(): Promise<void> {
  if (syncStatus.running) return;
  syncStatus.running = true;
  syncStatus.lastError = null;
  notify();
  try {
    await capturePrice();

    const address = await getActiveAddress();
    syncStatus.address = address;
    if (!address) return;

    await reconcileAddress(address);
    syncStatus.backfillDone = (await getMeta('backfill_done')) === '1';
    syncStatus.ingestedTxs = await txCount();
    syncStatus.pendingTimestamps = await pendingCount();
    notify();

    if (!syncStatus.backfillDone) {
      await backfill(address);
    } else {
      await ingestRecent(address);
    }
    await resolveTxDetails(address);
    syncStatus.lastSyncMs = Date.now();
  } catch (err) {
    syncStatus.lastError = (err as Error).message;
    console.error('[sync]', syncStatus.lastError);
  } finally {
    syncStatus.phase = 'idle';
    syncStatus.running = false;
    notify();
  }
}

export function triggerSync(): void {
  void runCycle();
}

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startSync(): void {
  if (started) return;
  started = true;
  void runCycle();
  intervalId = setInterval(() => {
    if (document.visibilityState === 'visible') void runCycle();
  }, POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runCycle();
  });
}

export function stopSync(): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  started = false;
}
