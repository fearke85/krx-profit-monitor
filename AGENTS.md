# KRX Profit Monitor — AGENTS.md

## Commands

| What | Command |
|------|---------|
| Dev | `npm run dev` — Vite (:5173) + `/api/price` middleware |
| Build | `npm run build` — `tsc --noEmit` + vite build → `web/dist` |
| Preview | `npm run preview` |

Deploy: Vercel Root Directory = `web` (static `dist` + serverless `api/price.ts`).

## Architecture

- **Front-only SPA**: `web/` (React 18 + Vite + Recharts + Dexie/IndexedDB).
- **Data**: each browser keeps its own IndexedDB (`krx-profit-monitor`) — txs, price snapshots/history, meta (wallet).
- **Sync**: client-side loop in `web/src/lib/sync.ts` (backfill → incremental → tx details), runs while the tab is open (`POLL_INTERVAL_MS` = 1min; also on visibility).
- **APIs**:
  - Keryx explorer — fetched **directly from the browser** (`access-control-allow-origin: *`).
  - nonkyc price — **no CORS**; proxied via `GET /api/price` (Vercel serverless in prod, Vite middleware in dev).
- **Address format**: `keryx:...` (bech32). Set via dashboard UI, persisted in IndexedDB. NOT in `.env`.
- **Day closes** in `America/Sao_Paulo` via `Intl`.
- **"Received" KRX** = net positive per tx (outputs − inputs from same wallet). UTXO consolidations excluded.
- **Strategy ETA** uses recent on-chain daily average (last 7 days with receipts).

## Vercel

- Project **Root Directory** must be `web`.
- `web/vercel.json`: build `npm run build`, output `dist`, SPA rewrite + `/api/*`.
- Optional env: `NONKYC_URL` (defaults to nonkyc KRX_USDT ticker).

## Legacy

- `server/` (Express + SQLite) is leftover from the previous architecture and is **not** used by the current app. Safe to ignore or delete later.
- **Reset client data**: DevTools → Application → IndexedDB → delete `krx-profit-monitor`.
