import { POLL_INTERVAL_MS } from './config';
import {
  getAddressTxsPage,
  getBlockTimestampMs,
  type ListedTx,
} from './keryx';
import {
  bulkUpsertListedTxs,
  pendingCount,
  pendingTxRows,
  applyEstimatedTimestamps,
  txCount,
  wipeTxs,
  getMeta,
  setMeta,
  snapshotPrice,
  insertPricePoint,
  prunePriceHistory,
  getActiveAddress,
  type TxRow,
} from './db';
import { toBrtDay, todayBrt } from './day';

const PAGE = 100;
const PAGE_CONCURRENCY = 6;
const CALIBRATE_SAMPLES = 16;
const TIMESTAMP_CHUNK = 800;

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

/** Relógio linear: timestamp_ms ≈ intercept + slope * daa_score */
interface DaaClock {
  intercept: number;
  slope: number;
}

const CLOCK_META = 'daa_clock_v1';

async function loadClock(): Promise<DaaClock | null> {
  const raw = await getMeta(CLOCK_META);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as DaaClock;
    if (Number.isFinite(c.intercept) && Number.isFinite(c.slope) && c.slope > 0) return c;
  } catch {
    /* ignore */
  }
  return null;
}

async function saveClock(clock: DaaClock): Promise<void> {
  await setMeta(CLOCK_META, JSON.stringify(clock));
}

function fitClock(points: Array<{ daa: number; ts: number }>): DaaClock | null {
  if (points.length < 2) return null;
  // Regressão linear simples (least squares).
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  const n = points.length;
  for (const p of points) {
    sumX += p.daa;
    sumY += p.ts;
    sumXX += p.daa * p.daa;
    sumXY += p.daa * p.ts;
  }
  const den = n * sumXX - sumX * sumX;
  if (Math.abs(den) < 1) return null;
  const slope = (n * sumXY - sumX * sumY) / den;
  const intercept = (sumY - slope * sumX) / n;
  if (!(slope > 0) || !Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  return { intercept, slope };
}

function estimateTs(clock: DaaClock, daa: number): number {
  return Math.round(clock.intercept + clock.slope * daa);
}

/** Amostra blocos espalhados e calibra DAA→timestamp (em vez de 1 request/tx). */
async function calibrateClock(samples: ListedTx[]): Promise<DaaClock | null> {
  const unique = new Map<string, ListedTx>();
  for (const t of samples) {
    if (!unique.has(t.block_hash)) unique.set(t.block_hash, t);
  }
  const list = [...unique.values()].slice(0, CALIBRATE_SAMPLES);
  const points: Array<{ daa: number; ts: number }> = [];
  await mapPool(list, 10, async (t) => {
    try {
      const ts = await getBlockTimestampMs(t.block_hash);
      if (ts > 0) points.push({ daa: t.daa_score, ts });
    } catch (err) {
      console.warn('[clock] block', t.block_hash.slice(0, 10), (err as Error).message);
    }
  });
  const clock = fitClock(points);
  if (clock) {
    await saveClock(clock);
    console.log(
      `[clock] calibrado com ${points.length} blocos · slope=${clock.slope.toFixed(2)} ms/daa`,
    );
  }
  return clock;
}

async function stampPendingWithClock(clock: DaaClock): Promise<number> {
  let stamped = 0;
  for (;;) {
    const rows = await pendingTxRows(TIMESTAMP_CHUNK);
    if (rows.length === 0) break;
    const updates = rows.map((r) => {
      const ts = estimateTs(clock, r.daa_score);
      return { tx_id: r.tx_id, timestamp_ms: ts, day_brt: toBrtDay(ts) };
    });
    await applyEstimatedTimestamps(updates);
    stamped += updates.length;
    syncStatus.pendingTimestamps = await pendingCount();
    syncStatus.ingestedTxs = await txCount();
    notify();
  }
  return stamped;
}

/**
 * Backfill: páginas em paralelo + amount da listagem.
 * Timestamps vêm do relógio DAA (poucas leituras de bloco), não de 1 detalhe/tx.
 */
async function backfill(address: string): Promise<void> {
  if ((await getMeta('backfill_done')) === '1') return;
  syncStatus.phase = 'backfill';
  notify();

  const first = await getAddressTxsPage(address, PAGE, 0);
  syncStatus.totalTxCount = first.totalTxCount;
  await bulkUpsertListedTxs(first.txs);
  syncStatus.ingestedTxs = await txCount();
  notify();

  const total = first.totalTxCount;
  const offsets: number[] = [];
  for (let off = PAGE; off < total; off += PAGE) offsets.push(off);

  // Amostras para o relógio: início / meio / fim.
  const sampleBag: ListedTx[] = [...first.txs];
  const midOff = Math.floor(total / 2 / PAGE) * PAGE;
  const lastOff = Math.max(0, Math.floor((total - 1) / PAGE) * PAGE);
  for (const off of [midOff, lastOff]) {
    if (off > 0 && off < total) {
      try {
        const p = await getAddressTxsPage(address, PAGE, off);
        sampleBag.push(...p.txs);
      } catch (err) {
        console.warn('[backfill] sample page', off, (err as Error).message);
      }
    }
  }

  // Calibra cedo para já ir carimbando enquanto o resto das páginas chega.
  let clock = (await calibrateClock(sampleBag)) ?? (await loadClock());
  if (clock) {
    syncStatus.phase = 'details';
    notify();
    await stampPendingWithClock(clock);
    syncStatus.phase = 'backfill';
    notify();
  }

  let done = 0;
  await mapPool(offsets, PAGE_CONCURRENCY, async (offset) => {
    const page = await getAddressTxsPage(address, PAGE, offset);
    await bulkUpsertListedTxs(page.txs);
    done += 1;
    if (done % 3 === 0 || done === offsets.length) {
      syncStatus.ingestedTxs = await txCount();
      syncStatus.pendingTimestamps = await pendingCount();
      notify();
    }
  });

  clock = (await loadClock()) ?? (await calibrateClock(sampleBag));
  if (clock) {
    syncStatus.phase = 'details';
    notify();
    await stampPendingWithClock(clock);
  } else {
    console.warn('[clock] falha na calibração — dias ficam pendentes até o próximo ciclo');
  }

  await setMeta('backfill_done', '1');
  syncStatus.backfillDone = true;
  syncStatus.ingestedTxs = await txCount();
  syncStatus.pendingTimestamps = await pendingCount();
  notify();
}

async function ingestRecent(address: string): Promise<void> {
  syncStatus.phase = 'incremental';
  notify();
  let offset = 0;
  const newTxs: ListedTx[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const page = await getAddressTxsPage(address, PAGE, offset);
    syncStatus.totalTxCount = page.totalTxCount;
    if (page.txs.length === 0) break;
    const inserted = await bulkUpsertListedTxs(page.txs);
    if (inserted > 0) {
      // Só as novas precisam de timestamp; re-busca ids sem stamp depois.
      newTxs.push(...page.txs);
    }
    offset += page.txs.length;
    if (inserted === 0) break;
    if (offset >= page.totalTxCount) break;
  }
  syncStatus.ingestedTxs = await txCount();
  notify();

  if ((await pendingCount()) === 0) return;

  syncStatus.phase = 'details';
  notify();
  let clock = await loadClock();
  // Recalibra barato com txs novas (blocos frescos) para não driftar.
  if (newTxs.length > 0) {
    clock = (await calibrateClock(newTxs.slice(0, 8))) ?? clock;
  }
  if (!clock) clock = await calibrateClock(newTxs);
  if (clock) await stampPendingWithClock(clock);
  syncStatus.pendingTimestamps = await pendingCount();
  notify();
}

async function reconcileAddress(address: string): Promise<void> {
  const synced = await getMeta('synced_address');
  if (synced !== address) {
    await wipeTxs();
    await setMeta('synced_address', address);
    await setMeta('backfill_done', '0');
    await setMeta(CLOCK_META, '');
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
      // Se ainda há pendentes (calibração falhou antes), tenta de novo.
      if ((await pendingCount()) > 0) {
        const sample = await pendingTxRows(CALIBRATE_SAMPLES);
        const asListed: ListedTx[] = sample.map((r: TxRow) => ({
          tx_id: r.tx_id,
          block_hash: r.block_hash,
          daa_score: r.daa_score,
          net_sompi: r.net_sompi ?? 0,
        }));
        const clock = (await calibrateClock(asListed)) ?? (await loadClock());
        if (clock) await stampPendingWithClock(clock);
      }
    }
    syncStatus.lastSyncMs = Date.now();
  } catch (err) {
    syncStatus.lastError = (err as Error).message;
    console.error('[sync]', syncStatus.lastError);
  } finally {
    syncStatus.phase = 'idle';
    syncStatus.running = false;
    syncStatus.pendingTimestamps = await pendingCount().catch(() => 0);
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
