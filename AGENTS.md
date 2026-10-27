# ZecScope: rules for coding agents

ZecScope is a watch-only shielded payment inspector for Zcash (ZECATHON, Core & Tooling track).
Paste a UFVK → it scans → shows balance, incoming payments and memos, plus a REST API.

## Stack
- Node **22.23.4** exactly (zcash.js `engines`). TypeScript run with `tsx`.
- `server/`: Fastify 5 + `@zcashlabs/zcash.js@0.1.1` (pinned, never `^`).
- `web/`: Vite + React 19 + Tailwind 4. Talks to the API only; never imports zcash.js.

## Hard rules
1. **Never guess the zcash.js API.** Read `docs/ZCASHJS_API.md` first, then confirm against
   `server/node_modules/@zcashlabs/zcash.js/dist/src/index.d.ts`. The `.d.ts` wins.
2. **All SDK calls live in `server/src/zcash.ts`.** Routes in `server.ts` call its functions.
3. **Watch-only.** Accept UFVKs only (testnet prefix `uviewtest1`). Reject seeds, spending keys
   and UIVKs with HTTP 400. Never add a broadcaster, transaction policy, signer, propose or send.
4. **Never log or return a full viewing key.** Only the `keyPreview` (first 14 + last 8 chars).
5. **Money is bigint zatoshis** internally; JSON returns ZEC strings via `formatZec`.
6. **Testnet only** for the hackathon.
7. If a live testnet call fails because of network/proxy limits in your sandbox, **stop and report**.
   Do not loop on it. The human will run live checks locally in Docker.
8. Before finishing: `npm run typecheck` in `server/` and `web/` must pass.

## Commands
- `cd server && npm run probe`: SDK smoke test (prints testnet tip + server info)
- `cd server && npm run dev`: API on :8787
- `cd web && npm run dev`: UI on :5173 (proxies `/api` to :8787)

## API
GET  /api/health · POST /api/watch {ufvk,label,birthdayHeight?} · GET /api/watch
GET  /api/watch/:id/status · /balance · /txs · DELETE /api/watch/:id
POST /api/sync · GET /api/tx/:txid · POST /api/inspect/address {address}

## Status
The server and web code were written against the zcash.js 0.1.1 source but have **not yet been
installed, typechecked or run** (npm was unreachable when the repo was scaffolded).
First job: install, typecheck, fix any type mismatches, run `npm run probe`.
