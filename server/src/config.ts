import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export const config = {
  // O endereço monitorado é definido pela UI (persistido no banco), não aqui.
  timezone: env('TIMEZONE', 'America/Sao_Paulo'),
  port: Number(env('PORT', '4000')),
  pollIntervalMs: Number(env('POLL_INTERVAL_MS', '60000')),
  keryxApi: env('KERYX_API', 'https://keryx-labs.com/api/v1').replace(/\/$/, ''),
  nonkycUrl: env(
    'NONKYC_URL',
    'https://nonkyc.io/api/v2/market/getbysymbol/KRX_USDT',
  ),

  // ---- Pool solo local (stratum bridge) ----
  // Liga/desliga a coleta da sua própria pool solo (a bridge Prometheus). A pool externa
  // (baikalmine) continua independente; os dois modos coexistem.
  soloEnabled: env('SOLO_ENABLED', '1') === '1',
  // Endpoint /metrics da keryx-bridge. A bridge publica :2114 no host; do container do
  // monitor alcançamos via host.docker.internal (igual ao miner com a :5555).
  bridgeMetricsUrl: env('BRIDGE_METRICS_URL', 'http://host.docker.internal:2114/metrics'),
  // Recompensa de coinbase por bloco (KRX). 0 = desconhecida → a estimativa em KRX é
  // desligada e mostramos só "blocos/dia esperados" (a verdade dos ganhos é on-chain).
  blockRewardKrx: Number(env('BLOCK_REWARD_KRX', '0')),
  // Blocos por dia da rede Keryx (estilo Kaspa: ~1 bloco/s → 86400/dia).
  blocksPerDay: Number(env('BLOCKS_PER_DAY', '86400')),
  // Diretório de dados na raiz do projeto (../../data a partir de server/src)
  dataDir: path.resolve(__dirname, '..', '..', 'data'),
  // Caminho do build do front, servido em produção
  webDist: path.resolve(__dirname, '..', '..', 'web', 'dist'),
};

export const SOMPI_PER_KRX = 100_000_000; // 1 KRX = 1e8 sompi (igual ao Kaspa)
