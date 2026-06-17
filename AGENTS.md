# KRX Profit Monitor — AGENTS.md

## Commands

| What | Command |
|------|---------|
| Dev (both) | `npm run dev` — server (:4000) + Vite (:5173, proxies `/api`) |
| Dev server only | `npm run dev -w server` — `tsx watch src/index.ts` |
| Dev web only | `npm run dev -w web` — `vite` |
| Prod (one port) | `npm run build -w web` then `npm start` |
| Typecheck web | Part of `npm run build -w web` (`tsc --noEmit` before vite build) |

No linter/formatter or test commands defined. No `tsc` for server (runs via `tsx`, `noEmit: true`).

## Architecture

- **npm workspaces monorepo**: `server/` (Express + `node:sqlite`) + `web/` (React 18 + Vite + Recharts).
- **Entrypoint**: `server/src/index.ts:8-21` — creates Express app, starts 3 concurrent sync loops:
  - `startSync()` — on-chain tx sync (backfill then incremental, `POLL_INTERVAL_MS` = 1min)
  - `startPoolSync()` — baikalmine pool API every 3s
  - `startBridgeSync()` — solo pool `/metrics` every 15s (only if `SOLO_ENABLED=1`)
- **Database**: SQLite via built-in `node:sqlite` at `data/krx.db`. WAL+EXCLUSIVE pragma for Docker Desktop Windows compat; fallback to DELETE journal.
- **Server .ts files** import with `.js` extension (e.g. `./config.js`) — tsx convention, not a mistake.
- **Address format**: `keryx:...` (bech32). Set via dashboard UI, persisted in DB. NOT in `.env`.
- **Price source**: nonkyc.io `KRX_USDT` ticker — no historical candles available. Price snapshots frozen per day while running.

## Non-obvious

- **"Received" KRX = net positive per tx** (outputs minus inputs from same wallet). UTXO consolidations (net ~0) are excluded.
- **Day closes in America/Sao_Paulo** via `Intl`, not UTC.
- **Three data sources** feed the dashboard: on-chain (keryx explorer), pool (baikalmine), solo (local bridge `/metrics`). Each has independent sync loop and history.
- **No build step for server** — `tsx` runs TS directly. `dist/` dirs exist for web only.
- **Server Dockerfile removes npm CLI** post-install to reduce CVE surface.
- **Reset**: delete `data/krx.db*` while server is stopped.
