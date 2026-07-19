/**
 * Motor de sincronização — sem dependência de DOM, roda tanto num Web Worker
 * (caminho normal, via sync.worker.ts) quanto na main thread (fallback).
 *
 * Otimizações vs. versão anterior:
 * - timestamps carimbados NA inserção (relógio DAA calibrado antes do fan-out)
 *   → 1 escrita por tx, sem segunda passada de leitura+regravação;
 * - contadores de progresso em memória (sem count() no IndexedDB por página/chunk);
 * - checkpoint de retomada do backfill (frontier descendente: fechar a aba no
 *   meio não refaz as páginas já ingeridas);
 * - inserção via bulkAdd com captura de BulkError (sem leitura de dedupe);
 * - relógio DAA refeito a cada ciclo por 1 request (/blocks) + âncoras
 *   históricas persistidas (sem drift, sem re-buscar blocos antigos).
 */

import {
  getAddressTxsPage,
  getBlockTimestampMs,
  getRecentBlocks,
  getTxDetail,
  type ListedTx,
} from './keryx';
import {
  bulkAddTxRows,
  bulkPutTxRows,
  pendingCount,
  pendingTxRows,
  unverifiedTxRows,
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

const PAGE = 100; // máximo aceito pelo servidor (limit é capado em 100)
const PAGE_CONCURRENCY = 6; // teto do browser p/ HTTP/1.1 por host
const CALIBRATE_HISTORICAL = 8;
const TIMESTAMP_CHUNK = 800;
const CHECKPOINT_EVERY = 3; // páginas concluídas entre gravações do checkpoint

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

const status: SyncStatus = {
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

let statusListener: ((s: SyncStatus) => void) | null = null;

/** Quem hospeda o motor (worker ou fachada) recebe um snapshot a cada mudança. */
export function setStatusListener(cb: (s: SyncStatus) => void): void {
  statusListener = cb;
}

function notify(): void {
  statusListener?.({ ...status });
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

/* ---------------- relógio DAA → timestamp ---------------- */

/** Relógio linear: timestamp_ms ≈ intercept + slope * daa_score */
interface DaaClock {
  intercept: number;
  slope: number;
}

interface ClockPoint {
  daa: number;
  ts: number;
}

const CLOCK_META = 'daa_clock_v1';
const CLOCK_POINTS_META = 'daa_clock_points_v1';

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

async function loadClockPoints(): Promise<ClockPoint[]> {
  const raw = await getMeta(CLOCK_POINTS_META);
  if (!raw) return [];
  try {
    const pts = JSON.parse(raw) as ClockPoint[];
    if (Array.isArray(pts)) {
      return pts.filter((p) => Number.isFinite(p?.daa) && Number.isFinite(p?.ts));
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function saveClockPoints(points: ClockPoint[]): Promise<void> {
  await setMeta(CLOCK_POINTS_META, JSON.stringify(points));
}

function fitClock(points: ClockPoint[]): DaaClock | null {
  if (points.length < 2) return null;
  // Mínimos quadrados centrados: com daa ~1e7 e ts ~1.8e12, a forma não
  // centrada (n·Σxy − Σx·Σy) sofre cancelamento catastrófico em float64.
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.daa;
    my += p.ts;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.daa - mx;
    sxx += dx * dx;
    sxy += dx * (p.ts - my);
  }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  // Sanidade: ~1 bloco/s → slope ≈ 1000 ms/daa. Muito fora disso é fit degenerado
  // (ex.: pontos agrupados num intervalo de segundos).
  if (!Number.isFinite(slope) || !Number.isFinite(intercept) || slope < 10 || slope > 60_000) {
    return null;
  }
  return { intercept, slope };
}

function estimateTs(clock: DaaClock, daa: number): number {
  // Nunca 0: timestamp_ms=0 marca "pendente" no schema.
  return Math.max(1, Math.round(clock.intercept + clock.slope * daa));
}

/** Busca poucos blocos históricos espalhados — são eles que fixam a inclinação. */
async function fetchHistoricalPoints(samples: ListedTx[]): Promise<ClockPoint[]> {
  const unique = new Map<string, ListedTx>();
  for (const t of samples) {
    if (!unique.has(t.block_hash)) unique.set(t.block_hash, t);
  }
  const list = [...unique.values()];
  const step = Math.max(1, Math.floor(list.length / CALIBRATE_HISTORICAL));
  const picked: ListedTx[] = [];
  for (let i = 0; i < list.length && picked.length < CALIBRATE_HISTORICAL; i += step) {
    picked.push(list[i]);
  }
  const points: ClockPoint[] = [];
  await mapPool(picked, PAGE_CONCURRENCY, async (t) => {
    try {
      const ts = await getBlockTimestampMs(t.block_hash);
      if (ts > 0) points.push({ daa: t.daa_score, ts });
    } catch (err) {
      console.warn('[clock] block', t.block_hash.slice(0, 10), (err as Error).message);
    }
  });
  return points;
}

/**
 * Relógio sempre fresco: âncoras históricas persistidas (imutáveis; buscadas
 * uma única vez) + blocos recentes de /blocks (1 request) → refit por ciclo.
 * Sem ≥2 âncoras históricas não extrapolamos (blocos recentes cobrem ~2 min,
 * inclinação instável) — nesse caso cai no último relógio salvo.
 */
async function refreshClock(samples: ListedTx[] | null): Promise<DaaClock | null> {
  let hist = await loadClockPoints();
  if (hist.length < 2 && samples && samples.length > 0) {
    hist = await fetchHistoricalPoints(samples);
    if (hist.length >= 2) await saveClockPoints(hist);
  }

  let recent: ClockPoint[] = [];
  try {
    recent = (await getRecentBlocks(100)).map((b) => ({ daa: b.daaScore, ts: b.timestampMs }));
  } catch (err) {
    console.warn('[clock] /blocks', (err as Error).message);
  }

  const clock = hist.length >= 2 ? fitClock([...hist, ...recent]) : null;
  if (clock) {
    await saveClock(clock);
    console.log(
      `[clock] refit com ${hist.length}+${recent.length} pontos · slope=${clock.slope.toFixed(2)} ms/daa`,
    );
    return clock;
  }
  return loadClock();
}

/* ---------------- ingestão ---------------- */

function stampRow(r: TxRow, clock: DaaClock): TxRow {
  const ts = estimateTs(clock, r.daa_score);
  return { ...r, timestamp_ms: ts, day_brt: toBrtDay(ts) };
}

/**
 * Receives mais novos que isso entram como accepted=0 (pendente): a listagem
 * do endereço inclui txs na inclusão em bloco, ANTES da aceitação pelo consenso
 * creditar o saldo. verifyAcceptance() confirma via detalhe da tx.
 */
const FRESH_ACCEPT_WINDOW_MS = 30 * 60_000;
/** Sem aceitação depois disso, a tx é considerada rejeitada (nunca credita). */
const ACCEPT_REJECT_AFTER_MS = 2 * 3_600_000;

/** ListedTx → TxRow, já carimbada quando há relógio (evita a segunda passada). */
function toRows(txs: ListedTx[], clock: DaaClock | null): TxRow[] {
  const now = Date.now();
  return txs.map((t) => {
    const ts = clock ? estimateTs(clock, t.daa_score) : 0;
    // Só receives frescos precisam de verificação; spends não contam produção
    // e histórico antigo já está refletido no saldo há muito tempo.
    const fresh = t.net_sompi > 0 && ts > 0 && now - ts < FRESH_ACCEPT_WINDOW_MS;
    return {
      tx_id: t.tx_id,
      block_hash: t.block_hash,
      daa_score: t.daa_score,
      net_sompi: t.net_sompi,
      timestamp_ms: ts,
      day_brt: ts > 0 ? toBrtDay(ts) : null,
      accepted: fresh ? 0 : 1,
    };
  });
}

/**
 * Verifica aceitação das txs pendentes via /transactions/{id} (poucas por dia —
 * só os receives recentes). Aceita → conta como produção (e ganha o timestamp
 * real do bloco); sem aceitação após 2h → rejeitada, nunca conta.
 */
async function verifyAcceptance(address: string): Promise<void> {
  const rows = await unverifiedTxRows(60);
  if (rows.length === 0) return;
  const updates: TxRow[] = [];
  await mapPool(rows, PAGE_CONCURRENCY, async (r) => {
    try {
      const d = await getTxDetail(address, r.tx_id);
      if (d.isAccepted) {
        const ts = d.timestampMs > 0 ? d.timestampMs : r.timestamp_ms;
        updates.push({
          ...r,
          accepted: 1,
          timestamp_ms: ts,
          day_brt: ts > 0 ? toBrtDay(ts) : r.day_brt,
        });
      } else if (r.timestamp_ms > 0 && Date.now() - r.timestamp_ms > ACCEPT_REJECT_AFTER_MS) {
        updates.push({ ...r, accepted: -1 });
      }
    } catch (err) {
      console.warn('[accept]', r.tx_id.slice(0, 10), (err as Error).message);
    }
  });
  await bulkPutTxRows(updates);
  if (updates.length > 0) notify();
}

async function stampPendingWithClock(clock: DaaClock): Promise<number> {
  let stamped = 0;
  for (;;) {
    const rows = await pendingTxRows(TIMESTAMP_CHUNK);
    if (rows.length === 0) break;
    await bulkPutTxRows(rows.map((r) => stampRow(r, clock)));
    stamped += rows.length;
    status.pendingTimestamps = Math.max(0, status.pendingTimestamps - rows.length);
    notify();
  }
  return stamped;
}

/* ---------------- backfill com checkpoint ---------------- */

// frontier F (na numeração de `total` salvo): offsets ≥ F já foram ingeridos.
const FRONTIER_META = 'backfill_frontier_v1';
const FRONTIER_TOTAL_META = 'backfill_total_v1';

async function backfill(address: string): Promise<void> {
  status.phase = 'backfill';
  notify();

  // Página 0 sempre fresca: txs mais recentes + total atual.
  const first = await getAddressTxsPage(address, PAGE, 0);
  const total = first.totalTxCount;
  status.totalTxCount = total;
  notify();

  // Amostras espalhadas (início/meio/fim) para as âncoras do relógio.
  const sampleBag: ListedTx[] = [...first.txs];
  const midOff = Math.floor(total / 2 / PAGE) * PAGE;
  const lastOff = Math.max(0, Math.floor((total - 1) / PAGE) * PAGE);
  for (const off of new Set([midOff, lastOff])) {
    if (off > 0 && off < total) {
      try {
        sampleBag.push(...(await getAddressTxsPage(address, PAGE, off)).txs);
      } catch (err) {
        console.warn('[backfill] sample page', off, (err as Error).message);
      }
    }
  }

  // Relógio ANTES do fan-out: as páginas entram já carimbadas (1 escrita/tx).
  const clock = await refreshClock(sampleBag);

  const insertedFirst = await bulkAddTxRows(toRows(first.txs, clock));
  status.ingestedTxs += insertedFirst;
  if (!clock) status.pendingTimestamps += insertedFirst;
  notify();

  // Pendências de execuções antigas interrompidas: resolve já.
  if (clock && status.pendingTimestamps > 0) {
    await stampPendingWithClock(clock);
  }

  // Retomada: txs novas empurram offsets antigos para baixo na listagem
  // (offset 0 = mais recente), então o frontier salvo desloca por Δtotal.
  let frontier = total;
  const savedF = Number((await getMeta(FRONTIER_META)) || NaN);
  const savedTotal = Number((await getMeta(FRONTIER_TOTAL_META)) || NaN);
  if (Number.isFinite(savedF) && Number.isFinite(savedTotal)) {
    frontier = Math.min(total, Math.max(PAGE, savedF + (total - savedTotal)));
  }

  // Do offset mais alto (histórico mais antigo) para baixo: o frontier só
  // avança contíguo, então interromper no meio nunca deixa buraco atrás dele.
  const offsets: number[] = [];
  for (let off = PAGE; off < frontier; off += PAGE) offsets.push(off);
  offsets.reverse();

  let nextIdx = 0;
  let done = 0;
  const completed = new Set<number>();
  await mapPool(offsets, PAGE_CONCURRENCY, async (offset) => {
    const page = await getAddressTxsPage(address, PAGE, offset);
    const inserted = await bulkAddTxRows(toRows(page.txs, clock));
    status.ingestedTxs += inserted;
    if (!clock) status.pendingTimestamps += inserted;

    completed.add(offset);
    while (nextIdx < offsets.length && completed.has(offsets[nextIdx])) {
      frontier = offsets[nextIdx];
      nextIdx += 1;
    }
    done += 1;
    if (done % CHECKPOINT_EVERY === 0 || done === offsets.length) {
      await setMeta(FRONTIER_META, String(frontier));
      await setMeta(FRONTIER_TOTAL_META, String(total));
      notify();
    }
  });

  // Sobras sem timestamp (relógio indisponível durante o fan-out).
  const pending = await pendingCount();
  status.pendingTimestamps = pending;
  if (pending > 0) {
    const late = clock ?? (await refreshClock(sampleBag));
    if (late) {
      status.phase = 'details';
      notify();
      await stampPendingWithClock(late);
    } else {
      console.warn('[clock] falha na calibração — dias ficam pendentes até o próximo ciclo');
    }
  }

  await setMeta('backfill_done', '1');
  await setMeta(FRONTIER_META, '');
  await setMeta(FRONTIER_TOTAL_META, '');
  status.backfillDone = true;
  notify();
}

async function ingestRecent(address: string): Promise<void> {
  status.phase = 'incremental';
  notify();

  // Refit barato (1 request) — txs novas entram carimbadas sem drift do relógio.
  const clock = await refreshClock(null);

  let offset = 0;
  const newTxs: ListedTx[] = [];
  for (let guard = 0; guard < 20; guard++) {
    const page = await getAddressTxsPage(address, PAGE, offset);
    status.totalTxCount = page.totalTxCount;
    if (page.txs.length === 0) break;
    const inserted = await bulkAddTxRows(toRows(page.txs, clock));
    if (inserted > 0) {
      newTxs.push(...page.txs);
      status.ingestedTxs += inserted;
      if (!clock) status.pendingTimestamps += inserted;
    }
    offset += page.txs.length;
    if (inserted === 0) break;
    if (offset >= page.totalTxCount) break;
  }
  notify();

  // Sem âncoras ainda (instalações antigas): constrói com blocos frescos.
  if (newTxs.length > 0 && (await loadClockPoints()).length < 2) {
    await refreshClock(newTxs);
  }

  const pending = await pendingCount();
  status.pendingTimestamps = pending;
  if (pending === 0) return;

  status.phase = 'details';
  notify();
  const late = clock ?? (await refreshClock(newTxs.length > 0 ? newTxs : null));
  if (late) await stampPendingWithClock(late);
  status.pendingTimestamps = await pendingCount();
  notify();
}

async function reconcileAddress(address: string): Promise<void> {
  const synced = await getMeta('synced_address');
  if (synced !== address) {
    await wipeTxs();
    await setMeta('synced_address', address);
    await setMeta('backfill_done', '0');
    await setMeta(FRONTIER_META, '');
    await setMeta(FRONTIER_TOTAL_META, '');
    // O relógio DAA é da rede, não da wallet — âncoras/clock continuam válidos.
    status.backfillDone = false;
    status.ingestedTxs = 0;
    status.pendingTimestamps = 0;
    status.totalTxCount = 0;
    notify();
  }
}

export async function runCycle(): Promise<void> {
  if (status.running) return;
  status.running = true;
  status.lastError = null;
  notify();
  try {
    await capturePrice();

    const address = await getActiveAddress();
    status.address = address;
    if (!address) return;

    await reconcileAddress(address);
    status.backfillDone = (await getMeta('backfill_done')) === '1';
    // Contagens reais uma vez por ciclo; durante o ciclo, contadores em memória.
    status.ingestedTxs = await txCount();
    status.pendingTimestamps = await pendingCount();
    notify();

    if (!status.backfillDone) {
      await backfill(address);
    } else {
      await ingestRecent(address);
      // Se ainda há pendentes (calibração falhou antes), tenta com eles mesmos.
      if (status.pendingTimestamps > 0) {
        const sample: ListedTx[] = (await pendingTxRows(64)).map((r: TxRow) => ({
          tx_id: r.tx_id,
          block_hash: r.block_hash,
          daa_score: r.daa_score,
          net_sompi: r.net_sompi ?? 0,
        }));
        const clock = await refreshClock(sample);
        if (clock) await stampPendingWithClock(clock);
      }
    }
    // Confirma aceitação dos receives recentes (o que realmente creditou saldo).
    await verifyAcceptance(address);
    status.lastSyncMs = Date.now();
  } catch (err) {
    status.lastError = (err as Error).message;
    console.error('[sync]', status.lastError);
  } finally {
    status.phase = 'idle';
    status.running = false;
    // Acerto final dos contadores com o banco.
    status.pendingTimestamps = await pendingCount().catch(() => status.pendingTimestamps);
    status.ingestedTxs = await txCount().catch(() => status.ingestedTxs);
    notify();
  }
}
