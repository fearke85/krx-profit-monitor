import Dexie, { type Table } from 'dexie';
import { todayBrt } from './day';

export interface TxRow {
  tx_id: string;
  block_hash: string;
  daa_score: number;
  net_sompi: number | null;
  /** 0 = pendente de timestamp; >0 = resolvido. */
  timestamp_ms: number;
  day_brt: string | null;
  /**
   * Aceitação pelo consenso: 1 = aceita (conta como produção),
   * 0 = pendente de verificação (listada mas ainda não creditou saldo),
   * -1 = rejeitada (nunca aceita — não conta).
   */
  accepted: number;
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

/** Previsão diária da calculadora (última previsão registrada no dia). */
export interface CalcSnapshotRow {
  day_brt: string;
  predicted_krx: number;
  price_usd: number;
  captured_ms: number;
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
  calc_snapshots!: Table<CalcSnapshotRow, string>;

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
    // v3: snapshots diários de previsão da calculadora (previsto × realizado).
    this.version(3).stores({
      txs: 'tx_id, day_brt, timestamp_ms, daa_score',
      price_snapshots: 'day_brt',
      price_history: '++id, captured_ms',
      meta: 'key',
      calc_snapshots: 'day_brt',
    });
    // v4: flag de aceitação pelo consenso. Rows históricas assumem aceitas;
    // receives de hoje voltam para "pendente" e são reverificados no próximo ciclo.
    this.version(4)
      .stores({
        txs: 'tx_id, day_brt, timestamp_ms, daa_score, accepted',
        price_snapshots: 'day_brt',
        price_history: '++id, captured_ms',
        meta: 'key',
        calc_snapshots: 'day_brt',
      })
      .upgrade(async (tx) => {
        const today = todayBrt();
        await tx
          .table('txs')
          .toCollection()
          .modify((row: TxRow) => {
            row.accepted = row.day_brt === today && (row.net_sompi ?? 0) > 0 ? 0 : 1;
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

/**
 * Insere página inteira de uma vez, sem leitura prévia de dedupe:
 * ids já existentes falham individualmente no bulkAdd (BulkError) e são
 * ignorados — Dexie mantém as inserções que deram certo quando o erro é
 * capturado. Retorna quantas eram novas.
 */
export async function bulkAddTxRows(rows: TxRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  try {
    await db.txs.bulkAdd(rows);
    return rows.length;
  } catch (err) {
    if (err instanceof Dexie.BulkError) return rows.length - err.failures.length;
    throw err;
  }
}

/** Regrava rows completas (usado para carimbar timestamps em lote). */
export async function bulkPutTxRows(rows: TxRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.txs.bulkPut(rows);
}

export async function txCount(): Promise<number> {
  return db.txs.count();
}

export async function wipeTxs(): Promise<void> {
  await db.txs.clear();
}

export async function pendingCount(): Promise<number> {
  return db.txs.where('timestamp_ms').equals(0).count();
}

export async function pendingTxRows(limit: number): Promise<TxRow[]> {
  return db.txs.where('timestamp_ms').equals(0).limit(limit).toArray();
}

/** Txs aguardando verificação de aceitação pelo consenso. */
export async function unverifiedTxRows(limit: number): Promise<TxRow[]> {
  return db.txs.where('accepted').equals(0).limit(limit).toArray();
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

export async function putCalcSnapshot(row: CalcSnapshotRow): Promise<void> {
  await db.calc_snapshots.put(row);
}

export async function getCalcSnapshot(dayBrt: string): Promise<CalcSnapshotRow | undefined> {
  return db.calc_snapshots.get(dayBrt);
}

export async function getCalcSnapshots(from: string, to: string): Promise<CalcSnapshotRow[]> {
  return db.calc_snapshots.where('day_brt').between(from, to, true, true).sortBy('day_brt');
}

export async function dailyReceived(from: string, to: string): Promise<DailyRow[]> {
  const rows = await db.txs
    .where('day_brt')
    .between(from, to, true, true)
    .filter((t) => t.day_brt != null && (t.net_sompi ?? 0) > 0 && (t.accepted ?? 1) === 1)
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
    .filter((t) => t.day_brt != null && (t.net_sompi ?? 0) > 0 && (t.accepted ?? 1) === 1)
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
    if ((t.net_sompi ?? 0) > 0 && (t.accepted ?? 1) === 1) {
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
