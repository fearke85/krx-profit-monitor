import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const NONKYC_URL = 'https://nonkyc.io/api/v2/market/getbysymbol/KRX_USDT';

/** Em dev, /api/price roda no Vite (nonkyc bloqueia CORS no browser). */
function priceApiPlugin(): Plugin {
  return {
    name: 'krx-price-api',
    configureServer(server) {
      server.middlewares.use('/api/price', async (req, res) => {
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        try {
          const upstream = await fetch(NONKYC_URL, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
          });
          if (!upstream.ok) {
            res.statusCode = 502;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'price upstream unavailable' }));
            return;
          }
          const data = (await upstream.json()) as {
            lastPriceNumber?: number;
            lastPrice?: string;
          };
          const price =
            data.lastPriceNumber ?? (data.lastPrice ? Number(data.lastPrice) : NaN);
          if (!Number.isFinite(price) || price <= 0) {
            res.statusCode = 502;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'invalid price' }));
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ price_usd: price, fetched_ms: Date.now() }));
        } catch {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'price unavailable' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), priceApiPlugin()],
  server: {
    port: 5173,
  },
});
