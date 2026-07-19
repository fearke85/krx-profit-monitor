/**
 * Fachada do sync na main thread: mantém a API pública (startSync, syncStatus,
 * subscribeSync, triggerSync) e delega os ciclos a um Web Worker. Se o worker
 * não puder ser criado, roda o motor inline como fallback.
 */
import { POLL_INTERVAL_MS } from './config';
import {
  runCycle as runCycleInline,
  setStatusListener,
  type SyncPhase,
  type SyncStatus,
} from './syncEngine';

export type { SyncPhase, SyncStatus };

export const syncStatus: SyncStatus = {
  address: null,
  backfillDone: false,
  ingestedTxs: 0,
  pendingTimestamps: 0,
  lastSyncMs: 0,
  totalTxCount: 0,
  running: false,
  phase: 'idle',
  lastError: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

function applyStatus(s: SyncStatus): void {
  Object.assign(syncStatus, s);
  notify();
}

let worker: Worker | null = null;
let workerFailed = false;
let inlineWired = false;

function ensureWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./sync.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { type?: string; status?: SyncStatus } | null;
      if (data?.type === 'status' && data.status) applyStatus(data.status);
    });
    worker.addEventListener('error', (e) => {
      console.warn('[sync] worker falhou — caindo para a main thread:', e.message);
      workerFailed = true;
      worker?.terminate();
      worker = null;
      requestCycle(); // retoma o ciclo perdido, agora inline
    });
    return worker;
  } catch {
    workerFailed = true;
    worker = null;
    return null;
  }
}

function requestCycle(): void {
  const w = ensureWorker();
  if (w) {
    w.postMessage({ type: 'cycle' });
    return;
  }
  if (!inlineWired) {
    setStatusListener(applyStatus);
    inlineWired = true;
  }
  void runCycleInline();
}

export function triggerSync(): void {
  requestCycle();
}

let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startSync(): void {
  if (started) return;
  started = true;
  requestCycle();
  intervalId = setInterval(() => {
    if (document.visibilityState === 'visible') requestCycle();
  }, POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestCycle();
  });
}

export function stopSync(): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  started = false;
}
