import { getActiveAddress } from './address.js';
import { getPoolData } from './pool.js';
import {
  savePoolSnapshot,
  prunePoolSnapshots,
  insertPoolPayments,
  rollupPoolHistory,
  insertPricePoint,
  prunePriceHistory,
} from './db.js';
import { getCachedPrice } from './nonkyc.js';

const POOL_INTERVAL_MS = 3_000;
const RETENTION_DAYS = 14;
const ROLLUP_EVERY_CYCLES = 20;
const PRICE_LOG_INTERVAL_MS = 60_000;
const PRICE_RETENTION_HOURS = 72;

let cycle = 0;
let lastPriceLogMs = 0;

async function capturePoolSnapshot(): Promise<void> {
  const address = getActiveAddress();
  if (!address) return;

  try {
    // force: ignora o cache de 30s do getPoolData para garantir amostra fresca.
    const data = await getPoolData(address, { force: true });

    const now = Date.now();
    savePoolSnapshot(
      {
        captured_ms: now,
        hashrate_curr: Math.round(data.hashrateCurrentGhs * 1e9),
        hashrate_avg: Math.round(data.hashrateAverageGhs * 1e9),
        balance_krx: data.balanceKrx,
        immature_krx: data.immatureKrx,
        daily_est_krx: data.dailyEstKrx,
        workers_online: data.workersOnline,
        workers_total: data.workersTotal,
        shares_accepted: data.workers.reduce((a, w) => a + w.sharesAccepted, 0),
        shares_stale: 0,
        paid_krx: data.paidKrx,
      },
      data.workers,
    );

    // Ingestão dos pagamentos discretos (verdade-fonte dos ganhos; dedup por tx). O backfill
    // do passado é automático: ingerimos a lista completa que a API expõe a cada ciclo.
    const newPayments = insertPoolPayments(data.lastPayments);
    if (newPayments > 0) console.log(`[pool] ${newPayments} novo(s) pagamento(s) registrado(s)`);

    // Log do preço (throttled a 1/min) para o sinal de janela de preço.
    if (now - lastPriceLogMs >= PRICE_LOG_INTERVAL_MS) {
      const { price } = getCachedPrice();
      if (price > 0) {
        insertPricePoint(now, price);
        lastPriceLogMs = now;
      }
    }

    // Consolidação periódica em rollups horário/diário e poda do raw fora da janela.
    if (cycle % ROLLUP_EVERY_CYCLES === 0) {
      rollupPoolHistory();
      prunePoolSnapshots(RETENTION_DAYS);
      prunePriceHistory(PRICE_RETENTION_HOURS);
    }
    cycle++;

    console.log(
      `[pool] snapshot salvo — ${data.hashrateCurrentGhs.toFixed(2)} GH/s, saldo ${data.balanceKrx.toFixed(2)} KRX`,
    );
  } catch (err) {
    console.warn('[pool] falha ao capturar snapshot:', (err as Error).message);
  }
}

export function startPoolSync(): void {
  void capturePoolSnapshot();
  setInterval(() => void capturePoolSnapshot(), POOL_INTERVAL_MS);
}
