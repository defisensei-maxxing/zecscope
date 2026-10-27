import { useCallback, useEffect, useState } from 'react';
import { api, type Balance, type Health, type Status, type Tx, type Watch } from './api';

// Tiny hash router: #/  ·  #/w/<id>  ·  #/tx/<txid?>
function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.slice(1).split('/').filter(Boolean);
}

function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => fn().then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => alive && setError(String(e.message ?? e)));
    run();
    const t = setInterval(run, ms);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

const short = (s: string, n = 8) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="text-xs text-neutral-400 hover:text-zec"
      onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

function Header({ health }: { health: Health | null }) {
  return (
    <header className="flex items-center justify-between py-6">
      <a href="#/" className="text-lg font-semibold">
        <span className="text-zec">Zec</span>Scope
      </a>
      <nav className="flex items-center gap-4 text-sm text-neutral-400">
        <a href="#/tx" className="hover:text-neutral-100">Tx lookup</a>
        <span className="rounded-full border border-neutral-800 px-2.5 py-1 font-mono text-xs">
          {health ? `${health.network} · tip ${health.tipHeight.toLocaleString()}` : 'connecting…'}
        </span>
      </nav>
    </header>
  );
}

function Home({ tip }: { tip: number | null }) {
  const [ufvk, setUfvk] = useState('');
  const [label, setLabel] = useState('');
  const [birthday, setBirthday] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: watches } = usePoll(api.watches, 10_000, []);

  useEffect(() => { if (tip && !birthday) setBirthday(String(tip - 1000)); }, [tip, birthday]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const w = await api.addWatch({ ufvk, label: label || 'Watch', birthdayHeight: birthday ? Number(birthday) : undefined });
      setUfvk('');
      window.location.hash = `#/w/${w.id}`;
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Did the shielded payment arrive?</h1>
        <p className="text-neutral-400">
          Paste a unified full viewing key. ZecScope scans for incoming payments and memos. It can see, never spend.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-800 p-5">
        <textarea
          value={ufvk} onChange={e => setUfvk(e.target.value)} rows={3}
          placeholder="uviewtest1…"
          className="w-full resize-none rounded-lg bg-neutral-900 p-3 font-mono text-sm outline-none focus:ring-1 focus:ring-zec"
        />
        <div className="flex flex-wrap gap-3">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label"
            className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-zec" />
          <input value={birthday} onChange={e => setBirthday(e.target.value.replace(/\D/g, ''))} placeholder="Birthday height"
            className="w-40 rounded-lg bg-neutral-900 px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-zec" />
          <button onClick={submit} disabled={busy || !ufvk.trim()}
            className="rounded-lg bg-zec px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40">
            {busy ? 'Importing…' : 'Watch'}
          </button>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <p className="text-xs text-neutral-500">Only viewing keys are accepted. Seed phrases and spending keys are rejected.</p>
      </section>

      {watches && watches.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm uppercase tracking-wide text-neutral-500">Watching</h2>
          <ul className="divide-y divide-neutral-900 rounded-xl border border-neutral-800">
            {watches.map(w => (
              <li key={w.id}>
                <a href={`#/w/${w.id}`} className="flex justify-between px-4 py-3 hover:bg-neutral-900">
                  <span>{w.label}</span>
                  <span className="font-mono text-xs text-neutral-500">{w.keyPreview ?? `from ${w.birthdayHeight}`}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const status = usePoll<Status>(() => api.status(id), 3_000, [id]);
  const balance = usePoll<Balance>(() => api.balance(id), 10_000, [id]);
  const txs = usePoll<Tx[]>(() => api.txs(id), 10_000, [id]);
  const s = status.data;

  const remove = useCallback(async () => {
    if (!confirm('Stop watching and delete local history for this key?')) return;
    await api.removeWatch(id);
    window.location.hash = '#/';
  }, [id]);

  if (status.error) return <p className="text-red-400">{status.error}</p>;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex justify-between text-sm text-neutral-400">
          <span>{s?.synced ? 'Synced' : `Scanning… ${s?.percent ?? 0}%`}</span>
          <span className="font-mono">{s?.scannedHeight ?? '–'} / {s?.tipHeight ?? '–'}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-900">
          <div className="h-full bg-zec transition-all" style={{ width: `${s?.synced ? 100 : s?.percent ?? 0}%` }} />
        </div>
        {s?.lastError && <p className="text-xs text-amber-400">Last sync issue: {s.lastError} (retrying)</p>}
      </section>

      <section className="rounded-xl border border-neutral-800 p-5">
        <p className="text-sm text-neutral-500">Balance</p>
        <p className="font-mono text-3xl">
          {balance.data?.available ? `${balance.data.totalZec} ZEC` : '—'}
        </p>
        {balance.data?.available && (
          <p className="mt-1 font-mono text-xs text-neutral-500">
            {Object.entries(balance.data.byPool).map(([p, v]) => `${p} ${v}`).join(' · ')}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-wide text-neutral-500">Transactions</h2>
          <Copy text={api.apiUrl(`/api/watch/${id}/txs`)} label="Copy API URL" />
        </div>
        {!txs.data?.length ? (
          <p className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
            Nothing yet. Send testnet ZEC with a memo to this wallet and it will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-900 rounded-xl border border-neutral-800">
            {txs.data.map(t => (
              <li key={t.txid} className="space-y-1 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className={`font-mono ${t.negative ? 'text-neutral-400' : 'text-emerald-400'}`}>
                    {t.negative ? '−' : '+'}{t.amountZec} ZEC
                  </span>
                  <span className="font-mono text-xs text-neutral-500">
                    {t.height ? `#${t.height}` : 'pending'}
                    {t.time ? ` · ${new Date(t.time * 1000).toLocaleString()}` : ''}
                  </span>
                </div>
                {t.memos.map((m, i) => <MemoCell key={i} text={m.value ?? `(${m.type} memo)`} hex={m.type === 'hex'} />)}
                <div className="flex items-center gap-3">
                  <a href={`#/tx/${t.txid}`} className="font-mono text-xs text-neutral-500 hover:text-zec">{short(t.txid)}</a>
                  <Copy text={t.txid} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button onClick={remove} className="text-xs text-neutral-500 hover:text-red-400">Stop watching</button>
    </div>
  );
}

function MemoCell({ text, hex }: { text: string; hex: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 90;
  return (
    <p onClick={() => long && setOpen(!open)}
      className={`rounded-md bg-neutral-900 px-3 py-2 text-sm ${hex ? 'font-mono text-xs' : ''} ${long ? 'cursor-pointer' : ''}`}>
      {open || !long ? text : `${text.slice(0, 90)}…`}
    </p>
  );
}

function TxLookup({ initial }: { initial?: string }) {
  const [txid, setTxid] = useState(initial ?? '');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (id = txid) => {
    setErr(null); setResult(null);
    try { setResult(await api.tx(id.trim())); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (initial) void run(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initial]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Transaction lookup</h1>
      <div className="flex gap-3">
        <input value={txid} onChange={e => setTxid(e.target.value)} placeholder="txid"
          className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-zec" />
        <button onClick={() => run()} className="rounded-lg bg-zec px-4 py-2 text-sm font-medium text-neutral-950">Look up</button>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      {result && (
        <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900 p-4 font-mono text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const { data: health, error } = usePoll(api.health, 15_000, []);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <Header health={health} />
      {error && !health && <p className="mb-6 text-sm text-red-400">API unreachable: {error}</p>}
      {route[0] === 'w' && route[1] ? <Detail id={route[1]} />
        : route[0] === 'tx' ? <TxLookup initial={route[1]} />
          : <Home tip={health?.tipHeight ?? null} />}
    </div>
  );
}
