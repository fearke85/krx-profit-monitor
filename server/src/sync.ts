import { config } from './config.js';
import {
  getAddressTxsPage,
  getTxDetail,
} from './keryx.js';
import { getPriceUsd } from './nonkyc.js';
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
} from './db.js';
import { getActiveAddress } from './address.js';
import { toBrtDay, todayBrt } from './day.js';

const PAGE = 100; // txs por página (a API limita o page size a 100)
const DETAIL_CONCURRENCY = 6; // requisições de detalhe de tx em paralelo

export const syncStatus = {
  address: getActiveAddress() as string | null,
  backfillDone: getMeta('backfill_done') === '1',
  ingestedTxs: txCount(),
  pendingTimestamps: pendingCount(),
  lastSyncMs: 0,
  totalTxCount: 0,
  running: false,
  phase: 'idle' as 'idle' | 'backfill' | 'incremental' | 'details',
};

/** Executa fn sobre items com no máximo `limit` em paralelo. */
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
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** Backfill completo: pagina todo o histórico do endereço (uma vez). */
async function backfill(address: string): Promise<void> {
  if (getMeta('backfill_done') === '1') return;
  syncStatus.phase = 'backfill';
  let offset = 0;
  let inserted = 0;
  for (;;) {
    const page = await getAddressTxsPage(address, PAGE, offset);
    syncStatus.totalTxCount = page.totalTxCount;
    if (page.txs.length === 0) break;
    for (const tx of page.txs) {
      if (insertTxIfNew(tx)) inserted++;
    }
    offset += page.txs.length;
    syncStatus.ingestedTxs = txCount();
    console.log(
      `[backfill] ${offset}/${page.totalTxCount} txs processadas (novas: ${inserted})`,
    );
    if (offset >= page.totalTxCount) break;
  }
  setMeta('backfill_done', '1');
  syncStatus.backfillDone = true;
  console.log(`[backfill] concluído. Total de txs: ${txCount()}`);
}

/** Ingestão incremental: lê do topo até encontrar uma página só com txs já conhecidas. */
async function ingestRecent(address: string): Promise<void> {
  syncStatus.phase = 'incremental';
  let offset = 0;
  for (let guard = 0; guard < 20; guard++) {
    const page = await getAddressTxsPage(address, PAGE, offset);
    syncStatus.totalTxCount = page.totalTxCount;
    if (page.txs.length === 0) break;
    let newInPage = 0;
    for (const tx of page.txs) {
      if (insertTxIfNew(tx)) newInPage++;
    }
    offset += page.txs.length;
    if (newInPage === 0) break; // chegamos em território já conhecido
    if (offset >= page.totalTxCount) break;
  }
  syncStatus.ingestedTxs = txCount();
}

/** Resolve o detalhe (líquido + horário) das txs pendentes, via /transactions/{id}. */
async function resolveTxDetails(address: string, maxTxs = 20000): Promise<void> {
  syncStatus.phase = 'details';
  let resolved = 0;
  for (;;) {
    const ids = pendingTxIds(Math.min(DETAIL_CONCURRENCY * 8, maxTxs - resolved));
    if (ids.length === 0) break;
    await mapPool(ids, DETAIL_CONCURRENCY, async (txId) => {
      try {
        const d = await getTxDetail(address, txId);
        applyTxDetail(txId, d.netSompi, d.timestampMs, toBrtDay(d.timestampMs));
      } catch (err) {
        console.warn(`[details] falha na tx ${txId}:`, (err as Error).message);
      }
    });
    resolved += ids.length;
    syncStatus.pendingTimestamps = pendingCount();
    console.log(
      `[details] resolvidas ~${resolved} txs, pendentes: ${syncStatus.pendingTimestamps}`,
    );
    if (resolved >= maxTxs) break;
  }
}

/** Captura o preço atual e congela como snapshot do dia corrente (BRT). */
async function capturePrice(): Promise<void> {
  try {
    const price = await getPriceUsd();
    if (price > 0) snapshotPrice(todayBrt(), price, Date.now());
  } catch (err) {
    console.warn('[price] falha ao buscar preço:', (err as Error).message);
  }
}

/**
 * Se o endereço ativo difere do que está representado no banco, zera os dados para
 * re-sincronizar a nova wallet (evita misturar histórico de wallets diferentes).
 */
function reconcileAddress(address: string): void {
  const synced = getMeta('synced_address');
  if (synced !== address) {
    console.log(`[sync] wallet alterada (${synced ?? 'nenhuma'} -> ${address}); recarregando dados.`);
    wipeTxs();
    setMeta('synced_address', address);
    setMeta('backfill_done', '0');
    syncStatus.backfillDone = false;
    syncStatus.ingestedTxs = 0;
    syncStatus.pendingTimestamps = 0;
    syncStatus.totalTxCount = 0;
  }
}

/** Um ciclo completo de sincronização. */
async function runCycle(): Promise<void> {
  if (syncStatus.running) return;
  syncStatus.running = true;
  try {
    // Preço primeiro: barato, independe da wallet e deixa o dashboard útil já no início.
    await capturePrice();

    const address = getActiveAddress();
    syncStatus.address = address;
    if (!address) {
      // Sem wallet configurada: nada a sincronizar (a UI mostra o formulário).
      return;
    }

    reconcileAddress(address);
    syncStatus.backfillDone = getMeta('backfill_done') === '1';

    if (!syncStatus.backfillDone) {
      await backfill(address);
    } else {
      await ingestRecent(address);
    }
    await resolveTxDetails(address);
    syncStatus.lastSyncMs = Date.now();
  } catch (err) {
    console.error('[sync] erro no ciclo:', (err as Error).message);
  } finally {
    syncStatus.phase = 'idle';
    syncStatus.running = false;
  }
}

/** Dispara um ciclo de sincronização imediatamente (sem esperar o intervalo). */
export function triggerSync(): void {
  void runCycle();
}

/** Inicia o loop de sincronização em background. */
export function startSync(): void {
  void runCycle();
  setInterval(() => void runCycle(), config.pollIntervalMs);
}
