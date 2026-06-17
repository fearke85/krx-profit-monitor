import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, SOMPI_PER_KRX } from './config.js';
import { getBalanceSompi } from './keryx.js';
import { getCachedPrice } from './nonkyc.js';
import { syncStatus, triggerSync } from './sync.js';
import {
  dailyReceived,
  receivedOnDay,
  getPriceSnapshot,
  getPriceRange,
  getPoolRollupHourly,
  getPoolRollupDaily,
  getPoolPayments,
  poolPaymentsDaily,
  poolPaymentsTotalKrx,
  getBridgeRollupHourly,
  getBridgeRollupDaily,
  getBridgeHistory,
  type PoolSnapshotRow,
  type PoolWorkerSnapRow,
  type PoolRollupRow,
  type PoolRollupDailyRow,
} from './db.js';
import {
  getActiveAddress,
  setActiveAddress,
  isValidAddressFormat,
  normalizeAddress,
} from './address.js';
import { todayBrt, daysAgoBrt } from './day.js';
import { getPoolData, clearPoolCache } from './pool.js';
import { getPoolHistory } from './db.js';
import { getBridgeData, clearBridgeCache } from './bridge.js';

const toKrx = (sompi: number) => sompi / SOMPI_PER_KRX;
const GH = 1e9;

/** Converte "YYYY-MM-DD" para um ms ordenável (meia-noite UTC daquela data-calendário). */
function dayToMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

interface PoolHistoryPoint {
  t: number;
  hashrate_curr_ghs: number;
  hashrate_avg_ghs: number;
  balance_krx: number;
  immature_krx: number;
  daily_est_krx: number;
  workers_online: number;
  coverage: number; // 1 = sem gaps; < 1 = downtime no bucket (sample/expected)
}

interface PoolWorkerPoint {
  snapshot_id: number;
  name: string;
  is_offline: boolean;
  hashrate_curr_ghs: number;
  hashrate_avg_ghs: number;
  shares_accepted: number;
}

interface HistorySource {
  history: (fromMs: number) => { snapshots: PoolSnapshotRow[]; workerSnaps: PoolWorkerSnapRow[] };
  hourly: (fromMs: number) => PoolRollupRow[];
  daily: (fromDay: string) => PoolRollupDailyRow[];
}

const POOL_SOURCE: HistorySource = {
  history: getPoolHistory,
  hourly: getPoolRollupHourly,
  daily: getPoolRollupDaily,
};
const BRIDGE_SOURCE: HistorySource = {
  history: getBridgeHistory,
  hourly: getBridgeRollupHourly,
  daily: getBridgeRollupDaily,
};

/**
 * Seleciona a resolução pela janela pedida: janelas curtas servem do raw (15s);
 * semanas/meses do rollup horário; trimestre/ano/tudo do rollup diário.
 */
function buildPoolHistory(range: string, src: HistorySource = POOL_SOURCE): {
  resolution: 'raw' | 'hourly' | 'daily';
  snapshots: PoolHistoryPoint[];
  workerSnaps: PoolWorkerPoint[];
} {
  const now = Date.now();
  const DAY = 86_400_000;

  if (range === '24h' || range === '48h') {
    const hours = range === '48h' ? 48 : 24;
    const { snapshots, workerSnaps } = src.history(now - hours * 3_600_000);
    return {
      resolution: 'raw',
      snapshots: snapshots.map((s) => ({
        t: s.captured_ms,
        hashrate_curr_ghs: s.hashrate_curr / GH,
        hashrate_avg_ghs: s.hashrate_avg / GH,
        balance_krx: s.balance_krx,
        immature_krx: s.immature_krx,
        daily_est_krx: s.daily_est_krx,
        workers_online: s.workers_online,
        coverage: 1,
      })),
      workerSnaps: workerSnaps.map((w) => ({
        snapshot_id: w.snapshot_id,
        name: w.name,
        is_offline: w.is_offline === 1,
        hashrate_curr_ghs: w.hashrate_curr / GH,
        hashrate_avg_ghs: w.hashrate_avg / GH,
        shares_accepted: w.shares_accepted,
      })),
    };
  }

  if (range === '7d' || range === '30d') {
    const days = range === '30d' ? 30 : 7;
    const rows = src.hourly(now - days * DAY);
    return {
      resolution: 'hourly',
      snapshots: rows.map((r) => ({
        t: r.bucket_ms,
        hashrate_curr_ghs: r.hashrate_avg_ghs,
        hashrate_avg_ghs: r.hashrate_avg_ghs,
        balance_krx: r.balance_krx_last,
        immature_krx: r.immature_krx_last,
        daily_est_krx: r.daily_est_avg_krx,
        workers_online: r.workers_online_avg,
        coverage: r.expected_count > 0 ? r.sample_count / r.expected_count : 1,
      })),
      workerSnaps: [],
    };
  }

  // daily: '90d' | 'year' | 'all'
  const fromDay = range === 'all' ? '0000-00-00' : range === 'year' ? daysAgoBrt(364) : daysAgoBrt(89);
  const rows = src.daily(fromDay);
  return {
    resolution: 'daily',
    snapshots: rows.map((r) => ({
      t: dayToMs(r.day_brt),
      hashrate_curr_ghs: r.hashrate_avg_ghs,
      hashrate_avg_ghs: r.hashrate_avg_ghs,
      balance_krx: r.balance_krx_last,
      immature_krx: r.immature_krx_last,
      daily_est_krx: r.daily_est_avg_krx,
      workers_online: r.workers_online_avg,
      coverage: r.expected_count > 0 ? r.sample_count / r.expected_count : 1,
    })),
    workerSnaps: [],
  };
}

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Endereço monitorado (definido pela UI).
  app.get('/api/address', (_req, res) => {
    res.json({ address: getActiveAddress() });
  });

  // Define/atualiza a wallet. Valida o formato e confirma na rede (consulta o saldo).
  app.post('/api/address', async (req, res) => {
    const raw = typeof req.body?.address === 'string' ? req.body.address : '';
    const address = normalizeAddress(raw);
    if (!isValidAddressFormat(address)) {
      return res
        .status(400)
        .json({ error: 'Endereço inválido. Use o formato keryx:... do explorer.' });
    }
    try {
      // Confirma que o endereço existe/é consultável antes de salvar.
      const balanceSompi = await getBalanceSompi(address);
      setActiveAddress(address);
      clearPoolCache();
      clearBridgeCache(); // zera estado de taxas do worker para a nova carteira
      triggerSync(); // começa a sincronizar a nova wallet imediatamente
      res.json({ address, balance_krx: toKrx(balanceSompi) });
    } catch {
      res
        .status(502)
        .json({ error: 'Não consegui consultar esse endereço na API do Keryx. Verifique e tente de novo.' });
    }
  });

  app.get('/api/summary', async (_req, res) => {
    try {
      const { price } = getCachedPrice();
      const address = getActiveAddress();

      if (!address) {
        // Sem wallet configurada: a UI mostra o formulário de cadastro.
        return res.json({
          address: null,
          needs_address: true,
          timezone: config.timezone,
          price_usd: price,
        });
      }

      const balanceSompi = await getBalanceSompi(address);
      const today = todayBrt();
      const todayRecv = receivedOnDay(today);
      const todayKrx = toKrx(todayRecv.received_sompi);

      res.json({
        address,
        needs_address: false,
        timezone: config.timezone,
        price_usd: price,
        balance_krx: toKrx(balanceSompi),
        balance_usdt: toKrx(balanceSompi) * price,
        today: {
          day: today,
          received_krx: todayKrx,
          tx_count: todayRecv.tx_count,
          est_usdt: todayKrx * price,
        },
        sync: {
          backfill_done: syncStatus.backfillDone,
          phase: syncStatus.phase,
          ingested_txs: syncStatus.ingestedTxs,
          total_txs: syncStatus.totalTxCount,
          pending_timestamps: syncStatus.pendingTimestamps,
          last_sync_ms: syncStatus.lastSyncMs,
        },
      });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.get('/api/daily', (req, res) => {
    const to = typeof req.query.to === 'string' ? req.query.to : todayBrt();
    const from =
      typeof req.query.from === 'string' ? req.query.from : daysAgoBrt(29);

    const { price: currentPrice } = getCachedPrice();
    const today = todayBrt();
    const rows = dailyReceived(from, to);

    const result = rows.map((r) => {
      const receivedKrx = toKrx(r.received_sompi);
      const snapshot = getPriceSnapshot(r.day);
      // Dia corrente sempre usa o preço atual (live). Dias passados usam o snapshot
      // capturado naquele dia; se não houver, cai no preço atual (rotulado).
      let priceUsed: number;
      let priceSource: 'current' | 'snapshot';
      if (r.day === today) {
        priceUsed = currentPrice;
        priceSource = 'current';
      } else if (snapshot !== undefined) {
        priceUsed = snapshot;
        priceSource = 'snapshot';
      } else {
        priceUsed = currentPrice;
        priceSource = 'current';
      }
      return {
        day: r.day,
        received_krx: receivedKrx,
        tx_count: r.tx_count,
        price_usd_used: priceUsed,
        price_source: priceSource,
        est_usdt: receivedKrx * priceUsed,
      };
    });

    res.json({ from, to, days: result });
  });

  app.get('/api/pool', async (req, res) => {
    const address = getActiveAddress();
    if (!address) return res.status(400).json({ error: 'Nenhuma wallet configurada.' });
    try {
      const data = await getPoolData(address);
      const range = typeof req.query.range === 'string' ? req.query.range : '24h';
      const history = buildPoolHistory(range);
      res.json({ ...data, history });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Pool SOLO local (stratum bridge). Mesma forma do /api/pool + extras solo, para
  // reuso do componente PoolStats no front. Não exige wallet: o solo costuma ter uma só.
  app.get('/api/bridge', async (req, res) => {
    try {
      const address = getActiveAddress();
      const data = await getBridgeData(address);
      const range = typeof req.query.range === 'string' ? req.query.range : '24h';
      const history = buildPoolHistory(range, BRIDGE_SOURCE);
      res.json({ ...data, history });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Dados de apoio à estratégia de realização de lucro: progresso do lote, janela de preço.
  app.get('/api/strategy', async (_req, res) => {
    try {
      const address = getActiveAddress();
      const { price: currentPrice } = getCachedPrice();

      // Saldo on-chain da wallet
      let walletBalanceKrx = 0;
      if (address) {
        const balanceSompi = await getBalanceSompi(address);
        walletBalanceKrx = toKrx(balanceSompi);
      }

      // Pool estimate (earning rate)
      let dailyEstKrx = 0;
      if (address) {
        try {
          const pool = await getPoolData(address);
          dailyEstKrx = pool.dailyEstKrx;
        } catch {
          // Pool indisponível — usamos 0
        }
      }

      // Janela de preço 24h e 48h
      const now = Date.now();
      const DAY_MS = 86_400_000;
      const range24h = getPriceRange(now - DAY_MS);
      const range48h = getPriceRange(now - 2 * DAY_MS);

      // Sinal de janela alta: se o preço atual estiver no terço superior do range 24h
      let priceSignal: 'high' | 'neutral' | 'low' | null = null;
      if (range24h && range24h.max > range24h.min) {
        const pct = (currentPrice - range24h.min) / (range24h.max - range24h.min);
        if (pct >= 0.66) priceSignal = 'high';
        else if (pct <= 0.33) priceSignal = 'low';
        else priceSignal = 'neutral';
      }

      const BATCH_TARGET = 4_000;
      const accumulatedKrx = Math.min(walletBalanceKrx, BATCH_TARGET);
      const remainingKrx = Math.max(0, BATCH_TARGET - walletBalanceKrx);
      const etaHours =
        remainingKrx > 0 && dailyEstKrx > 0
          ? (remainingKrx / dailyEstKrx) * 24
          : 0;
      const batchReady = walletBalanceKrx >= BATCH_TARGET;
      const priceFavorable = priceSignal === 'high';

      res.json({
        batch_target_krx: BATCH_TARGET,
        wallet_balance_krx: walletBalanceKrx,
        daily_est_krx: dailyEstKrx,
        accumulated_krx: accumulatedKrx,
        remaining_krx: remainingKrx,
        eta_hours: etaHours,
        current_price_usd: currentPrice,
        price_range_24h: range24h,
        price_range_48h: range48h,
        price_signal: priceSignal,
        batch_ready: batchReady,
        price_favorable: priceFavorable,
        deposit_alert: batchReady && priceFavorable,
      });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Histórico de pagamentos da pool (eventos autoritativos). Lista + série diária.
  app.get('/api/pool/payments', (req, res) => {
    const to = typeof req.query.to === 'string' ? req.query.to : todayBrt();
    const from = typeof req.query.from === 'string' ? req.query.from : daysAgoBrt(89);
    res.json({
      total_krx: poolPaymentsTotalKrx(),
      payments: getPoolPayments(200),
      daily: poolPaymentsDaily(from, to),
    });
  });

  // Serve o build do front em produção (uma porta só). Checado por request — assim
  // funciona mesmo se o `npm run build` rodar depois do servidor já estar no ar.
  // express.static ignora diretório inexistente (chama next()).
  app.use(express.static(config.webDist));
  app.get('*', (_req, res) => {
    const index = path.join(config.webDist, 'index.html');
    if (fs.existsSync(index)) {
      res.sendFile(index);
    } else {
      res
        .status(404)
        .send(
          'Frontend não compilado. Rode `npm run dev` (dev, front na :5173) ou `npm run build` + `npm start` (produção).',
        );
    }
  });

  return app;
}
