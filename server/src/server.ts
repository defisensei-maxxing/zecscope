import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import * as z from './zcash.js';

// bigint-safe JSON everywhere
const app = Fastify({ logger: { level: 'info', redact: ['req.body.ufvk'] } });
app.setReplySerializer(payload =>
  JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

await app.register(cors, { origin: [config.webOrigin, /^http:\/\/localhost:\d+$/] });

app.setErrorHandler((error: unknown, _req, reply) => {
  const status = (error as { statusCode?: number } | null)?.statusCode ?? 500;
  const message = error instanceof Error ? error.message : String(error);
  reply.status(status).send({ error: z.errorCode(error), message });
});

app.get('/api/health', async () => z.getHealth());

app.post<{ Body: { ufvk?: string; label?: string; birthdayHeight?: number } }>('/api/watch', async (req, reply) => {
  const { ufvk = '', label = 'Watch', birthdayHeight } = req.body ?? {};
  const problem = z.validateViewingKey(ufvk);
  if (problem) return reply.status(400).send({ error: 'INVALID_VIEWING_KEY', message: problem });
  if (birthdayHeight !== undefined && (!Number.isInteger(birthdayHeight) || birthdayHeight < 1)) {
    return reply.status(400).send({ error: 'INVALID_BIRTHDAY', message: 'birthdayHeight must be a positive integer' });
  }
  return reply.status(201).send(await z.addWatch({ ufvk, label: label.slice(0, 60), birthdayHeight }));
});

app.get('/api/watch', async () => z.listWatches());

app.get<{ Params: { id: string } }>('/api/watch/:id/status', async req => z.getStatus(req.params.id));
app.get<{ Params: { id: string } }>('/api/watch/:id/balance', async req => z.getBalance(req.params.id));
app.get<{ Params: { id: string } }>('/api/watch/:id/address', async req => z.getReceiveAddress(req.params.id));
app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/watch/:id/txs', async req =>
  z.listTransactions(req.params.id, Math.min(200, Math.max(1, Number(req.query.limit ?? 50)))));

app.delete<{ Params: { id: string } }>('/api/watch/:id', async (req, reply) => {
  await z.removeWatch(req.params.id);
  return reply.status(204).send();
});

app.post('/api/sync', async () => { await z.syncOnce(); return { ok: true }; });

app.get<{ Params: { txid: string } }>('/api/tx/:txid', async (req, reply) => {
  const result = await z.lookupTransaction(req.params.txid).catch(e => {
    throw Object.assign(e, { statusCode: 400 });
  });
  return result ?? reply.status(404).send({ error: 'NOT_FOUND', message: 'Transaction not found on this endpoint' });
});

app.post<{ Body: { address?: string } }>('/api/inspect/address', async req =>
  z.inspectAddress(req.body?.address ?? '').catch(e => { throw Object.assign(e, { statusCode: 400 }); }));

// Serve the built web app from the same origin when present (hosted demo: one service, no CORS).
const webRoot = resolve(config.webDist);
if (existsSync(join(webRoot, 'index.html'))) {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
    '.woff2': 'font/woff2',
  };
  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent((req.url.split('?')[0] ?? '/'));
    if (path.startsWith('/api/')) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Unknown API route' });
    let file = normalize(join(webRoot, path));
    if (!file.startsWith(webRoot) || !existsSync(file) || !statSync(file).isFile()) file = join(webRoot, 'index.html');
    reply.type(types[extname(file)] ?? 'application/octet-stream');
    return reply.send(await readFile(file));
  });
  app.log.info(`Serving web app from ${webRoot}`);
}

await z.init();
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`ZecScope API on :${config.port} (${config.network}, storage=${config.storage})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await z.shutdown();
    process.exit(0);
  });
}
