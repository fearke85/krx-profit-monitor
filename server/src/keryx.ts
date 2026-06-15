import { config } from './config.js';
import type { RawTx } from './db.js';

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return (await res.json()) as T;
  } catch (err) {
    if (attempt < 4) {
      const delay = 500 * 2 ** attempt; // 0.5s, 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delay));
      return fetchJson<T>(url, attempt + 1);
    }
    throw err;
  }
}

export async function getBalanceSompi(address: string): Promise<number> {
  const data = await fetchJson<{ balance_sompi: number }>(
    `${config.keryxApi}/addresses/${encodeURIComponent(address)}/balance`,
  );
  return data.balance_sompi;
}

interface AddressTxRaw {
  block_hash: string;
  daa_score: number;
  tx_id: string;
}
interface AddressPageRaw {
  total_tx_count: number;
  transactions: AddressTxRaw[];
}

export interface AddressPage {
  totalTxCount: number;
  txs: RawTx[];
}

export async function getAddressTxsPage(
  address: string,
  limit: number,
  offset: number,
): Promise<AddressPage> {
  const url = `${config.keryxApi}/addresses/${encodeURIComponent(
    address,
  )}?limit=${limit}&offset=${offset}`;
  const data = await fetchJson<AddressPageRaw>(url);
  return {
    totalTxCount: data.total_tx_count,
    txs: (data.transactions ?? []).map((t) => ({
      tx_id: t.tx_id,
      block_hash: t.block_hash,
      daa_score: t.daa_score,
    })),
  };
}

interface TxIO {
  address: string;
  amount_sompi: number;
}
interface TxDetailRaw {
  block: { timestamp_ms: number };
  inputs: TxIO[];
  outputs: TxIO[];
}

export interface TxDetail {
  timestampMs: number;
  /** saídas para o nosso endereço − entradas vindas do nosso endereço (líquido real). */
  netSompi: number;
}

/**
 * Detalhe de uma transação: horário do bloco + líquido para o endereço monitorado.
 * Consolidações de UTXO (entradas e saídas do próprio endereço) zeram o net, evitando
 * inflar o "recebido".
 */
export async function getTxDetail(address: string, txId: string): Promise<TxDetail> {
  const data = await fetchJson<TxDetailRaw>(
    `${config.keryxApi}/transactions/${encodeURIComponent(txId)}`,
  );
  const outs = (data.outputs ?? [])
    .filter((o) => o.address === address)
    .reduce((a, o) => a + o.amount_sompi, 0);
  const ins = (data.inputs ?? [])
    .filter((i) => i.address === address)
    .reduce((a, i) => a + i.amount_sompi, 0);
  return { timestampMs: data.block.timestamp_ms, netSompi: outs - ins };
}
