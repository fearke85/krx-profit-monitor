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
