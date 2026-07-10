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
}

export interface TxDetail {
  timestampMs: number;
  netSompi: number;
  daaScore?: number;
}

/** Detalhe completo — usado só para calibrar o relógio DAA→timestamp (poucas amostras). */
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
  };
}

export async function getBlockTimestampMs(blockHash: string): Promise<number> {
  const data = await fetchJson<{ timestamp_ms: number }>(
    `${KERYX_API}/blocks/${encodeURIComponent(blockHash)}`,
  );
  return data.timestamp_ms;
}
