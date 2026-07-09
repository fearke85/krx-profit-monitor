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
} from './db.js';
import {
  getActiveAddress,
  setActiveAddress,
  isValidAddressFormat,
  normalizeAddress,
} from './address.js';
import { todayBrt, daysAgoBrt } from './day.js';

const toKrx = (sompi: number) => sompi / SOMPI_PER_KRX;

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

  // Dados de apoio à estratégia de realização de lucro: progresso do lote, janela de preço.
  // ETA usa ritmo on-chain recente (média dos últimos 7 dias com recebimento), não pool.
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

      // Ritmo diário estimado a partir do histórico on-chain (últimos 7 dias BRT).
      const from = daysAgoBrt(6);
      const to = todayBrt();
      const recent = dailyReceived(from, to);
      const dailyEstKrx =
        recent.length > 0
          ? recent.reduce((s, r) => s + toKrx(r.received_sompi), 0) / recent.length
          : 0;

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
