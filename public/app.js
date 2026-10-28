const byId = (id) => document.getElementById(id);
const formatTime = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : 'Never';
const label = (value) => ({ healthy: 'Healthy', degraded: 'Degraded', unhealthy: 'Unavailable', never_run: 'Awaiting first run', stale: 'Stale', error: 'Failed', disabled: 'Disabled', not_configured: 'Needs connection', idle: 'Closed · idle', no_fresh_data: 'No fresh data' })[value] ?? 'Unknown';
let inFlight = false;
let currentMarket = null;

function cell(text, className = '') {
  const el = document.createElement('td');
  el.textContent = text;
  el.className = className;
  return el;
}

function render(data) {
  renderMarket(data.market);
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
  const errors = [...(data.recent_errors ?? [])];
  if(data.market?.last_attempt?.status === 'error') errors.unshift({occurred_at:data.market.last_attempt.finished_at,component:'market scanner',code:data.market.last_attempt.error_code});
  for (const error of errors) {
    const row = document.createElement('div');
    row.className = 'error-row bad';
    const time = document.createElement('time');
    time.textContent = formatTime(error.occurred_at);
    const message = document.createElement('span');
    message.textContent = `${error.component} / ${error.code}`;
    row.append(time, message);
    byId('errors').append(row);
  }
  if (!errors.length) byId('errors').textContent = available ? 'No persisted scheduler errors in the last seven days. Database outages may be visible only in Cloudflare logs.' : 'Error history unavailable. Check Cloudflare Worker logs.';
}


const compactNumber = new Intl.NumberFormat([], { notation:'compact', maximumFractionDigits:1 });
const metricPercent = (n) => typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
function renderMarket(market) {
  currentMarket = market ?? null;
  byId('scanner-status').textContent = label(market?.status);
  byId('scanner-status').className = ['healthy','idle'].includes(market?.status) ? 'good' : 'warning';
  byId('universe-count').textContent = market?.universe?.asset_count?.toLocaleString() ?? '—';
  byId('market-session').textContent = ({premarket:'Premarket',regular:'Regular',after_hours:'After hours',closed:'Closed'})[market?.session] ?? 'Unknown';
  byId('fresh-count').textContent = market ? `${market.fresh_candidate_count} / ${market.candidate_count}` : '—';
  byId('market-source').textContent = label(market?.status);
  byId('source-count').textContent = `${market?.last_success ? 1 : 0} / 5`;
  const scan = market?.last_success;
  byId('market-note').textContent = scan ? `Last scan: ${formatTime(scan.finished_at)} · ${scan.returned_count.toLocaleString()} / ${(scan.broad_requested + scan.hot_requested).toLocaleString()} requested snapshots returned` : 'Market data connection is awaiting its first successful scan.';
  const sweep = market?.sweep;
  byId('coverage-note').textContent = `IEX only · partial market volume and quotes. ${sweep?.estimated_full_sweep_minutes ? `Estimated full sweep at current cadence: ${sweep.estimated_full_sweep_minutes} min; top ${sweep.hot_list_limit} refreshed each scan. ` : ''}Volume ratio is not RVOL; daily range is a volatility proxy. Closed-session snapshots refresh hourly.`;
  const filter = byId('candidate-filter').value;
  const rows = (market?.candidates ?? []).filter((c) => filter === 'fresh' ? !c.stale : filter === 'extended' ? c.extended_activity && !c.stale : filter === 'penny' ? c.is_penny_stock : true);
  byId('candidates').replaceChildren();
  for(const candidate of rows) {
    const row=document.createElement('tr');
    const name=cell('', 'candidate-symbol');
    const ticker=document.createElement('span');ticker.textContent=candidate.symbol;
    const badge=document.createElement('span');badge.className=`freshness-tag${candidate.stale ? ' warning' : ''}`;
    const seconds=candidate.age_seconds;
    const age=typeof seconds==='number'?(seconds>=3600?`${Math.floor(seconds/3600)}h old`:seconds>=60?`${Math.floor(seconds/60)}m old`:`${seconds}s old`):'age unknown';
    badge.textContent=`${candidate.stale?'STALE':candidate.extended_activity?'EXTENDED':'FRESH'} · ${age}`;
    badge.title=`Source time: ${formatTime(candidate.source_timestamp)}`;
    const detail=document.createElement('small');detail.textContent=`${candidate.name} · ${formatTime(candidate.source_timestamp)}`;
    name.append(ticker,badge,detail);
    const price=typeof candidate.price==='number'?`$${candidate.price.toFixed(candidate.price<1?4:2)}`:'—';
    const volume=typeof candidate.volume==='number'?compactNumber.format(candidate.volume):'—';
    const score=cell('', 'candidate-score');
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=candidate.score.toFixed(2);
    const reasons=document.createElement('p');reasons.textContent=candidate.reasons.join(' · ');
    const components=document.createElement('dl');
    for(const [key,value] of Object.entries(candidate.score_components)) {
      const term=document.createElement('dt');term.textContent=key.replaceAll('_',' ');
      const number=document.createElement('dd');number.textContent=value.toFixed(2);components.append(term,number);
    }
    const missing=document.createElement('p');missing.textContent=`Missing: ${candidate.quality.missing.join(', ').replaceAll('_',' ')}`;
    details.append(summary,reasons,components,missing);score.append(details);
    row.append(name,cell(price),cell(metricPercent(candidate.percent_move),candidate.percent_move>0?'good':candidate.percent_move<0?'bad':''),
      cell(metricPercent(candidate.gap_pct)),cell(volume),cell(metricPercent(candidate.daily_range_pct)),cell(metricPercent(candidate.spread_pct)),score);
    byId('candidates').append(row);
  }
  if(!rows.length) {
    const row=document.createElement('tr'),empty=cell(market?.candidate_count ? 'No observations match this filter.' : 'No candidate observations yet. The scanner must complete a successful scan.', 'empty');
    empty.colSpan=8;row.append(empty);byId('candidates').append(row);
  }
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
    byId('connection').textContent = data.status === 'healthy' ? 'Live system status · automatic refresh every 60 seconds while this page is visible' : 'System needs attention. Review scanner, heartbeat and database status below.';
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
byId('candidate-filter').addEventListener('change', () => renderMarket(currentMarket));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
refresh();
