const BASE = import.meta.env.VITE_API_URL ?? '';

export type Health = {
  network: string; endpoint: string; storage: string; demoWatchId: string | null;
  live: boolean; tipHeight: number | null; liveError: string | null;
};
export type Watch = { id: string; label: string; birthdayHeight: number; keyPreview: string | null };
export type Status = {
  activity: string; scannedHeight: number | null; tipHeight: number | null;
  percent: number; synced: boolean; lastError: string | null;
};
export type Balance =
  | { available: false }
  | { available: true; totalZec: string; byPool: Record<string, string> };
export type Memo = { type: 'text' | 'hex' | 'unknown' | 'empty'; value?: string };
export type Tx = {
  txid: string; height: number | null; time: number | null; direction: 'in' | 'out' | 'other';
  amountZec: string; negative: boolean; pools: string[]; memos: Memo[];
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  health: () => call<Health>('/api/health'),
  watches: () => call<Watch[]>('/api/watch'),
  addWatch: (body: { ufvk: string; label: string; birthdayHeight?: number }) =>
    call<Watch>('/api/watch', { method: 'POST', body: JSON.stringify(body) }),
  removeWatch: (id: string) => call<void>(`/api/watch/${id}`, { method: 'DELETE' }),
  status: (id: string) => call<Status>(`/api/watch/${id}/status`),
  balance: (id: string) => call<Balance>(`/api/watch/${id}/balance`),
  txs: (id: string) => call<Tx[]>(`/api/watch/${id}/txs`),
  tx: (txid: string) => call<Record<string, unknown>>(`/api/tx/${txid}`),
  apiUrl: (path: string) => (BASE || window.location.origin) + path,
};
