import Dexie, { type Table } from 'dexie';

export interface RawTx {
  tx_id: string;
  block_hash: string;
  daa_score: number;
}

export interface TxRow extends RawTx {
  net_sompi?: number | null;
  timestamp_ms?: number | null;
  day_brt?: string | null;
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

export async function insertTxIfNew(tx: RawTx): Promise<boolean> {
  const existing = await db.txs.get(tx.tx_id);
  if (existing) return false;
  await db.txs.add({
    tx_id: tx.tx_id,
    block_hash: tx.block_hash,
    daa_score: tx.daa_score,
    net_sompi: null,
    timestamp_ms: null,
    day_brt: null,
  });
  return true;
}

export async function txCount(): Promise<number> {
  return db.txs.count();
}

export async function wipeTxs(): Promise<void> {
  await db.txs.clear();
}

export async function pendingTxIds(limit: number): Promise<string[]> {
  const rows = await db.txs.filter((t) => t.timestamp_ms == null).limit(limit).toArray();
  return rows.map((r) => r.tx_id);
}

export async function pendingCount(): Promise<number> {
  return db.txs.filter((t) => t.timestamp_ms == null).count();
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
