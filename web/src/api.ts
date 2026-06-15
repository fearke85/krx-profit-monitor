export interface Summary {
  address: string | null;
  needs_address?: boolean;
  timezone: string;
  price_usd: number;
  balance_krx?: number;
  balance_usdt?: number;
  today?: {
    day: string;
    received_krx: number;
    tx_count: number;
    est_usdt: number;
  };
  sync?: {
    backfill_done: boolean;
    phase: string;
    ingested_txs: number;
    total_txs: number;
    pending_timestamps: number;
    last_sync_ms: number;
  };
}

export interface DailyRow {
  day: string;
  received_krx: number;
  tx_count: number;
  price_usd_used: number;
  price_source: 'current' | 'snapshot';
  est_usdt: number;
}

export interface DailyResponse {
  from: string;
  to: string;
  days: DailyRow[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function getSummary(): Promise<Summary> {
  return getJson<Summary>('/api/summary');
}

export function getDaily(from?: string, to?: string): Promise<DailyResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return getJson<DailyResponse>(`/api/daily${qs ? `?${qs}` : ''}`);
}

export async function setAddress(
  address: string,
): Promise<{ address: string; balance_krx: number }> {
  const res = await fetch('/api/address', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return body as { address: string; balance_krx: number };
}
