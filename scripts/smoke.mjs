import assert from 'node:assert/strict';
const input = process.argv[2];
if (!input) throw new Error('Usage: npm run smoke -- https://<argus-worker> [--allow-pending-cron]');
const base = new URL(input);
assert.ok(['http:', 'https:'].includes(base.protocol));
assert.equal(base.username, '');
assert.equal(base.password, '');
const allowPending = process.argv.includes('--allow-pending-cron');
const requireMarket = process.argv.includes('--market');
async function get(path, init) {
  return fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(15000) });
}
const html = await get('/');
assert.equal(html.status, 200);
assert.ok(html.headers.get('content-type').includes('text/html'));
assert.match(await html.text(), /Eyes on the market/);
assert.ok(html.headers.get('content-security-policy')?.includes("script-src 'self'"));
for (const [path, type] of [['/app.js', 'javascript'], ['/styles.css', 'text/css'], ['/favicon.svg', 'image/svg+xml']]) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  assert.ok(response.headers.get('content-type').includes(type), path);
  assert.ok((await response.text()).length > 0, path);
}
assert.equal((await get('/health/live')).status, 200);
const health = await get('/health', { headers: { Accept: 'text/html' } });
const data = await health.json();
assert.equal(data.service, 'argus');
assert.equal(data.database.status, 'connected');
assert.equal(data.database.schema_version, 2);
assert.equal(data.paper_only, true);
assert.equal(data.trading_enabled, false);
assert.equal(data.operating_mode, 'live_scan_no_trade');
assert.equal(data.integrations.broker, 'not_connected');
assert.equal(health.headers.get('cache-control'), 'no-store');
if (!allowPending) {
  assert.equal(health.status, 200, `Health is ${data.status}; scheduler is ${data.scheduler?.status}`);
  assert.equal(data.scheduler.status, 'healthy');
  assert.equal(data.scheduler.last_success.status, 'success');
  assert.ok(data.recent_runs.length > 0, 'Expected a real persisted scheduled run');
} else {
  assert.ok([200, 503].includes(health.status));
  assert.ok(['healthy', 'never_run'].includes(data.scheduler.status), 'Only pending initial cron may be bypassed');
}
if (requireMarket) {
  const market = data.market;
  assert.equal(market.enabled, true);
  assert.equal(market.credentials_configured, true);
  assert.ok(['healthy','idle'].includes(market.status), `Market status: ${market.status}; code: ${market.last_attempt?.error_code}`);
  assert.ok(market.universe.asset_count > 0);
  assert.ok(market.last_success);
  assert.ok(market.candidates.length > 0);
  assert.ok(market.last_success.broad_requested <= market.sweep.broad_symbols_per_scan);
  assert.ok(market.last_success.hot_requested <= market.sweep.hot_list_limit);
  assert.equal(market.feed, 'iex');
  assert.equal(market.trading_enabled, false);
  const response = await get('/api/market');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).universe.id, market.universe.id);
}
const status = await get('/api/status');
assert.equal((await status.json()).service, 'argus');
assert.equal((await get('/api/run')).status, 404);
assert.equal((await get('/api/status', { method: 'POST' })).status, 405);
console.log(JSON.stringify({ result: 'PASS', base_url: base.origin, cron_verified: data.scheduler.status === 'healthy', last_success: data.scheduler.last_success?.scheduled_at ?? null, database: data.database.status, paper_only: data.paper_only, trading_enabled: data.trading_enabled, market_status: data.market?.status, universe_count: data.market?.universe?.asset_count ?? null, candidate_count: data.market?.candidate_count ?? 0 }, null, 2));
