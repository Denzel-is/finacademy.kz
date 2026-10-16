import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import app from '../worker/index.ts';
import { finalize } from '../worker/exam.ts';
import { PostgresDatabase, databasePool } from './database.ts';

const pool = databasePool();
const db = new PostgresDatabase(pool);
let draining = false;
let readiness: { checkedAt: number; ready: boolean } | undefined;
let readinessPending: Promise<boolean> | undefined;
async function databaseReady() {
  if (draining) return false;
  if (readiness && performance.now() - readiness.checkedAt < 2000) return readiness.ready;
  if (!readinessPending) readinessPending = pool.query('SELECT 1')
    .then(() => true, () => false)
    .then(ready => { readiness = { checkedAt: performance.now(), ready }; return ready; })
    .finally(() => { readinessPending = undefined; });
  return readinessPending;
}
const assets = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const env = {
  DB: db as unknown as D1Database, APP_NAME: 'Академия финансов', APP_TIMEZONE: 'Asia/Almaty', APP_REVISION: 'secure-20261016-4', BACKGROUND_EXPIRY: true,
  ASSETS: { async fetch(request: Request | URL) {
    const path = decodeURIComponent(new URL(request instanceof Request ? request.url : request.toString()).pathname);
    const target = resolve(assets, '.' + path);
    if (!target.startsWith(assets + sep)) return new Response('Not found', { status: 404 });
    try { return new Response(await readFile(target) as BodyInit); } catch { return new Response('Not found', { status: 404 }); }
  } } as unknown as Fetcher,
};
const server = serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 3000), async fetch(request) {
  const url = new URL(request.url);
  if (draining) return Response.json({ error: 'Сервис обновляется. Повторите запрос через несколько секунд.' }, { status: 503, headers: { 'Retry-After': '3', 'Cache-Control': 'no-store' } });
  if (request.method === 'GET' && url.pathname === '/api/ready') {
    const ready = await databaseReady();
    return Response.json({ ok: ready && !draining }, { status: ready && !draining ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
  // Nginx replaces this header and reaches the process only over loopback.
  const headers = new Headers(request.headers);
  const ip = headers.get('x-real-ip') || 'local';
  headers.delete('cf-connecting-ip'); headers.set('cf-connecting-ip', ip);
  url.protocol = process.env.PUBLIC_ORIGIN?.startsWith('https:') ? 'https:' : 'http:';
  if (process.env.PUBLIC_ORIGIN) url.host = new URL(process.env.PUBLIC_ORIGIN).host;
  return app.fetch(new Request(url, { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body, ...(request.body ? { duplex: 'half' } : {}) } as RequestInit), env);
} });
let sweepPending: Promise<void> | undefined;
async function sweep() {
  try {
    const rows = await db.prepare("SELECT id FROM attempts WHERE status='active' AND deadline IS NOT NULL AND deadline<=? ORDER BY deadline LIMIT 100").bind(new Date().toISOString()).all<{ id: string }>();
    for (const row of rows.results) {
      if (draining) break;
      await finalize(env.DB, row.id);
    }
  } catch (error) { console.error('Expiry sweep failed', (error as Error).message); }
}
const timer = setInterval(() => {
  if (sweepPending || draining) return;
  sweepPending = sweep().finally(() => { sweepPending = undefined; });
}, 30000);
async function shutdown() {
  if (draining) return;
  draining = true;
  clearInterval(timer);
  // systemd allows 35 seconds; stop accepting requests and give committed saves
  // up to 25 seconds to finish before forcing process termination.
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown exceeded 25 seconds');
    process.exit(1);
  }, 25000);
  deadline.unref();
  try {
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    await sweepPending;
    await pool.end();
    clearTimeout(deadline);
    process.exit(0);
  } catch (error) {
    console.error('Graceful shutdown failed', (error as { code?: string }).code || 'shutdown_error');
    process.exit(1);
  }
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
console.log('FinanceAcademy API listening on loopback');
