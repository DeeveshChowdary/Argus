import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import worker, { runHeartbeat, schedulerHealth, STALE_AFTER_MS } from '../src/worker.js';

let mf, db;
const request = (path, init) => mf.dispatchFetch(`https://argus.test${path}`, init);
before(async () => {
  mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    scriptPath: fileURLToPath(new URL('../src/index.js', import.meta.url)),
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    log: new Log(LogLevel.NONE),
    serviceBindings: { ASSETS: async () => new Response('asset') },
  });
  db = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../migrations/0001_foundation.sql', import.meta.url), 'utf8');
  await db.batch(sql.split(';').filter((s) => s.trim()).map((s) => db.prepare(s)));
});
after(async () => { if (mf) await mf.dispose(); });
beforeEach(async () => {
  await db.batch([db.prepare('DELETE FROM job_runs'), db.prepare('DELETE FROM system_errors')]);
});

async function scheduled(at = Date.now()) {
  const result = await (await mf.getWorker()).scheduled({ scheduledTime: at, cron: '*/5 * * * *' });
  assert.equal(result.outcome, 'ok');
}

test('liveness and readiness distinguish an uninitialized scheduler', async () => {
  assert.equal((await request('/health/live')).status, 200);
  const response = await request('/health');
  assert.equal(response.status, 503);
  const status = await response.json();
  assert.equal(status.database.schema_version, 1);
  assert.equal(status.scheduler.status, 'never_run');
  assert.equal(status.trading_enabled, false);
  assert.equal(status.paper_only, true);
  assert.equal(status.integrations.market, 'not_connected');
});

test('actual Workers scheduled handler writes D1 and makes readiness healthy', async () => {
  await scheduled();
  const response = await request('/api/status');
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.status, 'healthy');
  assert.equal(status.recent_runs.length, 1);
  assert.equal(status.recent_runs[0].status, 'success');
  assert.equal(status.scheduler.last_success.id, status.recent_runs[0].id);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-request-id'));
});

test('retrying a scheduled time is idempotent', async () => {
  const at = Date.now();
  await scheduled(at);
  await scheduled(at);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM job_runs').first()).n, 1);
});

test('out-of-order invocations do not replace a newer heartbeat', async () => {
  const now = Date.now();
  await scheduled(now);
  await scheduled(now - 5 * 60_000);
  const status = await (await request('/api/status')).json();
  assert.equal(status.scheduler.last_success.scheduled_at, new Date(now).toISOString());
});

test('stale scheduled timestamps degrade readiness even when processed now', async () => {
  await scheduled(Date.now() - STALE_AFTER_MS - 1000);
  const response = await request('/health');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).scheduler.status, 'stale');
});

test('retention removes old runs and errors on successful heartbeat', async () => {
  const old = new Date(Date.now() - 8 * 86400000).toISOString();
  await db.prepare("INSERT INTO job_runs VALUES ('old', 'foundation_heartbeat', ?, ?, ?, 'error', 1, 'HEARTBEAT_FAILED')").bind(old, old, old).run();
  await db.prepare("INSERT INTO system_errors VALUES ('old', ?, 'scheduler', 'HEARTBEAT_FAILED', 'old')").bind(old).run();
  await scheduled();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM job_runs').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM system_errors').first()).n, 0);
});

test('a failed write persists a safe rejection, degrades health, and a retry recovers', async () => {
  const at = Date.now();
  let batches = 0;
  const broken = { prepare: db.prepare.bind(db), batch: (...args) => {
    if (batches++ === 0) throw new Error('SECRET_DO_NOT_LOG');
    return db.batch(...args);
  } };
  const logs = [];
  const previous = console.error;
  console.error = (line) => logs.push(line);
  try {
    await assert.rejects(worker.scheduled({ scheduledTime: at }, { DB: broken }), { message: 'HEARTBEAT_FAILED' });
  } finally { console.error = previous; }
  const status = await (await request('/health')).json();
  assert.equal(status.scheduler.status, 'error');
  assert.equal(status.recent_errors[0].code, 'HEARTBEAT_FAILED');
  assert.equal(status.recent_runs[0].status, 'error');
  assert.ok(logs.some((line) => line.includes('heartbeat_failed')));
  assert.ok(!JSON.stringify({ logs, status }).includes('SECRET_DO_NOT_LOG'));
  await scheduled(at);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM job_runs').first()).n, 1);
});

test('complete D1 outage returns a sanitized 503, logs failure, and scheduled handler rejects', async () => {
  const logs = [];
  const previous = console.error;
  console.error = (line) => logs.push(line);
  const env = { DB: { batch() { throw new Error('SECRET_DO_NOT_LOG'); }, prepare() { throw new Error('SECRET_DO_NOT_LOG'); } } };
  try {
    const response = await worker.fetch(new Request('https://argus.test/health?token=SECRET_DO_NOT_LOG'), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'DATABASE_UNAVAILABLE');
    await assert.rejects(runHeartbeat({ scheduledTime: Date.now() }, env), { message: 'HEARTBEAT_FAILED' });
  } finally { console.error = previous; }
  assert.ok(logs.some((line) => line.includes('error_persistence_failed')));
  assert.ok(!JSON.stringify(logs).includes('SECRET_DO_NOT_LOG'));
});

test('schema mismatch fails closed', async () => {
  await db.prepare('INSERT INTO schema_metadata(version) VALUES (999)').run();
  try { assert.equal((await request('/health')).status, 503); }
  finally { await db.prepare('DELETE FROM schema_metadata WHERE version = 999').run(); }
});

test('unknown APIs and all HTTP mutations are rejected without database writes', async () => {
  assert.equal((await request('/api/run')).status, 404);
  assert.equal((await request('/health/unknown')).status, 404);
  assert.equal((await request('/api/orders')).status, 404);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await request('/api/status', { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM job_runs').first()).n, 0);
});

test('HEAD health has no body and unknown asset paths delegate to assets', async () => {
  await scheduled();
  const response = await request('/health', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(await (await request('/')).text(), 'asset');
});

test('future/invalid heartbeat timestamps never count as healthy', () => {
  const now = Date.now();
  assert.equal(schedulerHealth({ status: 'success' }, { scheduled_at: new Date(now + 120000).toISOString() }, now).status, 'stale');
  assert.equal(schedulerHealth(null, { scheduled_at: 'invalid' }, now).status, 'stale');
});

test('deployment config is isolated, paper-only code has no broker integration, and static asset references resolve', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'argus-foundation');
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].database_name, 'argus-foundation-db');
  assert.deepEqual(config.triggers.crons, ['*/5 * * * *']);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
  assert.equal(config.preview_urls, false);
  const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('api.alpaca.markets'));
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const asset of ['styles.css', 'app.js', 'favicon.svg']) {
    assert.ok(html.includes(`/${asset}`));
    assert.ok((await readFile(new URL(`../public/${asset}`, import.meta.url))).length > 0);
  }
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('aria-live="polite"'));
});
