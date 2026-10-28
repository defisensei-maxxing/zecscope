// The ONLY file that imports @zcashlabs/zcash.js. Everything else calls these functions.
// API reference: ../../docs/ZCASHJS_API.md (verified against zcash.js 0.1.1 source).
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addresses, createLightClient, createWalletClient, formatZec, resolveBirthday, txId,
} from '@zcashlabs/zcash.js';
import type {
  AccountId, AccountRecord, LightClient, Memo, SyncStatus, WalletClient,
} from '@zcashlabs/zcash.js';
import { config } from './config.js';

let light: LightClient;
let wallet: WalletClient;
let syncing: Promise<void> | null = null;
let lastSyncError: string | null = null;
let timer: NodeJS.Timeout | undefined;

export async function init() {
  light = await createLightClient(config.endpoint, { network: config.network });
  const storage = config.storage === 'filesystem'
    ? { kind: 'node-filesystem' as const, path: join(config.dataDir, 'wallet') }
    : { kind: 'memory' as const };
  if (storage.kind === 'node-filesystem') await mkdir(config.dataDir, { recursive: true });

  // Component form with no broadcaster and no transactionPolicy: scanning only, spending impossible.
  wallet = await createWalletClient({
    network: light.network,
    light,
    storage,
    confirmations: { trusted: 3, untrusted: 3, allowZeroConfirmationShielding: false },
    observation: { pollIntervalMs: 5000, maxBufferedUpdates: 16 },
    recovery: { mode: 'offline' },
  });

  timer = setInterval(() => { void syncOnce(); }, config.syncIntervalMs);
  void syncOnce();
}

export async function shutdown() {
  clearInterval(timer);
  await syncing?.catch(() => {});
  await wallet?.close();
}

/** Mutex: only one finite sync may run at a time. Retryable errors just wait for the next tick. */
export function syncOnce(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const accounts = await wallet.accounts.list();
      if (accounts.length === 0) return;
      const status = await wallet.sync({ signal: AbortSignal.timeout(180_000) });
      lastSyncError = status.lastError ? String(status.lastError.code) : null;
    } catch (error) {
      lastSyncError = errorCode(error);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export async function getHealth() {
  const [tip, server] = await Promise.all([light.getTip(), light.getServerInfo()]);
  return {
    network: config.network,
    endpoint: config.endpoint,
    storage: config.storage,
    tipHeight: tip.height,
    server: { vendor: server.vendor, version: server.version, network: server.networkIdentity },
  };
}

// ---------- watch-only accounts ----------

export function validateViewingKey(input: string): string | null {
  const key = input.trim();
  if (/\s/.test(key)) return 'Looks like a seed phrase. Only a unified full viewing key (UFVK) is accepted.';
  const prefix = config.network === 'testnet' ? 'uviewtest1' : 'uview1';
  if (key.startsWith('secret') || key.includes('xsk') ) return 'Spending keys are never accepted. Use a viewing key.';
  if (key.startsWith('uivk')) return 'Incoming viewing keys (UIVK) are not supported. Use a full viewing key (UFVK).';
  if (!key.startsWith(prefix)) return `Expected a ${config.network} UFVK starting with "${prefix}".`;
  return null;
}

export async function addWatch(args: { ufvk: string; label: string; birthdayHeight?: number }) {
  const tip = await light.getTip();
  const floor = config.network === 'testnet' ? 280_000 : 419_200;
  const firstScanHeight = Math.max(floor, args.birthdayHeight ?? tip.height - 1000);
  const birthday = await resolveBirthday({ light, firstScanHeight });
  const account = await wallet.accounts.import({
    viewingKey: args.ufvk.trim(),
    birthday,
    viewOnly: true,
    name: args.label,
  });
  void syncOnce();
  return toWatch(account, args.ufvk.trim());
}

const keyPreviews = new Map<string, string>(); // accountId -> "uviewtest1abc…xyz" (never the full key)

function toWatch(account: AccountRecord, ufvk?: string) {
  if (ufvk) keyPreviews.set(account.id, `${ufvk.slice(0, 14)}…${ufvk.slice(-8)}`);
  return {
    id: account.id,
    label: account.name ?? 'Untitled',
    birthdayHeight: account.birthdayHeight,
    keyPreview: keyPreviews.get(account.id) ?? null,
  };
}

export async function listWatches() {
  return (await wallet.accounts.list()).map(a => toWatch(a));
}

async function account(id: string) {
  const found = await wallet.accounts.get({ accountId: id as AccountId });
  if (!found) throw Object.assign(new Error('Watch not found'), { statusCode: 404 });
  return found;
}

export async function removeWatch(id: string) {
  const a = await account(id);
  await syncing?.catch(() => {});
  await wallet.accounts.remove({ accountId: a.id, acknowledge: 'deletes-local-history' });
  keyPreviews.delete(a.id);
}

export async function getStatus(id: string) {
  const a = await account(id);
  const s: SyncStatus = await wallet.getSyncStatus();
  const tip = s.scan.tipHeight ?? s.target?.height ?? null;
  const scanned = s.scan.fullyScannedHeight;
  const span = tip !== null ? Math.max(1, tip - a.birthdayHeight) : null;
  const percent = tip !== null && scanned !== null && span !== null
    ? Math.min(100, Math.max(0, Math.round(((scanned - a.birthdayHeight) / span) * 100)))
    : 0;
  return {
    activity: s.activity,
    scannedHeight: scanned,
    tipHeight: tip,
    percent,
    synced: s.scan.scanComplete === true || (s.targetReached && percent >= 100),
    lastError: lastSyncError,
  };
}

export async function getBalance(id: string) {
  const a = await account(id);
  const b = await wallet.getBalance({ accountId: a.id });
  if (b.amounts === null) return { available: false as const };
  return {
    available: true as const,
    totalZec: formatZec(b.amounts.total),
    byPool: {
      ironwood: formatZec(b.amounts.ironwood.total),
      sapling: formatZec(b.amounts.sapling.total),
      transparent: formatZec(b.amounts.transparent.regular.total + b.amounts.transparent.coinbase.total),
    },
  };
}

export async function listTransactions(id: string, limit = 50) {
  const a = await account(id);
  const page = await wallet.getHistory({ accountId: a.id, limit });
  return Promise.all(page.items.map(async entry => {
    const tx = await wallet.getTransaction({ txid: entry.txid });
    const incoming = (tx?.outputs ?? []).filter(
      o => o.receivingAccountIds.includes(a.id) && o.isChange !== true,
    );
    return {
      txid: entry.txid,
      height: entry.minedHeight,
      time: entry.blockTime,
      direction: entry.totalReceived > 0n && entry.totalSpent === 0n ? 'in' : entry.totalSpent > 0n ? 'out' : 'other',
      amountZec: formatZec(entry.balanceDelta < 0n ? -entry.balanceDelta : entry.balanceDelta),
      negative: entry.balanceDelta < 0n,
      pools: entry.pools,
      memos: incoming.map(o => memoToJson(o.memo)).filter(m => m.type !== 'empty'),
    };
  }));
}

function memoToJson(memo: Memo) {
  if (memo.kind === 'text') return { type: 'text' as const, value: memo.text };
  if (memo.kind === 'binary') return { type: 'hex' as const, value: Buffer.from(memo.bytes).toString('hex') };
  return { type: memo.kind };
}

// ---------- lookups ----------

export async function lookupTransaction(hex: string) {
  const id = txId(hex); // throws on invalid display-order hex
  const ours = await wallet.getTransaction({ txid: id });
  const pub = await light.getTransaction({ txid: id });
  if (!pub && !ours) return null;
  return {
    txid: id,
    sizeBytes: pub?.raw.length ?? ours?.raw?.length ?? null,
    state: pub?.observation.state ?? 'unknown',
    inclusion: pub?.observation.inclusion ?? null,
    watched: ours !== null,
    outputs: (ours?.outputs ?? []).map(o => ({
      pool: o.pool,
      valueZec: o.value === null ? null : formatZec(o.value),
      isChange: o.isChange,
      memo: memoToJson(o.memo),
    })),
  };
}

export async function inspectAddress(address: string) {
  const decoded = await addresses.decode({ network: light.network, address: address.trim() });
  // 'orchard' receiver = the Ironwood pool in zcash.js
  return { address: decoded.encoded, knownReceivers: decoded.knownReceivers, unknownTypecodes: decoded.unknownTypecodes };
}

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}
