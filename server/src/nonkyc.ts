import { config } from './config.js';

interface NonkycTicker {
  lastPriceNumber?: number;
  lastPrice?: string;
}

let lastPrice = 0;
let lastFetchedMs = 0;

/** Preço atual de KRX em USDT (lastPrice da nonkyc). Mantém o último valor em memória. */
export async function getPriceUsd(): Promise<number> {
  const res = await fetch(config.nonkycUrl, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`nonkyc HTTP ${res.status}`);
  const data = (await res.json()) as NonkycTicker;
  const price =
    data.lastPriceNumber ?? (data.lastPrice ? Number(data.lastPrice) : NaN);
  if (Number.isFinite(price) && price > 0) {
    lastPrice = price;
    lastFetchedMs = Date.now();
  }
  return lastPrice;
}

export function getCachedPrice(): { price: number; fetchedMs: number } {
  return { price: lastPrice, fetchedMs: lastFetchedMs };
}
