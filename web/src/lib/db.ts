import Dexie, { type Table } from 'dexie';
import type { ListedTx } from './keryx';

export interface RawTx {
  tx_id: string;
  block_hash: string;
  daa_score: number;
}

export interface TxRow {
  tx_id: string;
  block_hash: string;
  daa_score: number;
  net_sompi: number | null;
  /** 0 = pendente de timestamp; >0 = resolvido. */
  timestamp_ms: number;
  day_brt: string | null;
}

export interface PriceSnapshotRow {
  day_brt: string;
  price_usd: number;
  captured_ms: number;
}

export interface PriceHistoryRow {
  id?: number;
  captured_ms: number;
  price_usd: number;
}

export interface MetaRow {
  key: string;
  value: string;
}

export interface DailyRow {
  day: string;
  received_sompi: number;
  tx_count: number;
}

export interface PriceRange {
  min: number;
  max: number;
  first: number;
  last: number;
}

class KrxDB extends Dexie {
  txs!: Table<TxRow, string>;
  price_snapshots!: Table<PriceSnapshotRow, string>;
  price_history!: Table<PriceHistoryRow, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('krx-profit-monitor');
    this.version(1).stores({
      txs: 'tx_id, day_brt, timestamp_ms',
      price_snapshots: 'day_brt',
      price_history: '++id, captured_ms',
      meta: 'key',
    });
    // v2: timestamp_ms nunca null (0 = pendente) para indexar pending; daa_score indexado.
    this.version(2)
      .stores({
        txs: 'tx_id, day_brt, timestamp_ms, daa_score',
        price_snapshots: 'day_brt',
        price_history: '++id, captured_ms',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('txs')
          .toCollection()
          .modify((row: TxRow) => {
            if (row.timestamp_ms == null || (row.timestamp_ms as unknown) === null) {
              row.timestamp_ms = 0;
            }
          });
      });
  }
}

export const db = new KrxDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

/** Insere página inteira de uma vez. Retorna quantas eram novas. */
export async function bulkUpsertListedTxs(txs: ListedTx[]): Promise<number> {
  if (txs.length === 0) return 0;
  const ids = txs.map((t) => t.tx_id);
  const existing = await db.txs.bulkGet(ids);
  const existingSet = new Set(
    existing.filter(Boolean).map((r) => (r as TxRow).tx_id),
  );
  const fresh = txs.filter((t) => !existingSet.has(t.tx_id));
  if (fresh.length === 0) return 0;
  await db.txs.bulkAdd(
    fresh.map((t) => ({
      tx_id: t.tx_id,
      block_hash: t.block_hash,
      daa_score: t.daa_score,
      net_sompi: t.net_sompi,
      timestamp_ms: 0,
      day_brt: null,
    })),
  );
  return fresh.length;
}

export async function txCount(): Promise<number> {
  return db.txs.count();
}

export async function wipeTxs(): Promise<void> {
  await db.txs.clear();
}

export async function pendingTxIds(limit: number): Promise<string[]> {
  const rows = await db.txs.where('timestamp_ms').equals(0).limit(limit).toArray();
  return rows.map((r) => r.tx_id);
}

export async function pendingCount(): Promise<number> {
  return db.txs.where('timestamp_ms').equals(0).count();
}

export async function pendingTxRows(limit: number): Promise<TxRow[]> {
  return db.txs.where('timestamp_ms').equals(0).limit(limit).toArray();
}

/** Aplica timestamps estimados em lote (por daa clock). */
export async function applyEstimatedTimestamps(
  updates: Array<{ tx_id: string; timestamp_ms: number; day_brt: string }>,
): Promise<void> {
  if (updates.length === 0) return;
  const ids = updates.map((u) => u.tx_id);
  const rows = await db.txs.bulkGet(ids);
  const merged: TxRow[] = [];
  for (let i = 0; i < updates.length; i++) {
    const row = rows[i];
    if (!row) continue;
    merged.push({
      ...row,
      timestamp_ms: updates[i].timestamp_ms,
      day_brt: updates[i].day_brt,
    });
  }
  if (merged.length > 0) await db.txs.bulkPut(merged);
}

export async function applyTxDetail(
  txId: string,
  netSompi: number,
  timestampMs: number,
  dayBrt: string,
): Promise<void> {
  await db.txs.update(txId, {
    net_sompi: netSompi,
    timestamp_ms: timestampMs,
    day_brt: dayBrt,
  });
}

export async function snapshotPrice(
  dayBrt: string,
  priceUsd: number,
  capturedMs: number,
): Promise<void> {
  await db.price_snapshots.put({ day_brt: dayBrt, price_usd: priceUsd, captured_ms: capturedMs });
}

export async function getPriceSnapshot(dayBrt: string): Promise<number | undefined> {
  const row = await db.price_snapshots.get(dayBrt);
  return row?.price_usd;
}

export async function insertPricePoint(capturedMs: number, priceUsd: number): Promise<void> {
  const exists = await db.price_history.where('captured_ms').equals(capturedMs).first();
  if (exists) return;
  await db.price_history.add({ captured_ms: capturedMs, price_usd: priceUsd });
}

export async function getPriceRange(fromMs: number): Promise<PriceRange | null> {
  const rows = await db.price_history.where('captured_ms').aboveOrEqual(fromMs).sortBy('captured_ms');
  if (rows.length === 0) return null;
  let min = rows[0].price_usd;
  let max = rows[0].price_usd;
  for (const r of rows) {
    if (r.price_usd < min) min = r.price_usd;
    if (r.price_usd > max) max = r.price_usd;
  }
  return {
    min,
    max,
    first: rows[0].price_usd,
    last: rows[rows.length - 1].price_usd,
  };
}

export async function prunePriceHistory(retentionHours: number): Promise<void> {
  const cutoff = Date.now() - retentionHours * 3_600_000;
  await db.price_history.where('captured_ms').below(cutoff).delete();
}

export async function dailyReceived(from: string, to: string): Promise<DailyRow[]> {
  const rows = await db.txs
    .where('day_brt')
    .between(from, to, true, true)
    .filter((t) => t.day_brt != null && (t.net_sompi ?? 0) > 0)
    .toArray();

  const byDay = new Map<string, { received_sompi: number; tx_count: number }>();
  for (const t of rows) {
    const day = t.day_brt!;
    const cur = byDay.get(day) ?? { received_sompi: 0, tx_count: 0 };
    cur.received_sompi += t.net_sompi ?? 0;
    cur.tx_count += 1;
    byDay.set(day, cur);
  }

  return [...byDay.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .filter((r) => r.received_sompi > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
}

export async function firstReceivedDay(): Promise<string | undefined> {
  const rows = await db.txs
    .orderBy('day_brt')
    .filter((t) => t.day_brt != null && (t.net_sompi ?? 0) > 0)
    .limit(1)
    .toArray();
  return rows[0]?.day_brt ?? undefined;
}

export async function receivedOnDay(
  day: string,
): Promise<{ received_sompi: number; tx_count: number }> {
  const rows = await db.txs.where('day_brt').equals(day).toArray();
  let received_sompi = 0;
  let tx_count = 0;
  for (const t of rows) {
    if ((t.net_sompi ?? 0) > 0) {
      received_sompi += t.net_sompi ?? 0;
      tx_count += 1;
    }
  }
  return { received_sompi, tx_count };
}

const ADDRESS_RE = /^keryx:[a-z0-9]{20,120}$/;

export function normalizeAddress(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidAddressFormat(addr: string): boolean {
  return ADDRESS_RE.test(normalizeAddress(addr));
}

export async function getActiveAddress(): Promise<string | null> {
  return (await getMeta('active_address')) ?? null;
}

export async function setActiveAddress(addr: string): Promise<void> {
  await setMeta('active_address', normalizeAddress(addr));
}
