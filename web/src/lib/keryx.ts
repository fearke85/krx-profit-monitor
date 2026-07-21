import { KERYX_API } from './config';

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    // Não retenta 4xx (exceto 429).
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`HTTP ${res.status} em ${url}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return (await res.json()) as T;
  } catch (err) {
    const msg = (err as Error).message ?? '';
    const retriable =
      msg.includes('HTTP 429') ||
      msg.includes('HTTP 5') ||
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('timeout') ||
      (err as Error).name === 'TimeoutError' ||
      (err as Error).name === 'AbortError';
    if (retriable && attempt < 3) {
      const delay = 300 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
      return fetchJson<T>(url, attempt + 1);
    }
    throw err;
  }
}

export async function getBalanceSompi(address: string): Promise<number> {
  const data = await fetchJson<{ balance_sompi: number }>(
    `${KERYX_API}/addresses/${encodeURIComponent(address)}/balance`,
  );
  return data.balance_sompi;
}

interface AddressTxRaw {
  block_hash: string;
  daa_score: number;
  tx_id: string;
  amount_sompi?: number;
  is_spend?: boolean;
}
interface AddressPageRaw {
  total_tx_count: number;
  transactions: AddressTxRaw[];
}

/** Tx como vem da listagem do endereço (já traz amount + direção). */
export interface ListedTx {
  tx_id: string;
  block_hash: string;
  daa_score: number;
  /** Líquido aproximado: +amount se receive, −amount se spend. */
  net_sompi: number;
}

export interface AddressPage {
  totalTxCount: number;
  txs: ListedTx[];
}

export async function getAddressTxsPage(
  address: string,
  limit: number,
  offset: number,
): Promise<AddressPage> {
  const url = `${KERYX_API}/addresses/${encodeURIComponent(address)}?limit=${limit}&offset=${offset}`;
  const data = await fetchJson<AddressPageRaw>(url);
  return {
    totalTxCount: data.total_tx_count,
    txs: (data.transactions ?? []).map((t) => {
      const amount = Number(t.amount_sompi ?? 0);
      const spend = !!t.is_spend;
      return {
        tx_id: t.tx_id,
        block_hash: t.block_hash,
        daa_score: t.daa_score,
        net_sompi: spend ? -amount : amount,
      };
    }),
  };
}

interface TxIO {
  address: string;
  amount_sompi: number;
}
interface TxDetailRaw {
  block: { timestamp_ms: number; daa_score?: number };
  inputs: TxIO[];
  outputs: TxIO[];
  is_accepted?: boolean;
  confirmations?: number;
}

export interface TxDetail {
  timestampMs: number;
  netSompi: number;
  daaScore?: number;
  /** Aceita pelo consenso — só então o valor credita no saldo do endereço. */
  isAccepted: boolean;
  confirmations: number;
}

/**
 * Detalhe completo — usado para verificar aceitação de txs recentes (a listagem
 * do endereço inclui txs apenas incluídas em bloco, antes de creditarem saldo).
 */
export async function getTxDetail(address: string, txId: string): Promise<TxDetail> {
  const data = await fetchJson<TxDetailRaw>(
    `${KERYX_API}/transactions/${encodeURIComponent(txId)}`,
  );
  const outs = (data.outputs ?? [])
    .filter((o) => o.address === address)
    .reduce((a, o) => a + o.amount_sompi, 0);
  const ins = (data.inputs ?? [])
    .filter((i) => i.address === address)
    .reduce((a, i) => a + i.amount_sompi, 0);
  return {
    timestampMs: data.block.timestamp_ms,
    netSompi: outs - ins,
    daaScore: data.block.daa_score,
    isAccepted: data.is_accepted === true,
    confirmations: data.confirmations ?? 0,
  };
}

export interface RecentBlock {
  daaScore: number;
  timestampMs: number;
}

/**
 * Blocos recentes com (daa_score, timestamp_ms) prontos — 1 request substitui
 * dezenas de leituras de bloco individuais na calibração do relógio DAA.
 */
export async function getRecentBlocks(limit = 100): Promise<RecentBlock[]> {
  const data = await fetchJson<Array<{ daa_score: number; timestamp_ms: number }>>(
    `${KERYX_API}/blocks?limit=${limit}`,
  );
  return (data ?? [])
    .filter((b) => b.daa_score > 0 && b.timestamp_ms > 0)
    .map((b) => ({ daaScore: b.daa_score, timestampMs: b.timestamp_ms }));
}

export interface NetworkInfo {
  blockRewardKrx: number;
  hashrateHps: number;
  network: string;
}

const HASHRATE_MIN_POINTS = 3;

export type HashrateSource =
  | { mode: 'current' }
  | { mode: 'avg'; hours: number };

/**
 * Hashrate efetivo para a calculadora.
 *
 * - `current`: retorna 0 → o chamador usa `hashrate_hps` do `/info`.
 * - `avg`: busca `/hashrate-history?period=24h` como bucket e filtra no
 *   cliente `timestamp_ms >= now − hours` (o label `period=` da API não é
 *   confiável). Se houver menos de 3 pontos, cai no current.
 */
export async function getEffectiveNetworkHashrate(
  mode: 'current' | 'avg' = 'current',
  hours = 2,
): Promise<{
  hashrateHps: number;
  source: HashrateSource;
}> {
  if (mode !== 'avg') {
    return { hashrateHps: 0, source: { mode: 'current' } };
  }
  const windowHours = Math.min(24, Math.max(1, Math.round(hours)));
  try {
    const data = await fetchJson<{
      points?: Array<{ hashrate_hps: number; timestamp_ms: number }>;
    }>(`${KERYX_API}/hashrate-history?period=24h`);
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    const recent = (data.points ?? []).filter(
      (p) => p.hashrate_hps > 0 && p.timestamp_ms >= cutoff,
    );
    if (recent.length < HASHRATE_MIN_POINTS) {
      return { hashrateHps: 0, source: { mode: 'current' } };
    }
    const sum = recent.reduce((a, p) => a + p.hashrate_hps, 0);
    return {
      hashrateHps: sum / recent.length,
      source: { mode: 'avg', hours: windowHours },
    };
  } catch {
    return { hashrateHps: 0, source: { mode: 'current' } };
  }
}

/** Info de consenso da rede (recompensa de bloco e hashrate atual). */
export async function getNetworkInfo(): Promise<NetworkInfo> {
  const data = await fetchJson<{
    block_reward_krx: number;
    hashrate_hps: number;
    network: string;
  }>(`${KERYX_API}/info`);
  return {
    blockRewardKrx: data.block_reward_krx,
    hashrateHps: data.hashrate_hps,
    network: data.network,
  };
}

export async function getBlockTimestampMs(blockHash: string): Promise<number> {
  const data = await fetchJson<{ timestamp_ms: number }>(
    `${KERYX_API}/blocks/${encodeURIComponent(blockHash)}`,
  );
  return data.timestamp_ms;
}
