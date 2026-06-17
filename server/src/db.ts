import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { toBrtDay, todayBrt } from './day.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, 'krx.db');

export const db = new DatabaseSync(dbPath);

// WAL melhora a concorrência leitura/escrita, mas cria um arquivo de shared-memory (-shm)
// via mmap. Bind mounts do Docker Desktop no Windows (gRPC-FUSE/virtiofs) não suportam isso
// e o WAL falha com SQLITE_IOERR_SHMOPEN (errcode 4618). Em locking_mode EXCLUSIVE o SQLite
// mantém o índice do WAL em heap (sem -shm), funcionando em qualquer filesystem. O app é
// single-process, então o lock exclusivo é seguro. Fallback final para journal clássico.
try {
  db.exec('PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL;');
} catch {
  db.exec('PRAGMA journal_mode = DELETE;');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS pool_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_ms    INTEGER NOT NULL,
    hashrate_curr  INTEGER NOT NULL,
    hashrate_avg   INTEGER NOT NULL,
    balance_krx    REAL    NOT NULL,
    immature_krx   REAL    NOT NULL,
    daily_est_krx  REAL    NOT NULL,
    workers_online INTEGER NOT NULL,
    workers_total  INTEGER NOT NULL,
    shares_accepted INTEGER NOT NULL,
    shares_stale    INTEGER NOT NULL,
    paid_krx        REAL   NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pool_snap_ms ON pool_snapshots(captured_ms);

  CREATE TABLE IF NOT EXISTS pool_worker_snaps (
    snapshot_id     INTEGER NOT NULL,
    name            TEXT    NOT NULL,
    is_offline      INTEGER NOT NULL,
    hashrate_curr   INTEGER NOT NULL,
    hashrate_avg    INTEGER NOT NULL,
    shares_accepted INTEGER NOT NULL,
    PRIMARY KEY (snapshot_id, name)
  );

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

  CREATE TABLE IF NOT EXISTS price_history (
    captured_ms INTEGER NOT NULL,
    price_usd   REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_price_history_ms ON price_history(captured_ms);

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Pagamentos da pool: eventos discretos e autoritativos (verdade-fonte dos ganhos).
  -- Imunes a gaps de downtime e a reset do contador cumulativo 'paid'. Dedup por tx.
  CREATE TABLE IF NOT EXISTS pool_payments (
    tx           TEXT PRIMARY KEY,
    timestamp_ms INTEGER NOT NULL,
    amount_krx   REAL    NOT NULL,
    day_brt      TEXT    NOT NULL          -- toBrtDay(timestamp_ms)
  );
  CREATE INDEX IF NOT EXISTS idx_pool_pay_day ON pool_payments(day_brt);

  -- Rollup horário dos gauges (retido para sempre). Agregado a partir dos snapshots raw.
  -- sample_count/expected_count tornam gaps de downtime explícitos (cobertura = sample/expected).
  CREATE TABLE IF NOT EXISTS pool_rollup_hourly (
    bucket_ms          INTEGER PRIMARY KEY,  -- início da hora (UTC ms truncado)
    hashrate_avg_ghs   REAL NOT NULL,        -- média de hashrate_curr na hora (GH/s)
    hashrate_max_ghs   REAL NOT NULL,
    balance_krx_last   REAL NOT NULL,        -- último saldo da hora
    immature_krx_last  REAL NOT NULL,
    paid_krx_last      REAL NOT NULL,
    daily_est_avg_krx  REAL NOT NULL,
    workers_online_avg REAL NOT NULL,
    sample_count       INTEGER NOT NULL,
    expected_count     INTEGER NOT NULL
  );

  -- Rollup diário (BRT, retido para sempre). Derivado do rollup horário (cascata raw->hora->dia).
  CREATE TABLE IF NOT EXISTS pool_rollup_daily (
    day_brt            TEXT PRIMARY KEY,
    hashrate_avg_ghs   REAL NOT NULL,
    hashrate_max_ghs   REAL NOT NULL,
    balance_krx_last   REAL NOT NULL,
    immature_krx_last  REAL NOT NULL,
    paid_krx_last      REAL NOT NULL,
    daily_est_avg_krx  REAL NOT NULL,
    workers_online_avg REAL NOT NULL,
    sample_count       INTEGER NOT NULL,
    expected_count     INTEGER NOT NULL
  );

  -- ===== Pool SOLO local (stratum bridge / Prometheus) =====
  -- Espelham as tabelas pool_* para que o mesmo motor de snapshot/rollup sirva as duas
  -- fontes (externa + solo) sem misturar históricos.
  CREATE TABLE IF NOT EXISTS bridge_snapshots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_ms    INTEGER NOT NULL,
    hashrate_curr  INTEGER NOT NULL,
    hashrate_avg   INTEGER NOT NULL,
    balance_krx    REAL    NOT NULL,
    immature_krx   REAL    NOT NULL,
    daily_est_krx  REAL    NOT NULL,
    workers_online INTEGER NOT NULL,
    workers_total  INTEGER NOT NULL,
    shares_accepted INTEGER NOT NULL,
    shares_stale    INTEGER NOT NULL,
    paid_krx        REAL   NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bridge_snap_ms ON bridge_snapshots(captured_ms);

  CREATE TABLE IF NOT EXISTS bridge_worker_snaps (
    snapshot_id     INTEGER NOT NULL,
    name            TEXT    NOT NULL,
    is_offline      INTEGER NOT NULL,
    hashrate_curr   INTEGER NOT NULL,
    hashrate_avg    INTEGER NOT NULL,
    shares_accepted INTEGER NOT NULL,
    PRIMARY KEY (snapshot_id, name)
  );

  CREATE TABLE IF NOT EXISTS bridge_rollup_hourly (
    bucket_ms          INTEGER PRIMARY KEY,
    hashrate_avg_ghs   REAL NOT NULL,
    hashrate_max_ghs   REAL NOT NULL,
    balance_krx_last   REAL NOT NULL,
    immature_krx_last  REAL NOT NULL,
    paid_krx_last      REAL NOT NULL,
    daily_est_avg_krx  REAL NOT NULL,
    workers_online_avg REAL NOT NULL,
    sample_count       INTEGER NOT NULL,
    expected_count     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bridge_rollup_daily (
    day_brt            TEXT PRIMARY KEY,
    hashrate_avg_ghs   REAL NOT NULL,
    hashrate_max_ghs   REAL NOT NULL,
    balance_krx_last   REAL NOT NULL,
    immature_krx_last  REAL NOT NULL,
    paid_krx_last      REAL NOT NULL,
    daily_est_avg_krx  REAL NOT NULL,
    workers_online_avg REAL NOT NULL,
    sample_count       INTEGER NOT NULL,
    expected_count     INTEGER NOT NULL
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

// ---- price history (high-res) ----

const insertPriceStmt = db.prepare(
  'INSERT OR IGNORE INTO price_history(captured_ms, price_usd) VALUES (?, ?)',
);

export function insertPricePoint(capturedMs: number, priceUsd: number): void {
  insertPriceStmt.run(capturedMs, priceUsd);
}

export interface PriceRange {
  min: number;
  max: number;
  first: number;
  last: number;
}

export function getPriceRange(fromMs: number): PriceRange | null {
  const row = db
    .prepare(
      `SELECT MIN(price_usd) AS min, MAX(price_usd) AS max,
              (SELECT price_usd FROM price_history WHERE captured_ms >= ? ORDER BY captured_ms ASC LIMIT 1) AS first,
              (SELECT price_usd FROM price_history WHERE captured_ms >= ? ORDER BY captured_ms DESC LIMIT 1) AS last
       FROM price_history WHERE captured_ms >= ?`,
    )
    .get(fromMs, fromMs, fromMs) as { min: number | null; max: number | null; first: number | null; last: number | null };
  if (row.min == null) return null;
  const min = row.min;
  const max = row.max as number;
  const first = row.first as number;
  const last = row.last as number;
  return { min, max, first, last };
}

export function prunePriceHistory(retentionHours: number): void {
  const cutoff = Date.now() - retentionHours * 3_600_000;
  db.prepare('DELETE FROM price_history WHERE captured_ms < ?').run(cutoff);
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

// ---- pool snapshots ----

export interface PoolSnapshotRow {
  id: number;
  captured_ms: number;
  hashrate_curr: number;
  hashrate_avg: number;
  balance_krx: number;
  immature_krx: number;
  daily_est_krx: number;
  workers_online: number;
  workers_total: number;
  shares_accepted: number;
  shares_stale: number;
  paid_krx: number;
}

export interface PoolWorkerSnapRow {
  snapshot_id: number;
  name: string;
  is_offline: number;
  hashrate_curr: number;
  hashrate_avg: number;
  shares_accepted: number;
}

const GH = 1e9;

// ---------------------------------------------------------------------------
// Motor de snapshot/histórico/rollup parametrizado por FONTE. Cada fonte (pool
// externa 'pool_*', pool solo 'bridge_*') tem seu próprio conjunto de tabelas e
// cursores de rollup, mas compartilha 100% da lógica. Assim os dois modos
// coexistem sem misturar históricos.
// ---------------------------------------------------------------------------
interface SnapWorker {
  name: string;
  isOffline: boolean;
  hashrateCurrentGhs: number;
  hashrateAverageGhs: number;
  sharesAccepted: number;
}

function makeSnapStore(prefix: 'pool' | 'bridge') {
  const T = {
    snap: `${prefix}_snapshots`,
    worker: `${prefix}_worker_snaps`,
    hourly: `${prefix}_rollup_hourly`,
    daily: `${prefix}_rollup_daily`,
  };
  const hourCursorKey = `${prefix}_rollup_hour_done`;
  const dayCursorKey = `${prefix}_rollup_day_done`;

  const insertSnap = db.prepare(`
    INSERT INTO ${T.snap}
      (captured_ms, hashrate_curr, hashrate_avg, balance_krx, immature_krx,
       daily_est_krx, workers_online, workers_total, shares_accepted, shares_stale, paid_krx)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWorker = db.prepare(`
    INSERT OR REPLACE INTO ${T.worker}
      (snapshot_id, name, is_offline, hashrate_curr, hashrate_avg, shares_accepted)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const upsertHourly = db.prepare(`
    INSERT INTO ${T.hourly}
      (bucket_ms, hashrate_avg_ghs, hashrate_max_ghs, balance_krx_last, immature_krx_last,
       paid_krx_last, daily_est_avg_krx, workers_online_avg, sample_count, expected_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bucket_ms) DO UPDATE SET
      hashrate_avg_ghs = excluded.hashrate_avg_ghs,
      hashrate_max_ghs = excluded.hashrate_max_ghs,
      balance_krx_last = excluded.balance_krx_last,
      immature_krx_last = excluded.immature_krx_last,
      paid_krx_last = excluded.paid_krx_last,
      daily_est_avg_krx = excluded.daily_est_avg_krx,
      workers_online_avg = excluded.workers_online_avg,
      sample_count = excluded.sample_count,
      expected_count = excluded.expected_count
  `);
  const upsertDaily = db.prepare(`
    INSERT INTO ${T.daily}
      (day_brt, hashrate_avg_ghs, hashrate_max_ghs, balance_krx_last, immature_krx_last,
       paid_krx_last, daily_est_avg_krx, workers_online_avg, sample_count, expected_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day_brt) DO UPDATE SET
      hashrate_avg_ghs = excluded.hashrate_avg_ghs,
      hashrate_max_ghs = excluded.hashrate_max_ghs,
      balance_krx_last = excluded.balance_krx_last,
      immature_krx_last = excluded.immature_krx_last,
      paid_krx_last = excluded.paid_krx_last,
      daily_est_avg_krx = excluded.daily_est_avg_krx,
      workers_online_avg = excluded.workers_online_avg,
      sample_count = excluded.sample_count,
      expected_count = excluded.expected_count
  `);

  function save(snap: Omit<PoolSnapshotRow, 'id'>, workers: SnapWorker[]): void {
    const res = insertSnap.run(
      snap.captured_ms,
      Math.round(snap.hashrate_curr),
      Math.round(snap.hashrate_avg),
      snap.balance_krx,
      snap.immature_krx,
      snap.daily_est_krx,
      snap.workers_online,
      snap.workers_total,
      snap.shares_accepted,
      snap.shares_stale,
      snap.paid_krx,
    );
    const snapId = res.lastInsertRowid as number;
    for (const w of workers) {
      insertWorker.run(
        snapId,
        w.name,
        w.isOffline ? 1 : 0,
        Math.round(w.hashrateCurrentGhs * GH),
        Math.round(w.hashrateAverageGhs * GH),
        w.sharesAccepted,
      );
    }
  }

  function history(fromMs: number): { snapshots: PoolSnapshotRow[]; workerSnaps: PoolWorkerSnapRow[] } {
    const snapshots = db
      .prepare(`SELECT * FROM ${T.snap} WHERE captured_ms >= ? ORDER BY captured_ms ASC`)
      .all(fromMs) as unknown as PoolSnapshotRow[];
    if (snapshots.length === 0) return { snapshots: [], workerSnaps: [] };
    const ids = snapshots.map((s) => s.id);
    const placeholders = ids.map(() => '?').join(',');
    const workerSnaps = db
      .prepare(`SELECT * FROM ${T.worker} WHERE snapshot_id IN (${placeholders}) ORDER BY snapshot_id ASC`)
      .all(...ids) as unknown as PoolWorkerSnapRow[];
    return { snapshots, workerSnaps };
  }

  function prune(days: number): void {
    const ageCutoff = Date.now() - days * 86_400_000;
    const rolledCursor = Number(getMeta(hourCursorKey) ?? 0);
    const cutoff = Math.min(ageCutoff, rolledCursor);
    const res = db.prepare(`DELETE FROM ${T.snap} WHERE captured_ms < ?`).run(cutoff);
    if (res.changes > 0) {
      const ids = db.prepare(`SELECT id FROM ${T.snap}`).all() as { id: number }[];
      const live = new Set(ids.map((r) => r.id));
      const orphan = (
        db.prepare(`SELECT DISTINCT snapshot_id FROM ${T.worker}`).all() as { snapshot_id: number }[]
      ).filter((r) => !live.has(r.snapshot_id));
      if (orphan.length > 0) {
        const del = db.prepare(`DELETE FROM ${T.worker} WHERE snapshot_id = ?`);
        for (const o of orphan) del.run(o.snapshot_id);
      }
    }
  }

  function rollupHourly(): void {
    const cursor = Number(getMeta(hourCursorKey) ?? 0);
    const nowHourStart = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    if (nowHourStart <= cursor) return;

    const rows = db
      .prepare(
        `SELECT captured_ms, hashrate_curr, balance_krx, immature_krx, paid_krx, daily_est_krx, workers_online
         FROM ${T.snap} WHERE captured_ms >= ? AND captured_ms < ? ORDER BY captured_ms ASC`,
      )
      .all(cursor, nowHourStart) as unknown as RawForRollup[];

    const buckets = new Map<number, RawForRollup[]>();
    for (const r of rows) {
      const b = Math.floor(r.captured_ms / HOUR_MS) * HOUR_MS;
      (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(r);
    }

    const expected = Math.round(HOUR_MS / SAMPLE_INTERVAL_MS);
    for (const [bucket, list] of buckets) {
      const agg = aggregate(list, expected);
      upsertHourly.run(
        bucket, agg.hashrate_avg_ghs, agg.hashrate_max_ghs, agg.balance_krx_last,
        agg.immature_krx_last, agg.paid_krx_last, agg.daily_est_avg_krx,
        agg.workers_online_avg, agg.sample_count, agg.expected_count,
      );
    }
    setMeta(hourCursorKey, String(nowHourStart));
  }

  function rollupDaily(): void {
    const today = todayBrt();
    const cursorDay = getMeta(dayCursorKey) ?? '';
    const hourly = db
      .prepare(`SELECT * FROM ${T.hourly} ORDER BY bucket_ms ASC`)
      .all() as unknown as Array<PoolRollupRow>;
    if (hourly.length === 0) return;

    const byDay = new Map<string, PoolRollupRow[]>();
    for (const h of hourly) {
      const day = toBrtDay(h.bucket_ms);
      if (day >= today) continue;
      if (cursorDay && day <= cursorDay) continue;
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(h);
    }

    let maxDay = cursorDay;
    const expectedPerDay = Math.round((24 * HOUR_MS) / SAMPLE_INTERVAL_MS);
    for (const [day, hours] of byDay) {
      let sampleTotal = 0, hrWeighted = 0, hrMax = 0, estWeighted = 0, workersWeighted = 0;
      let last = hours[0];
      for (const h of hours) {
        sampleTotal += h.sample_count;
        hrWeighted += h.hashrate_avg_ghs * h.sample_count;
        hrMax = Math.max(hrMax, h.hashrate_max_ghs);
        estWeighted += h.daily_est_avg_krx * h.sample_count;
        workersWeighted += h.workers_online_avg * h.sample_count;
        if (h.bucket_ms >= last.bucket_ms) last = h;
      }
      const denom = sampleTotal || 1;
      upsertDaily.run(
        day, hrWeighted / denom, hrMax, last.balance_krx_last, last.immature_krx_last,
        last.paid_krx_last, estWeighted / denom, workersWeighted / denom, sampleTotal, expectedPerDay,
      );
      if (day > maxDay) maxDay = day;
    }
    if (maxDay && maxDay !== cursorDay) setMeta(dayCursorKey, maxDay);
  }

  function getHourly(fromMs: number): PoolRollupRow[] {
    return db
      .prepare(`SELECT * FROM ${T.hourly} WHERE bucket_ms >= ? ORDER BY bucket_ms ASC`)
      .all(fromMs) as unknown as PoolRollupRow[];
  }

  function getDaily(fromDay: string): PoolRollupDailyRow[] {
    return db
      .prepare(`SELECT * FROM ${T.daily} WHERE day_brt >= ? ORDER BY day_brt ASC`)
      .all(fromDay) as unknown as PoolRollupDailyRow[];
  }

  function wipe(): void {
    db.exec(`
      DELETE FROM ${T.snap};
      DELETE FROM ${T.worker};
      DELETE FROM ${T.hourly};
      DELETE FROM ${T.daily};
    `);
    db.prepare('DELETE FROM meta WHERE key IN (?, ?)').run(hourCursorKey, dayCursorKey);
  }

  return {
    save, history, prune,
    rollup: () => { rollupHourly(); rollupDaily(); },
    getHourly, getDaily, wipe,
  };
}

const poolStore = makeSnapStore('pool');
const bridgeStore = makeSnapStore('bridge');

// ---- API da pool externa (baikalmine) ----
export const savePoolSnapshot = poolStore.save;
export const getPoolHistory = poolStore.history;
export const prunePoolSnapshots = poolStore.prune;

// ---- API da pool solo (bridge) ----
export const saveBridgeSnapshot = bridgeStore.save;
export const getBridgeHistory = bridgeStore.history;
export const pruneBridgeSnapshots = bridgeStore.prune;
export const rollupBridgeHistory = bridgeStore.rollup;
export const getBridgeRollupHourly = bridgeStore.getHourly;
export const getBridgeRollupDaily = bridgeStore.getDaily;
export const wipeBridgeData = bridgeStore.wipe;

// ---- pagamentos da pool (eventos autoritativos) ----

export interface PoolPaymentInput {
  tx: string;
  timestampMs: number;
  amountKrx: number;
}

const insertPaymentStmt = db.prepare(`
  INSERT INTO pool_payments (tx, timestamp_ms, amount_krx, day_brt)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(tx) DO NOTHING
`);

/** Ingere pagamentos (dedup por tx). Retorna quantos eram novos. */
export function insertPoolPayments(payments: PoolPaymentInput[]): number {
  let inserted = 0;
  for (const p of payments) {
    if (!p.tx) continue;
    const res = insertPaymentStmt.run(p.tx, p.timestampMs, p.amountKrx, toBrtDay(p.timestampMs));
    if (res.changes > 0) inserted++;
  }
  return inserted;
}

export interface PoolPaymentRow {
  tx: string;
  timestamp_ms: number;
  amount_krx: number;
  day_brt: string;
}

export function getPoolPayments(limit = 100): PoolPaymentRow[] {
  return db
    .prepare('SELECT * FROM pool_payments ORDER BY timestamp_ms DESC LIMIT ?')
    .all(limit) as unknown as PoolPaymentRow[];
}

export interface PoolPaymentDailyRow {
  day: string;
  paid_krx: number;
  payment_count: number;
}

export function poolPaymentsDaily(from: string, to: string): PoolPaymentDailyRow[] {
  return db
    .prepare(
      `SELECT day_brt AS day, SUM(amount_krx) AS paid_krx, COUNT(*) AS payment_count
       FROM pool_payments
       WHERE day_brt >= ? AND day_brt <= ?
       GROUP BY day_brt
       ORDER BY day_brt ASC`,
    )
    .all(from, to) as unknown as PoolPaymentDailyRow[];
}

export function poolPaymentsTotalKrx(): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_krx), 0) AS s FROM pool_payments')
    .get() as { s: number };
  return row.s;
}

// ---- rollups (downsampling para retenção indefinida) ----

const HOUR_MS = 3_600_000;
const SAMPLE_INTERVAL_MS = 15_000; // intervalo de captura (poolSync)

export interface PoolRollupRow {
  bucket_ms: number; // para hourly; daily usa day_brt mapeado em ms na API
  hashrate_avg_ghs: number;
  hashrate_max_ghs: number;
  balance_krx_last: number;
  immature_krx_last: number;
  paid_krx_last: number;
  daily_est_avg_krx: number;
  workers_online_avg: number;
  sample_count: number;
  expected_count: number;
}

export interface PoolRollupDailyRow extends Omit<PoolRollupRow, 'bucket_ms'> {
  day_brt: string;
}

interface RawForRollup {
  captured_ms: number;
  hashrate_curr: number;
  balance_krx: number;
  immature_krx: number;
  paid_krx: number;
  daily_est_krx: number;
  workers_online: number;
}

const GH_R = 1e9;

function aggregate(list: RawForRollup[], expected: number): PoolRollupRow {
  let hrSum = 0;
  let hrMax = 0;
  let estSum = 0;
  let workersSum = 0;
  let last = list[0];
  for (const r of list) {
    hrSum += r.hashrate_curr;
    hrMax = Math.max(hrMax, r.hashrate_curr);
    estSum += r.daily_est_krx;
    workersSum += r.workers_online;
    if (r.captured_ms >= last.captured_ms) last = r;
  }
  const n = list.length || 1;
  return {
    bucket_ms: 0,
    hashrate_avg_ghs: hrSum / n / GH_R,
    hashrate_max_ghs: hrMax / GH_R,
    balance_krx_last: last.balance_krx,
    immature_krx_last: last.immature_krx,
    paid_krx_last: last.paid_krx,
    daily_est_avg_krx: estSum / n,
    workers_online_avg: workersSum / n,
    sample_count: list.length,
    expected_count: expected,
  };
}

export const rollupPoolHistory = poolStore.rollup;
export const getPoolRollupHourly = poolStore.getHourly;
export const getPoolRollupDaily = poolStore.getDaily;

/** Zera todos os dados da pool externa + pagamentos (usado ao trocar de wallet). */
export function wipePoolData(): void {
  poolStore.wipe();
  db.exec('DELETE FROM pool_payments;');
}
