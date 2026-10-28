const JOB = 'foundation_heartbeat';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const STALE_AFTER_MS = 12 * 60 * 1000;
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

// Never pass request objects, environment bindings, arbitrary errors, or payloads here.
export function log(level, event, fields = {}) {
  const record = { level, event };
  for (const key of ['request_id', 'run_id', 'code', 'duration_ms']) {
    if (fields[key] !== undefined) record[key] = fields[key];
  }
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(record));
}

function json(data, status = 200, head = false, extraHeaders = {}) {
  return new Response(head ? null : JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function schedulerHealth(latest, success, now = Date.now()) {
  if (!success) return { status: latest?.status === 'error' ? 'error' : 'never_run', stale: true, age_seconds: null };
  const age = now - Date.parse(success.scheduled_at);
  const stale = !Number.isFinite(age) || age < -60_000 || age > STALE_AFTER_MS;
  return {
    status: latest?.status === 'error' ? 'error' : stale ? 'stale' : 'healthy',
    stale,
    age_seconds: Number.isFinite(age) ? Math.max(0, Math.floor(age / 1000)) : null,
  };
}

async function readStatus(env) {
  const [schema, latest, success, runs, errors] = await env.DB.batch([
    env.DB.prepare('SELECT version FROM schema_metadata ORDER BY version DESC LIMIT 1'),
    env.DB.prepare('SELECT * FROM job_runs ORDER BY scheduled_at DESC LIMIT 1'),
    env.DB.prepare("SELECT * FROM job_runs WHERE status = 'success' ORDER BY scheduled_at DESC LIMIT 1"),
    env.DB.prepare('SELECT * FROM job_runs ORDER BY scheduled_at DESC LIMIT 15'),
    env.DB.prepare('SELECT occurred_at, component, code, run_id FROM system_errors ORDER BY occurred_at DESC LIMIT 10'),
  ]);
  if (schema.results[0]?.version !== 1) throw new Error('SCHEMA_MISMATCH');
  const lastRun = latest.results[0] ?? null;
  const lastSuccess = success.results[0] ?? null;
  const scheduler = schedulerHealth(lastRun, lastSuccess);
  return {
    service: 'argus', version: '0.1.0', milestone: 0,
    status: scheduler.status === 'healthy' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    operating_mode: 'live_scan_no_trade', paper_only: true, trading_enabled: false,
    planned_paper_capital_usd: 5000,
    database: { status: 'connected', schema_version: 1 },
    scheduler: { ...scheduler, cron: '*/5 * * * *', stale_after_seconds: STALE_AFTER_MS / 1000, last_run: lastRun, last_success: lastSuccess },
    integrations: { market: 'not_connected', sec: 'not_connected', reddit: 'not_connected', llm: 'not_connected', broker: 'not_connected' },
    recent_runs: runs.results,
    recent_errors: errors.results,
  };
}

export async function runHeartbeat(controller, env) {
  const started = Date.now();
  const scheduledAt = new Date(controller.scheduledTime).toISOString();
  const runId = `${JOB}:${scheduledAt}`;
  try {
    const schema = await env.DB.prepare('SELECT version FROM schema_metadata ORDER BY version DESC LIMIT 1').first();
    if (schema?.version !== 1) throw new Error('SCHEMA_MISMATCH');
    const finished = new Date().toISOString();
    const cutoff = new Date(started - RETENTION_MS).toISOString();
    // D1 batch is transactional: a success record means all housekeeping writes passed.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO job_runs (id, job, scheduled_at, started_at, finished_at, status, duration_ms)
        VALUES (?, ?, ?, ?, ?, 'success', ?)
        ON CONFLICT(id) DO UPDATE SET status = 'success', finished_at = excluded.finished_at,
          duration_ms = excluded.duration_ms, error_code = NULL WHERE job_runs.status = 'error'`)
        .bind(runId, JOB, scheduledAt, new Date(started).toISOString(), finished, Date.now() - started),
      env.DB.prepare('DELETE FROM job_runs WHERE scheduled_at < ?').bind(cutoff),
      env.DB.prepare('DELETE FROM system_errors WHERE occurred_at < ?').bind(cutoff),
    ]);
    log('info', 'heartbeat_succeeded', { run_id: runId, duration_ms: Date.now() - started });
  } catch {
    log('error', 'heartbeat_failed', { run_id: runId, code: 'HEARTBEAT_FAILED' });
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO job_runs (id, job, scheduled_at, started_at, finished_at, status, duration_ms, error_code)
          VALUES (?, ?, ?, ?, ?, 'error', ?, 'HEARTBEAT_FAILED') ON CONFLICT(id) DO NOTHING`)
          .bind(runId, JOB, scheduledAt, new Date(started).toISOString(), new Date().toISOString(), Date.now() - started),
        env.DB.prepare(`INSERT OR IGNORE INTO system_errors (id, occurred_at, component, code, run_id)
          VALUES (?, ?, 'scheduler', 'HEARTBEAT_FAILED', ?)`)
          .bind(runId, new Date().toISOString(), runId),
      ]);
    } catch {
      // D1 outage can also prevent error persistence. Observability remains the fallback.
      log('error', 'error_persistence_failed', { run_id: runId, code: 'ERROR_PERSISTENCE_FAILED' });
    }
    // Only a stable code reaches platform exception logs; never the original exception.
    throw new Error('HEARTBEAT_FAILED');
  }
}

export default {
  async fetch(request, env) {
    const head = request.method === 'HEAD';
    if (request.method !== 'GET' && !head) {
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405, false, { Allow: 'GET, HEAD' });
    }
    const path = new URL(request.url).pathname;
    if (path === '/health/live') return json({ service: 'argus', status: 'alive', paper_only: true, trading_enabled: false }, 200, head);
    if (path === '/health' || path === '/api/status') {
      const requestId = crypto.randomUUID();
      try {
        const status = await readStatus(env);
        return json(status, status.status === 'healthy' ? 200 : 503, head, { 'X-Request-ID': requestId });
      } catch {
        log('error', 'status_failed', { request_id: requestId, code: 'DATABASE_UNAVAILABLE' });
        return json({ service: 'argus', status: 'unhealthy', timestamp: new Date().toISOString(),
          database: { status: 'unavailable' }, error: 'DATABASE_UNAVAILABLE',
          paper_only: true, trading_enabled: false, request_id: requestId }, 503, head);
      }
    }
    if (path.startsWith('/api/') || path.startsWith('/health/')) return json({ error: 'NOT_FOUND' }, 404, head);
    try {
      return await env.ASSETS.fetch(request);
    } catch {
      log('error', 'assets_failed', { code: 'ASSETS_UNAVAILABLE' });
      return json({ error: 'ASSETS_UNAVAILABLE' }, 503, head);
    }
  },
  async scheduled(controller, env) {
    await runHeartbeat(controller, env);
  },
};
