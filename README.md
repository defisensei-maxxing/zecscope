# ZecScope

**Did the shielded payment arrive?** ZecScope is a self-hosted, watch-only inspector for Zcash.
Give it a unified full viewing key (UFVK) and it scans the chain with
[Zcash JS](https://github.com/zcashlabs/zcashjs), then shows the balance, incoming payments
and their memos, in a dashboard and over a REST API that other apps can call.

It never sees a spending key, so it can never move funds.

Built for **ZECATHON 2026 · Core & Tooling**.

## Run it

Requires Node **22.23.4** (`nvm use`).

```sh
# API
cd server
cp .env.example .env
npm install
npm run probe     # smoke test: prints the mainnet tip
npm run dev       # http://localhost:8787

# UI (new terminal)
cd web
npm install
npm run dev       # http://localhost:5173
```

### Docker (recommended on macOS/Windows for persistent storage)

```sh
docker build -t zecscope .
docker run -p 8787:8787 -v zecscope-data:/app/data zecscope
```

Without Docker on macOS/Windows, `STORAGE=auto` falls back to in-memory wallet storage:
everything works, but watched keys are forgotten on restart.

## Demo flow

1. In a Zcash wallet (e.g. Zashi), export the unified full viewing key (`uview1…`).
2. Paste it into ZecScope and click **Watch**.
3. Send a tiny amount of ZEC (e.g. 0.001) with a memo to that wallet's shielded address.
4. Watch the payment and memo appear, then `curl localhost:8787/api/watch/<id>/txs`.

## API

| Method | Route | Returns |
|---|---|---|
| GET | `/api/health` | network, endpoint, storage, tip height |
| POST | `/api/watch` | `{ ufvk, label, birthdayHeight? }` → `{ id, label, keyPreview }` |
| GET | `/api/watch` | watched keys |
| GET | `/api/watch/:id/status` | scan progress |
| GET | `/api/watch/:id/balance` | ZEC totals by pool |
| GET | `/api/watch/:id/txs` | transactions with decoded memos |
| DELETE | `/api/watch/:id` | stop watching |
| POST | `/api/sync` | trigger a scan now |
| GET | `/api/tx/:txid` | transaction status and (if watched) outputs + memos |
| POST | `/api/inspect/address` | receivers inside an address |

## How it uses Zcash JS

- `createLightClient` connects to lightwalletd (`zec.rocks`) for tip, server info and tx lookups.
- `createWalletClient` in read-only component form (no broadcaster, no transaction policy).
- `wallet.accounts.import({ viewingKey, viewOnly: true, birthday })` with `resolveBirthday`.
- `wallet.sync`, `getSyncStatus`, `getBalance`, `getHistory`, `getTransaction` for memos.
- `addresses.decode`, `txId`, `formatZec` for validation and exact amounts.

Details: [`docs/ZCASHJS_API.md`](docs/ZCASHJS_API.md). Zcash JS is an experimental SDK.

**Network:** ZecScope runs on mainnet. Zcash JS 0.1.1 predates NU7, which testnet activated at
block 4,465,026, so testnet connections fail with `NETWORK_MISMATCH`. Mainnet activates NU7 on
5 Nov 2026; after that ZecScope needs a Zcash JS release with NU7 support. Because it only ever
holds viewing keys, running on mainnet cannot move funds.

## License

MIT
