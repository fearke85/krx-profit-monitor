/**
 * Proxy público de câmbio USD→BRL (AwesomeAPI).
 * Sem API keys. Mesmas proteções do /api/price: só GET, host allowlist, erros genéricos.
 */

const ALLOWED_HOSTS = new Set(['economia.awesomeapi.com.br']);

const DEFAULT_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL';

function resolveUpstreamUrl(): string {
  const raw = (process.env.FX_URL ?? DEFAULT_URL).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('FX_URL inválida');
  }
  if (url.protocol !== 'https:') throw new Error('FX_URL deve ser https');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('FX_URL host não permitido');
  return url.toString();
}

interface AwesomeFx {
  USDBRL?: { bid?: string; ask?: string };
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
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
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
      res.status(502).json({ error: 'fx upstream unavailable' });
      return;
    }
    const data = (await upstream.json()) as AwesomeFx;
    const rate = Number(data.USDBRL?.bid ?? NaN);
    if (!Number.isFinite(rate) || rate <= 0) {
      res.status(502).json({ error: 'invalid fx rate' });
      return;
    }
    res.status(200).json({ usd_brl: rate, fetched_ms: Date.now() });
  } catch {
    res.status(502).json({ error: 'fx unavailable' });
  }
}
