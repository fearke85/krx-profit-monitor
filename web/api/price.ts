/**
 * Proxy público de preço KRX/USDT.
 * Sem API keys — a nonkyc é pública, mas bloqueia CORS no browser.
 * Proteções: só GET, host allowlist (anti-SSRF), erros genéricos.
 */

const ALLOWED_HOSTS = new Set(['nonkyc.io', 'www.nonkyc.io']);

const DEFAULT_URL = 'https://nonkyc.io/api/v2/market/getbysymbol/KRX_USDT';

function resolveUpstreamUrl(): string {
  const raw = (process.env.NONKYC_URL ?? DEFAULT_URL).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('NONKYC_URL inválida');
  }
  if (url.protocol !== 'https:') throw new Error('NONKYC_URL deve ser https');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('NONKYC_URL host não permitido');
  return url.toString();
}

interface NonkycTicker {
  lastPriceNumber?: number;
  lastPrice?: string;
}

type Res = {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => { json: (b: unknown) => void; end: () => void };
};

function withTimeout(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

export default async function handler(req: { method?: string }, res: Res) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== undefined) {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const upstreamUrl = resolveUpstreamUrl();
    const upstream = await fetch(upstreamUrl, {
      headers: { accept: 'application/json' },
      signal: withTimeout(8_000),
    });
    if (!upstream.ok) {
      res.status(502).json({ error: 'price upstream unavailable' });
      return;
    }
    const data = (await upstream.json()) as NonkycTicker;
    const price =
      data.lastPriceNumber ?? (data.lastPrice ? Number(data.lastPrice) : NaN);
    if (!Number.isFinite(price) || price <= 0) {
      res.status(502).json({ error: 'invalid price' });
      return;
    }
    // Resposta mínima — sem ecoar URL, headers ou payload upstream.
    res.status(200).json({ price_usd: price, fetched_ms: Date.now() });
  } catch {
    res.status(502).json({ error: 'price unavailable' });
  }
}
