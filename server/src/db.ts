import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, 'krx.db');

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS txs (
    tx_id        TEXT PRIMARY KEY,
    block_hash   TEXT NOT NULL,
    daa_score    INTEGER NOT NULL,
    net_sompi    INTEGER,            -- saídas_minhas - entradas_minhas (NULL até resolver detalhe)
    timestamp_ms INTEGER,            -- NULL até resolver detalhe
    day_brt      TEXT                -- "YYYY-MM-DD" no fuso de Brasília
  );
  CREATE INDEX IF NOT EXISTS idx_txs_day ON txs(day_brt);
  CREATE INDEX IF NOT EXISTS idx_txs_pending ON txs(timestamp_ms) WHERE timestamp_ms IS NULL;

  CREATE TABLE IF NOT EXISTS price_snapshots (
    day_brt     TEXT PRIMARY KEY,
    price_usd   REAL NOT NULL,
    captured_ms INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---- meta helpers ----
const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMetaStmt = db.prepare(
  'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);

export function getMeta(key: string): string | undefined {
  const row = getMetaStmt.get(key) as { value: string } | undefined;
  return row?.value;
}
export function setMeta(key: string, value: string): void {
  setMetaStmt.run(key, value);
}

// ---- tx helpers ----
const upsertTxStmt = db.prepare(`
  INSERT INTO txs (tx_id, block_hash, daa_score)
  VALUES (?, ?, ?)
  ON CONFLICT(tx_id) DO NOTHING
`);

export interface RawTx {
  tx_id: string;
  block_hash: string;
  daa_score: number;
}

/** Insere uma tx (sem detalhe ainda) se nova. Retorna true se foi inserida. */
export function insertTxIfNew(tx: RawTx): boolean {
  const res = upsertTxStmt.run(tx.tx_id, tx.block_hash, tx.daa_score);
  return res.changes > 0;
}

export function txCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM txs').get() as { c: number }).c;
}

/** Apaga todas as transações (usado ao trocar de wallet monitorada). */
export function wipeTxs(): void {
  db.exec('DELETE FROM txs');
}

/** Tx ids ainda sem detalhe resolvido (sem net/timestamp). */
export function pendingTxIds(limit: number): string[] {
  const rows = db
    .prepare('SELECT tx_id FROM txs WHERE timestamp_ms IS NULL LIMIT ?')
    .all(limit) as { tx_id: string }[];
  return rows.map((r) => r.tx_id);
}

export function pendingCount(): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM txs WHERE timestamp_ms IS NULL').get() as {
      c: number;
    }
  ).c;
}

// ---- aplicar detalhe da transação (net + timestamp) ----
const applyDetailStmt = db.prepare(
  'UPDATE txs SET net_sompi = ?, timestamp_ms = ?, day_brt = ? WHERE tx_id = ?',
);

export function applyTxDetail(
  txId: string,
  netSompi: number,
  timestampMs: number,
  dayBrt: string,
): void {
  applyDetailStmt.run(netSompi, timestampMs, dayBrt, txId);
}

// ---- price snapshots ----
const upsertPriceStmt = db.prepare(`
  INSERT INTO price_snapshots(day_brt, price_usd, captured_ms)
  VALUES (?, ?, ?)
  ON CONFLICT(day_brt) DO UPDATE SET price_usd = excluded.price_usd, captured_ms = excluded.captured_ms
`);

export function snapshotPrice(dayBrt: string, priceUsd: number, capturedMs: number): void {
  upsertPriceStmt.run(dayBrt, priceUsd, capturedMs);
}

export function getPriceSnapshot(dayBrt: string): number | undefined {
  const row = db
    .prepare('SELECT price_usd FROM price_snapshots WHERE day_brt = ?')
    .get(dayBrt) as { price_usd: number } | undefined;
  return row?.price_usd;
}

// ---- agregação diária ----
// "Recebido" = soma dos NETs positivos (entradas reais). Consolidações de UTXO têm net ~0
// (apenas a taxa, levemente negativo) e portanto não inflam o total.
export interface DailyRow {
  day: string;
  received_sompi: number;
  tx_count: number;
}

export function dailyReceived(from: string, to: string): DailyRow[] {
  return db
    .prepare(
      `SELECT day_brt AS day,
              SUM(CASE WHEN net_sompi > 0 THEN net_sompi ELSE 0 END) AS received_sompi,
              SUM(CASE WHEN net_sompi > 0 THEN 1 ELSE 0 END) AS tx_count
       FROM txs
       WHERE day_brt IS NOT NULL AND day_brt >= ? AND day_brt <= ?
       GROUP BY day_brt
       HAVING received_sompi > 0
       ORDER BY day_brt ASC`,
    )
    .all(from, to) as unknown as DailyRow[];
}

export function receivedOnDay(day: string): { received_sompi: number; tx_count: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN net_sompi > 0 THEN net_sompi ELSE 0 END), 0) AS received_sompi,
              SUM(CASE WHEN net_sompi > 0 THEN 1 ELSE 0 END) AS tx_count
       FROM txs WHERE day_brt = ?`,
    )
    .get(day) as { received_sompi: number; tx_count: number };
  return { received_sompi: row.received_sompi, tx_count: row.tx_count ?? 0 };
}

/** Soma de todos os nets resolvidos (deve reconciliar ~com o saldo on-chain). */
export function netTotalSompi(): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(net_sompi), 0) AS s FROM txs WHERE net_sompi IS NOT NULL')
    .get() as { s: number };
  return row.s;
}
