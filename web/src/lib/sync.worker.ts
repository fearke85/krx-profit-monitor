/**
 * Web Worker do sync: roda o motor fora da main thread (IndexedDB + parse de
 * milhares de txs sem jank na UI). A fachada (sync.ts) envia {type:'cycle'} e
 * recebe snapshots {type:'status', status} a cada mudança.
 */
import { runCycle, setStatusListener, type SyncStatus } from './syncEngine';

setStatusListener((s: SyncStatus) => self.postMessage({ type: 'status', status: s }));

self.addEventListener('message', (e: MessageEvent) => {
  const data = e.data as { type?: string } | null;
  if (data?.type === 'cycle') void runCycle();
});
