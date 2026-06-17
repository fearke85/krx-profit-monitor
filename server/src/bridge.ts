import { config } from './config.js';

// ===========================================================================
// Consome o /metrics (Prometheus) da SUA keryx-bridge (pool solo). Diferente da
// baikalmine, aqui NÃO há pool/threshold/saldo intermediário: cada bloco que o
// seu nó encontra deposita a recompensa de coinbase direto na sua carteira. A
// "verdade dos ganhos" é on-chain (módulo keryx.ts). Este módulo entrega a
// TELEMETRIA viva: hashrate, blocos achados, shares, saúde do OPoI e a
// dificuldade/hashrate da rede para estimar o tempo esperado por bloco.
// ===========================================================================

const FETCH_TIMEOUT_MS = 5_000;
// ks_valid_share_diff_counter acumula o `hashValue` da bridge (DiffToHash em hasher.go),
// que é minHash·diff/1e9 com minHash≈2^256/maxTarget≈2^32 — ou seja, o contador JÁ está
// em GIGAHASHES. Logo a hashrate é simplesmente Δcontador/Δt (GH/s); para H/s multiplica
// por 1e9. (Verificado ao vivo: ~838 MH/s vs ~700 MH/s reportado pelo miner.)
const HASHES_PER_COUNTER_UNIT = 1e9;
// Janela após a qual um worker sem atividade (jobs) é considerado offline.
const WORKER_ONLINE_WINDOW_MS = 3 * 60_000;
// Janela deslizante para o hashrate "atual". Shares são esparsos (poucos/min), então
// uma janela curta pegaria diff=0 quase sempre; ~3min integra o suficiente para um
// número estável. Os jobs, esses sim, incrementam a todo instante (sinal de liveness).
const CURRENT_WINDOW_MS = 3 * 60_000;
// Janela (mais longa) para a "média". Sliding, não "desde o boot" — assim não zera a
// cada restart do monitor e se reconstrói sozinha a partir do primeiro share.
const AVG_WINDOW_MS = 30 * 60_000;
const GH = 1e9;

interface PromSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** Parser mínimo do formato texto do Prometheus (linhas `nome{labels} valor`). */
function parsePrometheus(text: string): PromSample[] {
  const out: PromSample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // nome{labels} valor   |   nome valor
    const braceIdx = line.indexOf('{');
    let name: string;
    let labelStr = '';
    let rest: string;
    if (braceIdx >= 0) {
      const close = line.indexOf('}', braceIdx);
      if (close < 0) continue;
      name = line.slice(0, braceIdx);
      labelStr = line.slice(braceIdx + 1, close);
      rest = line.slice(close + 1).trim();
    } else {
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      name = line.slice(0, sp);
      rest = line.slice(sp + 1).trim();
    }
    const value = Number(rest.split(/\s+/)[0]);
    if (!Number.isFinite(value)) continue;

    const labels: Record<string, string> = {};
    if (labelStr) {
      // labels: chave="valor",chave2="valor2" (valores podem conter vírgulas/aspas escapadas)
      const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(labelStr)) !== null) {
        labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
      }
    }
    out.push({ name, labels, value });
  }
  return out;
}

export interface BridgeBlock {
  hash: string;
  nonce: string;
  bluescore: string;
  worker: string;
}

export interface BridgeWorker {
  name: string;
  isOffline: boolean;
  hashrateCurrentGhs: number;
  hashrateAverageGhs: number;
  sharesAccepted: number;
  lastShareMs: number;
}

// Dado no MESMO formato do PoolData (para reusar o componente PoolStats), com
// extras solo. Campos de pool que não existem no solo recebem equivalentes:
// threshold = 0 (não há), "pagamentos" = blocos achados, saldo = saldo on-chain do nó.
export interface BridgeData {
  mode: 'solo';
  isOnline: boolean;
  hashrateCurrentGhs: number;
  hashrateAverageGhs: number;
  dailyEstKrx: number;
  balanceKrx: number;
  immatureKrx: number;
  matureKrx: number;
  paidKrx: number;
  minThresholdKrx: number;
  paymentThresholdKrx: number;
  workersOnline: number;
  workersTotal: number;
  lastShareMs: number;
  roundShares: number;
  workers: BridgeWorker[];
  lastPayments: Array<{ timestampMs: number; amountKrx: number; tx: string }>;
  rewardsByPeriods: number[];
  fetchedMs: number;
  // ---- extras solo ----
  blocksFound: number;
  blocks: BridgeBlock[];
  networkHashrateHs: number;
  networkDifficulty: number;
  networkBlockCount: number;
  opoiChallengePasses: number;
  opoiInferenceResults: number;
  expectedBlocksPerDay: number;
  expectedTimeToBlockMs: number; // 0 = indeterminado (sem hashrate ainda)
  blockRewardKrx: number; // 0 = desconhecido (estimativa em KRX desligada)
}

// Estado entre coletas para derivar taxas (counters são cumulativos). Só o sampler
// (getBridgeData com force:true, a cada 15s) avança esse baseline; leituras HTTP
// calculam contra ele sem mutá-lo, evitando corromper a amostragem do histórico.
interface WorkerState {
  // Checkpoints (ms, diff) do sampler, mantidos por até AVG_WINDOW_MS. "Atual" mede sobre
  // o checkpoint ~CURRENT_WINDOW_MS atrás; "média" sobre o mais antigo (~AVG_WINDOW_MS).
  checkpoints: Array<{ ms: number; diff: number }>;
  lastShares: number;
  lastShareMs: number; // última vez que vimos o contador de shares subir
  lastJobs: number;
  lastActiveMs: number; // última vez que vimos jobs subirem (liveness)
}
const workerStates = new Map<string, WorkerState>();
let cache: { data: BridgeData; fetchedMs: number } | null = null;
const CACHE_TTL_MS = 10_000;

function sum(samples: PromSample[], pred: (s: PromSample) => boolean): number {
  let t = 0;
  for (const s of samples) if (pred(s)) t += s.value;
  return t;
}

/**
 * Coleta o /metrics da bridge e produz a telemetria solo. `address`, se fornecido,
 * filtra os contadores por carteira (o monitor acompanha um endereço por vez).
 */
export async function getBridgeData(
  address: string | null,
  opts: { force?: boolean; nowMs?: number } = {},
): Promise<BridgeData> {
  const now = opts.nowMs ?? Date.now();
  if (!opts.force && cache && now - cache.fetchedMs < CACHE_TTL_MS) return cache.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let text: string;
  try {
    const res = await fetch(config.bridgeMetricsUrl, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`bridge /metrics HTTP ${res.status}`);
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const samples = parsePrometheus(text);
  const mine = (s: PromSample) => !address || s.labels.wallet === address;

  // ---- por worker (chave: nome do worker) ----
  const byWorker = new Map<string, { diff: number; shares: number; jobs: number }>();
  const ensure = (w: string) => {
    let e = byWorker.get(w);
    if (!e) { e = { diff: 0, shares: 0, jobs: 0 }; byWorker.set(w, e); }
    return e;
  };
  for (const s of samples) {
    if (!mine(s)) continue;
    const w = s.labels.worker;
    if (!w) continue;
    if (s.name === 'ks_valid_share_diff_counter') ensure(w).diff = s.value;
    else if (s.name === 'ks_valid_share_counter') ensure(w).shares = s.value;
    else if (s.name === 'ks_worker_job_counter') ensure(w).jobs = s.value;
  }

  const force = !!opts.force;
  const workers: BridgeWorker[] = [];
  let totalCurrHs = 0;
  let totalAvgHs = 0;
  let latestShareMs = 0;
  for (const [name, cur] of byWorker) {
    const st = workerStates.get(name);
    let currHs = 0;
    let avgHs = 0;
    let lastShareMs = st?.lastShareMs ?? 0;
    let lastActiveMs = st?.lastActiveMs ?? now;
    if (st) {
      const cps = st.checkpoints;
      // "atual": referência = checkpoint mais recente com ≥ CURRENT_WINDOW_MS de idade
      // (cai no mais antigo enquanto a janela ainda não encheu). cps em ordem crescente.
      let curRef = cps[0];
      for (const cp of cps) {
        if (now - cp.ms >= CURRENT_WINDOW_MS) curRef = cp;
        else break;
      }
      const curDt = (now - curRef.ms) / 1000;
      if (curDt > 0) currHs = ((cur.diff - curRef.diff) * HASHES_PER_COUNTER_UNIT) / curDt;
      // "média": sobre o checkpoint mais antigo retido (até ~AVG_WINDOW_MS).
      const avgDt = (now - cps[0].ms) / 1000;
      if (avgDt > 0) avgHs = ((cur.diff - cps[0].diff) * HASHES_PER_COUNTER_UNIT) / avgDt;
      if (cur.shares > st.lastShares) lastShareMs = now;
      if (cur.jobs > st.lastJobs) lastActiveMs = now; // jobs subindo = worker vivo
      if (force) {
        st.lastShares = cur.shares;
        st.lastShareMs = lastShareMs;
        st.lastJobs = cur.jobs;
        st.lastActiveMs = lastActiveMs;
        cps.push({ ms: now, diff: cur.diff });
        // retém checkpoints por AVG_WINDOW_MS (mantém um logo além como âncora).
        while (cps.length > 1 && now - cps[1].ms >= AVG_WINDOW_MS) cps.shift();
      }
    } else {
      workerStates.set(name, {
        checkpoints: [{ ms: now, diff: cur.diff }],
        lastShares: cur.shares,
        lastShareMs: 0,
        lastJobs: cur.jobs,
        lastActiveMs: now,
      });
    }
    const isOffline = now - lastActiveMs > WORKER_ONLINE_WINDOW_MS;
    totalCurrHs += currHs;
    totalAvgHs += avgHs;
    if (lastShareMs > latestShareMs) latestShareMs = lastShareMs;
    workers.push({
      name,
      isOffline,
      hashrateCurrentGhs: currHs / GH,
      hashrateAverageGhs: avgHs / GH,
      sharesAccepted: cur.shares,
      lastShareMs,
    });
  }

  // ---- rede ----
  const networkHashrateHs = sum(samples, (s) => s.name === 'ks_estimated_network_hashrate_gauge');
  const networkDifficulty = sum(samples, (s) => s.name === 'ks_network_difficulty_gauge');
  const networkBlockCount = sum(samples, (s) => s.name === 'ks_network_block_count');

  // ---- blocos achados ----
  const blocksFound = sum(samples, (s) => mine(s) && s.name === 'ks_blocks_mined');
  const blocks: BridgeBlock[] = samples
    .filter((s) => mine(s) && s.name === 'ks_mined_blocks_gauge' && s.value > 0)
    .map((s) => ({
      hash: s.labels.hash ?? '',
      nonce: s.labels.nonce ?? '',
      bluescore: s.labels.bluescore ?? '',
      worker: s.labels.worker ?? '',
    }));

  // ---- OPoI ----
  const opoiChallengePasses = sum(samples, (s) => mine(s) && s.name === 'ks_opoi_challenge_passes');
  const opoiInferenceResults = sum(samples, (s) => mine(s) && s.name === 'ks_opoi_inference_results');

  // ---- saldo (reportado pelo nó) ----
  const balanceKrx = sum(samples, (s) => s.name === 'ks_balance_by_wallet_gauge' && mine(s));

  // ---- estimativas (probabilidade de achar bloco solo) ----
  // Hashes esperados por bloco = networkDifficulty × 2^32 (prova independente de convenção:
  // shares/bloco = networkDiff/shareDiff e hashes/share = shareDiff×2^32 ⇒ o shareDiff cancela).
  // Esta é a MESMA convenção da minha hashrate (derivada do contador de shares via DiffToHash,
  // validada contra o display do miner). NÃO usar o NetworkHashesPerSecond do nó: ele está em
  // unidades de dificuldade-Kaspa, ~2^32 distintas das invocações reais de hash do GPU — comparar
  // os dois dava "266 blocos/dia", irreal (a verdade é blocksFound=0 → ETA de milênios).
  const reward = config.blockRewardKrx;
  const expectedGhPerBlock = (networkDifficulty * 2 ** 32) / 1e9;
  const myGhs = totalCurrHs / GH;
  const expectedTimeToBlockMs =
    myGhs > 0 && networkDifficulty > 0 ? (expectedGhPerBlock / myGhs) * 1000 : 0;
  const expectedBlocksPerDay = expectedTimeToBlockMs > 0 ? 86_400_000 / expectedTimeToBlockMs : 0;
  const dailyEstKrx = reward > 0 ? expectedBlocksPerDay * reward : 0;
  const paidKrx = reward > 0 ? blocksFound * reward : 0;
  const roundShares = workers.reduce((a, w) => a + w.sharesAccepted, 0);
  const onlineWorkers = workers.filter((w) => !w.isOffline).length;

  // Blocos achados expostos no formato "pagamentos" para reuso da tabela (hash = "tx").
  const lastPayments = blocks.map((b) => ({
    timestampMs: now,
    amountKrx: reward,
    tx: b.hash,
  }));

  const data: BridgeData = {
    mode: 'solo',
    isOnline: onlineWorkers > 0,
    hashrateCurrentGhs: totalCurrHs / GH,
    hashrateAverageGhs: totalAvgHs / GH,
    dailyEstKrx,
    balanceKrx,
    immatureKrx: 0, // a bridge não separa immature; a verdade do maturity é on-chain
    matureKrx: balanceKrx,
    paidKrx,
    minThresholdKrx: 0, // solo: não há threshold
    paymentThresholdKrx: 0,
    workersOnline: onlineWorkers,
    workersTotal: workers.length,
    lastShareMs: latestShareMs,
    roundShares,
    workers,
    lastPayments,
    rewardsByPeriods: [],
    fetchedMs: now,
    blocksFound,
    blocks,
    networkHashrateHs,
    networkDifficulty,
    networkBlockCount,
    opoiChallengePasses,
    opoiInferenceResults,
    expectedBlocksPerDay,
    expectedTimeToBlockMs,
    blockRewardKrx: reward,
  };

  cache = { data, fetchedMs: now };
  return data;
}

export function clearBridgeCache(): void {
  cache = null;
  workerStates.clear();
}
