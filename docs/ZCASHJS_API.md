# Zcash JS API map for ZecScope

Verified against `zcashlabs/zcashjs` at commit `de75201` (package version **0.1.1**,
26 Oct 2026) by reading `src/types.ts`, `docs/api/*.md` and `examples/testnet/`.
If anything here disagrees with `node_modules/@zcashlabs/zcash.js/dist/src/index.d.ts`,
the `.d.ts` wins.

## Facts that shape the design

- **Node must be exactly 22.23.4** (`engines` field).
- **Storage**: `{ kind: 'node-filesystem', path }` needs Linux + `/usr/bin/flock`.
  `{ kind: 'memory' }` has **no flock dependency** and works on any OS (state is lost on close).
  ZecScope picks filesystem on Linux and memory elsewhere (override with `STORAGE=`).
- **Pools** are `transparent | sapling | ironwood`. Ironwood uses the *Orchard receiver
  encoding*; `addresses.decode` reports it as `'orchard'`. There is no `orchard` pool name.
- **Amounts** are `bigint` zatoshis. `JSON.stringify` can't serialize bigint: convert with
  `formatZec()` or `.toString()`.
- Light endpoint for testnet: `https://testnet.zec.rocks:443` (used by the official example).
  Node uses native gRPC, browsers need gRPC-Web + CORS. ZecScope keeps all calls in Node.
- Testnet birthday floor used by the official example: `280000`.

## Calls ZecScope uses

```ts
import {
  createLightClient, createWalletClient, resolveBirthday,
  formatZec, parseZec, txId, addresses,
} from '@zcashlabs/zcash.js';
import type {
  LightClient, WalletClient, AccountRecord, AccountId, HistoryEntry,
  WalletTransaction, SyncStatus, WalletBalance, Memo,
} from '@zcashlabs/zcash.js';
```

### Light client
```ts
const light = await createLightClient('https://testnet.zec.rocks:443', { network: 'testnet' });
await light.getTip();          // { height, hash, sourceId, observedAt }
await light.getServerInfo();   // { networkIdentity, vendor, version, protocolRevision, ... }
await light.getTransaction({ txid: txId(hex) }); // PublicTransaction | null: { txid, raw: Uint8Array, observation }
```
`createLightClient(endpoint)` defaults to **mainnet**. Always pass `{ network: 'testnet' }`.

### Read-only wallet (no broadcaster, no transaction policy = cannot spend)
```ts
const wallet = createWalletClient({
  network: light.network,
  light,
  storage: { kind: 'node-filesystem', path: './data/wallet' }, // or { kind: 'memory' }
  confirmations: { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false },
  observation: { pollIntervalMs: 5000, maxBufferedUpdates: 16 },
  recovery: { mode: 'offline' },
});
// ...
await wallet.close(); // always
```

### Watch-only account import
```ts
const birthday = await resolveBirthday({ light, firstScanHeight }); // or 'fullScan' (slow)
const account: AccountRecord = await wallet.accounts.import({
  viewingKey: ufvk,   // UFVK only; UIVK is rejected
  birthday,
  viewOnly: true,
  name: label,
});
await wallet.accounts.list();                       // AccountRecord[] { id, name, birthdayHeight, ... }
await wallet.accounts.get({ accountId });
await wallet.accounts.remove({ accountId, acknowledge: 'deletes-local-history' });
```

### Sync
```ts
const status: SyncStatus = await wallet.sync({ signal: AbortSignal.timeout(180_000) });
status.targetReached;                // check this, a resolved promise is not completion
await wallet.getSyncStatus();        // local read, no network
// SyncStatus.scan: { tipHeight, fullyScannedHeight, maxScannedHeight, scanComplete }
// SyncStatus.activity: 'idle' | 'running' | 'stopped' | 'failed'; lastError
```
Only one finite `sync()` may run at a time: guard it with a mutex.
`SYNC_REQUIRED` and `CURSOR_STALE` errors are retryable: just try again next tick.

### Balance, history, memos
```ts
const bal: WalletBalance = await wallet.getBalance({ accountId });
bal.amounts === null      // means "not available yet", NOT zero
formatZec(bal.amounts.total);
bal.amounts.sapling.total; bal.amounts.ironwood.total; bal.amounts.transparent.regular.total;

const page = await wallet.getHistory({ accountId, limit: 50 }); // max 200, cursor = page.nextCursor
// HistoryEntry: { txid, balanceDelta, totalReceived, totalSpent, fee, minedHeight, blockTime, pools }

const tx: WalletTransaction | null = await wallet.getTransaction({ txid });
// tx.outputs[]: { pool, value, address, memo: Memo, isChange, receivingAccountIds, sendingAccountIds }
// Memo = { kind: 'empty' | 'unknown' } | { kind: 'text', text } | { kind: 'binary', bytes }
```
Memos for incoming payments: `tx.outputs.filter(o => o.receivingAccountIds.includes(accountId) && !o.isChange)`.

### Address inspection (bonus endpoint)
```ts
const decoded = await addresses.decode({ network: light.network, address });
// { knownReceivers: ReceiverType[], unknownTypecodes: number[], ... }
```

## Not used (on purpose)
- `createPublicClient` needs a JSON-RPC (zcashd/zebrad) endpoint; tx lookup goes through the light client instead.
- Proposals, signers, `send`, `broadcast`: ZecScope is watch-only.
