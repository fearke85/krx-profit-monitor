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
  // Diretório de dados na raiz do projeto (../../data a partir de server/src)
  dataDir: path.resolve(__dirname, '..', '..', 'data'),
  // Caminho do build do front, servido em produção
  webDist: path.resolve(__dirname, '..', '..', 'web', 'dist'),
};

export const SOMPI_PER_KRX = 100_000_000; // 1 KRX = 1e8 sompi (igual ao Kaspa)
