import { config } from './config.js';
import { getActiveAddress } from './address.js';
import { getBridgeData } from './bridge.js';
import { saveBridgeSnapshot, pruneBridgeSnapshots, rollupBridgeHistory } from './db.js';

const BRIDGE_INTERVAL_MS = 15_000; // mesma cadência do poolSync (rollups esperam 15s)
const RETENTION_DAYS = 14;
const ROLLUP_EVERY_CYCLES = 20; // ~5 min

let cycle = 0;

async function captureBridgeSnapshot(): Promise<void> {
  const address = getActiveAddress();

  try {
    // force: ignora o cache de 10s para amostra fresca a cada 15s. Sem address
    // ainda coletamos (todos os workers) — solo costuma ter uma carteira só.
    const data = await getBridgeData(address, { force: true });

    saveBridgeSnapshot(
      {
        captured_ms: Date.now(),
        hashrate_curr: Math.round(data.hashrateCurrentGhs * 1e9),
        hashrate_avg: Math.round(data.hashrateAverageGhs * 1e9),
        balance_krx: data.balanceKrx,
        immature_krx: data.immatureKrx,
        daily_est_krx: data.dailyEstKrx,
        workers_online: data.workersOnline,
        workers_total: data.workersTotal,
        shares_accepted: data.roundShares,
        shares_stale: 0,
        paid_krx: data.paidKrx,
      },
      data.workers,
    );

    if (cycle % ROLLUP_EVERY_CYCLES === 0) {
      rollupBridgeHistory();
      pruneBridgeSnapshots(RETENTION_DAYS);
    }
    cycle++;

    console.log(
      `[bridge] snapshot — ${data.hashrateCurrentGhs.toFixed(2)} GH/s · ${data.workersOnline}/${data.workersTotal} workers · ${data.blocksFound} blocos`,
    );
  } catch (err) {
    console.warn('[bridge] falha ao coletar /metrics:', (err as Error).message);
  }
}

export function startBridgeSync(): void {
  if (!config.soloEnabled) {
    console.log('[bridge] coleta da pool solo desativada (SOLO_ENABLED=0).');
    return;
  }
  console.log(`[bridge] coletando pool solo em ${config.bridgeMetricsUrl} a cada 15s.`);
  void captureBridgeSnapshot();
  setInterval(() => void captureBridgeSnapshot(), BRIDGE_INTERVAL_MS);
}
