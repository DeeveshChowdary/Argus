const byId = (id) => document.getElementById(id);
const formatTime = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : 'Never';
const label = (value) => ({ healthy: 'Healthy', degraded: 'Degraded', unhealthy: 'Unavailable', never_run: 'Awaiting first run', stale: 'Stale', error: 'Failed' })[value] ?? 'Unknown';
let inFlight = false;

function cell(text, className = '') {
  const el = document.createElement('td');
  el.textContent = text;
  el.className = className;
  return el;
}

function render(data) {
  const available = data.database?.status === 'connected';
  byId('system-status').textContent = label(data.status);
  byId('system-status').className = data.status === 'healthy' ? 'good' : 'warning';
  byId('system-note').textContent = 'Paper only · execution disabled';
  byId('db-status').textContent = available ? 'Connected' : 'Unavailable';
  byId('db-status').className = available ? 'good' : 'bad';
  byId('db-note').textContent = available ? `D1 · schema v${data.database.schema_version}` : 'Check Cloudflare logs and migrations';
  byId('heartbeat').textContent = label(data.scheduler?.status);
  byId('heartbeat').className = data.scheduler?.status === 'healthy' ? 'good' : 'warning';
  byId('heartbeat-note').textContent = `Last success: ${formatTime(data.scheduler?.last_success?.scheduled_at)}`;
  byId('runs').replaceChildren();
  for (const run of data.recent_runs ?? []) {
    const row = document.createElement('tr');
    const name = cell('Foundation heartbeat');
    const date = document.createElement('small');
    date.textContent = formatTime(run.scheduled_at);
    name.append(date);
    row.append(name, cell(run.status === 'success' ? '● Success' : '● Failed', run.status === 'success' ? 'good' : 'bad'), cell(`${run.duration_ms} ms`, 'align-right'));
    byId('runs').append(row);
  }
  if (!data.recent_runs?.length) {
    const row = document.createElement('tr');
    const empty = cell(available ? 'No scheduled runs yet. Waiting for the first Cron Trigger.' : 'Job history unavailable while the database is disconnected.', 'empty');
    empty.colSpan = 3;
    row.append(empty);
    byId('runs').append(row);
  }
  byId('errors').replaceChildren();
  for (const error of data.recent_errors ?? []) {
    const row = document.createElement('div');
    row.className = 'error-row bad';
    const time = document.createElement('time');
    time.textContent = formatTime(error.occurred_at);
    const message = document.createElement('span');
    message.textContent = `${error.component} / ${error.code}`;
    row.append(time, message);
    byId('errors').append(row);
  }
  if (!data.recent_errors?.length) byId('errors').textContent = available ? 'No persisted scheduler errors in the last seven days. Database outages may be visible only in Cloudflare logs.' : 'Error history unavailable. Check Cloudflare Worker logs.';
}

async function refresh() {
  if (inFlight) return;
  inFlight = true;
  byId('refresh').disabled = true;
  try {
    const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (data.service !== 'argus' || !['healthy', 'degraded', 'unhealthy'].includes(data.status)) throw new Error('INVALID_STATUS');
    render(data);
    byId('connection').textContent = data.status === 'healthy' ? 'Live foundation health · automatic refresh every 60 seconds while this page is visible' : 'System needs attention. Review heartbeat and database status below.';
    byId('connection').className = `connection${data.status === 'healthy' ? '' : ' warning'}`;
    byId('updated').textContent = `Status received ${formatTime(new Date().toISOString())}`;
  } catch {
    byId('connection').textContent = 'Connection lost. Previously shown values may be stale. Refresh to retry.';
    byId('connection').className = 'connection warning';
    byId('system-status').textContent = 'Disconnected';
    byId('system-status').className = 'bad';
    byId('system-note').textContent = 'Status unavailable · displayed history may be stale';
  } finally {
    byId('refresh').disabled = false;
    inFlight = false;
  }
}

byId('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
refresh();
