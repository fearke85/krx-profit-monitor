import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --------------- tipos ---------------
interface CycleResult {
  status: number;
  latencyMs: number;
  ok: boolean;
  parseOk: boolean;
  error?: string;
  headers: Record<string, string>;
  data?: {
    hashrateGhs: number;
    balanceKrx: number;
    workersOnline: number;
  };
}

interface IntervalReport {
  intervalMs: number;
  cycles: CycleResult[];
  successCount: number;
  failCount: number;
  latencyMin: number;
  latencyMax: number;
  latencyAvg: number;
  latencyP99: number;
  dataChangedPct: number;
  rateLimitHeaders: boolean;
}

interface Report {
  address: string;
  startedAt: string;
  finishedAt: string;
  diagnosis: CycleResult;
  intervals: IntervalReport[];
  stress?: IntervalReport;
}

// --------------- helpers ---------------
function now(): string {
  return new Date().toISOString();
}

function p99(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.ceil(s.length * 0.99) - 1];
}

function avg(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function ms(t: number): string {
  return `${t.toFixed(1)} ms`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    address: get('--address') || process.env.ADDRESS || '',
    intervals: get('--intervals') || '15000,10000,5000,3000,2000,1000',
    cycles: Number(get('--cycles')) || 20,
    out: get('--out') || '',
    stress: args.includes('--stress'),
    stressCycles: Number(get('--stress-cycles')) || 10,
  };
}

function readHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => { out[k] = v; });
  return out;
}

async function callApi(address: string): Promise<CycleResult> {
  const t0 = Date.now();
  let status = 0;
  let ok = false;
  let parseOk = false;
  let error: string | undefined;
  let headers: Record<string, string> = {};
  let data: CycleResult['data'] = undefined;
  try {
    const res = await fetch('https://baikalmine.com/api/engines/GetPoolMiner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: 'https://baikalmine.com',
        Referer: 'https://baikalmine.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({ type: 'pplns', coin: 'krx', miner: address }),
    });
    status = res.status;
    headers = readHeaders(res);
    ok = res.ok;
    if (ok) {
      try {
        const json = await res.json() as any;
        const e = json?.entity;
        if (e && typeof e.hashrate?.current === 'number') {
          parseOk = true;
          data = {
            hashrateGhs: e.hashrate.current / 1e9,
            balanceKrx: e.stats?.balance ?? 0,
            workersOnline: e.workers?.online ?? 0,
          };
        } else {
          parseOk = false;
          error = 'resposta JSON sem campos esperados';
        }
      } catch {
        parseOk = false;
        error = 'falha ao fazer parse do JSON';
      }
    } else {
      error = `HTTP ${status}`;
    }
  } catch (e: any) {
    error = e?.message ?? 'erro desconhecido';
  }
  return { status, latencyMs: Date.now() - t0, ok, parseOk, error, headers, data };
}

// --------------- fases ---------------
async function phase1Diagnose(address: string, cycles: number): Promise<{ diag: CycleResult; baselineLatencies: number[] }> {
  console.log('\n=== FASE 1: Diagnóstico ===\n');
  console.log('Endereço:', address);
  const diag = await callApi(address);
  console.log('Status:', diag.status);
  console.log('Latência:', ms(diag.latencyMs));
  console.log('Parse OK:', diag.parseOk);
  if (diag.data) {
    console.log('Hashrate:', diag.data.hashrateGhs.toFixed(2), 'GH/s');
    console.log('Saldo:', diag.data.balanceKrx.toFixed(2), 'KRX');
  }
  console.log('\nHeaders de resposta:');
  const relevant = ['retry-after', 'x-ratelimit', 'x-rate-limit', 'cf-ray', 'server'];
  for (const [k, v] of Object.entries(diag.headers)) {
    if (relevant.some(r => k.toLowerCase().includes(r))) {
      console.log(`  ${k}: ${v}`);
    }
  }

  console.log(`\nColetando baseline de ${cycles} ciclos no intervalo atual (15s)...`);
  const baselineLatencies: number[] = [];
  for (let i = 0; i < cycles; i++) {
    const r = await callApi(address);
    baselineLatencies.push(r.latencyMs);
    const sym = r.ok && r.parseOk ? '✓' : '✗';
    console.log(`  [${i + 1}/${cycles}] ${sym} ${r.status} ${ms(r.latencyMs)}${r.error ? ' — ' + r.error : ''}`);
    if (i < cycles - 1) await sleep(15000);
  }
  console.log(`\nBaseline — min: ${ms(Math.min(...baselineLatencies))} | máx: ${ms(Math.max(...baselineLatencies))} | média: ${ms(avg(baselineLatencies))} | p99: ${ms(p99(baselineLatencies))}`);
  return { diag, baselineLatencies };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function phase2Progressive(address: string, intervals: number[], cyclesPerInterval: number): Promise<IntervalReport[]> {
  console.log('\n=== FASE 2: Teste Progressivo de Frequência ===\n');
  const reports: IntervalReport[] = [];
  for (const interval of intervals) {
    console.log(`\n--- Intervalo: ${interval}ms (${cyclesPerInterval} ciclos, ~${((interval * cyclesPerInterval) / 1000).toFixed(0)}s) ---`);
    const results: CycleResult[] = [];
    let prevData: CycleResult['data'] | null = null;
    let changes = 0;
    for (let i = 0; i < cyclesPerInterval; i++) {
      const r = await callApi(address);
      results.push(r);
      if (r.data && prevData) {
        if (r.data.hashrateGhs !== prevData.hashrateGhs || r.data.balanceKrx !== prevData.balanceKrx) {
          changes++;
        }
      }
      if (r.data) prevData = r.data;
      const sym = r.ok && r.parseOk ? '✓' : '✗';
      const changed = r.data && prevData && (r.data.hashrateGhs !== prevData.hashrateGhs || r.data.balanceKrx !== prevData.balanceKrx) ? ' Δ' : '';
      console.log(`  [${i + 1}/${cyclesPerInterval}] ${sym} ${r.status} ${ms(r.latencyMs)}${changed}${r.error ? ' — ' + r.error : ''}`);
      if (i < cyclesPerInterval - 1) await sleep(interval);
    }
    const latencies = results.filter(r => r.ok).map(r => r.latencyMs);
    const report: IntervalReport = {
      intervalMs: interval,
      cycles: results,
      successCount: results.filter(r => r.ok && r.parseOk).length,
      failCount: results.filter(r => !r.ok || !r.parseOk).length,
      latencyMin: latencies.length ? Math.min(...latencies) : 0,
      latencyMax: latencies.length ? Math.max(...latencies) : 0,
      latencyAvg: latencies.length ? avg(latencies) : 0,
      latencyP99: latencies.length ? p99(latencies) : 0,
      dataChangedPct: cyclesPerInterval > 1 ? (changes / (cyclesPerInterval - 1)) * 100 : 0,
      rateLimitHeaders: results.some(r =>
        Object.keys(r.headers).some(k => k.toLowerCase().includes('ratelimit') || k.toLowerCase().includes('retry'))
      ),
    };
    reports.push(report);
    console.log(`  → Sucesso: ${report.successCount}/${cyclesPerInterval} | Falha: ${report.failCount}`);
    console.log(`  → Latência: min ${ms(report.latencyMin)} | máx ${ms(report.latencyMax)} | média ${ms(report.latencyAvg)} | p99 ${ms(report.latencyP99)}`);
    console.log(`  → Dados mudaram: ${report.dataChangedPct.toFixed(0)}% dos ciclos`);
    if (report.failCount > 0) {
      console.log(`  ⚠  ATENÇÃO: Falhas detectadas! Possível rate limit atingido.`);
    }
  }
  return reports;
}

async function phase3Stress(address: string, cycles: number): Promise<IntervalReport> {
  console.log('\n=== FASE 3: Teste de Estresse (burst) ===\n');
  console.log(`Lançando ${cycles} requisições simultâneas...`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: cycles }, () => callApi(address)));
  const elapsed = Date.now() - t0;
  const latencies = results.filter(r => r.ok).map(r => r.latencyMs);
  const report: IntervalReport = {
    intervalMs: 0,
    cycles: results,
    successCount: results.filter(r => r.ok && r.parseOk).length,
    failCount: results.filter(r => !r.ok || !r.parseOk).length,
    latencyMin: latencies.length ? Math.min(...latencies) : 0,
    latencyMax: latencies.length ? Math.max(...latencies) : 0,
    latencyAvg: latencies.length ? avg(latencies) : 0,
    latencyP99: latencies.length ? p99(latencies) : 0,
    dataChangedPct: 0,
    rateLimitHeaders: results.some(r =>
      Object.keys(r.headers).some(k => k.toLowerCase().includes('ratelimit') || k.toLowerCase().includes('retry'))
    ),
  };
  console.log(`  ${cycles} requisições em ${elapsed}ms (${(cycles / (elapsed / 1000)).toFixed(1)} req/s)`);
  console.log(`  Sucesso: ${report.successCount}/${cycles} | Falha: ${report.failCount}`);
  console.log(`  Latência: min ${ms(report.latencyMin)} | máx ${ms(report.latencyMax)} | média ${ms(report.latencyAvg)} | p99 ${ms(report.latencyP99)}`);
  if (report.failCount > 0) {
    console.log(`  ⚠  Rate limit detectado no burst!`);
  }
  return report;
}

function printSummary(report: Report) {
  console.log('\n========================================');
  console.log('   RELATÓRIO FINAL — TESTE DE SATURAÇÃO');
  console.log('========================================\n');
  console.log(`Endereço: ${report.address}`);
  console.log(`Início: ${report.startedAt}`);
  console.log(`Fim:    ${report.finishedAt}`);
  console.log(`Duração total: ${((new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000 / 60).toFixed(1)} minutos`);
  console.log('');

  for (const iv of report.intervals) {
    const safe = iv.failCount === 0 ? '✓ SEGURO' : '✗ COM FALHAS';
    console.log(`  ${String(iv.intervalMs).padStart(5)}ms | ${safe} | ${iv.successCount}/${iv.cycles.length} ok | latência ${ms(iv.latencyAvg)} (p99 ${ms(iv.latencyP99)}) | mudou ${iv.dataChangedPct.toFixed(0)}%`);
  }

  // recomendação
  const safeIntervals = report.intervals.filter(iv => iv.failCount === 0);
  if (safeIntervals.length > 0) {
    const fastest = safeIntervals.reduce((a, b) => a.intervalMs < b.intervalMs ? a : b);
    const mostStable = safeIntervals.reduce((a, b) => a.latencyP99 < b.latencyP99 ? a : b);
    console.log('\n--- Recomendação ---');
    console.log(`  Intervalo mínimo SEM falhas: ${fastest.intervalMs}ms (${fastest.intervalMs / 1000}s)`);
    console.log(`  Intervalo mais estável (menor p99): ${mostStable.intervalMs}ms`);
    console.log(`  Sugestão para operação contínua: ${Math.max(fastest.intervalMs * 2, 5000)}ms (margem 2x)`);
  } else {
    console.log('\n  ⚠  Todos os intervalos tiveram falhas. O intervalo atual de 15s é o recomendado.');
  }

  if (report.stress) {
    console.log('\n--- Teste de Estresse (burst) ---');
    console.log(`  ${report.stress.successCount}/${report.stress.cycles.length} ok | latência média ${ms(report.stress.latencyAvg)}`);
  }

  console.log('');
}

async function main() {
  const opts = parseArgs();
  if (!opts.address) {
    console.error('ERRO: Endereço não informado. Use --address <addr> ou defina ADDRESS no .env');
    process.exit(1);
  }

  const startedAt = now();
  const intervals = opts.intervals.split(',').map(Number).filter(n => n > 0);
  console.log('=== TESTE DE SATURAÇÃO — BAIKAL ENDPOINT ===');
  console.log('Endereço:', opts.address);
  console.log('Intervalos:', intervals.map(i => `${i}ms`).join(', '));
  console.log('Ciclos por intervalo:', opts.cycles);
  if (opts.stress) console.log('Teste de estresse: ATIVADO\n');

  const { diag } = await phase1Diagnose(opts.address, Math.min(opts.cycles, 5));
  const intervalReports = await phase2Progressive(opts.address, intervals, opts.cycles);
  let stressReport: IntervalReport | undefined;
  if (opts.stress) {
    stressReport = await phase3Stress(opts.address, opts.stressCycles);
  }

  const report: Report = {
    address: opts.address,
    startedAt,
    finishedAt: now(),
    diagnosis: diag,
    intervals: intervalReports,
    stress: stressReport,
  };

  printSummary(report);

  if (opts.out) {
    const outPath = resolve(opts.out);
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Relatório salvo em: ${outPath}`);
  }

  console.log('\nTeste concluído.');
}

main().catch(err => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
