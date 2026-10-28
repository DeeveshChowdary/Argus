import { AlpacaError, configured, createAlpaca } from './alpaca.js';
import { marketContext, nyDate, activityFeatures, rankActivity } from './features.js';
import { readUniverse, refreshUniverse, pruneUniverses, UNIVERSE_MAX_AGE_MS } from './universe.js';
import { log } from './log.js';

export const BROAD_LIMIT=2000;
export const HOT_LIMIT=20;
const RETENTION_MS=7*86400000;
const FRESH_MS=12*60000;
const CLOSED_REFRESH_MS=60*60000;
const enabled=(env)=>env.MARKET_SCAN_ENABLED==='true';

function decodeScan(row) {
  if(!row)return null;
  const {candidates_json,quality_json,...scan}=row;
  return {...scan,candidates:JSON.parse(candidates_json),quality:JSON.parse(quality_json)};
}

export async function readMarketStatus(env,now=Date.now()) {
  const [last,good,universe]=await env.DB.batch([
    env.DB.prepare('SELECT * FROM market_scans ORDER BY scheduled_at DESC LIMIT 1'),
    env.DB.prepare("SELECT * FROM market_scans WHERE status='success' ORDER BY scheduled_at DESC LIMIT 1"),
    env.DB.prepare(`SELECT u.id,u.fetched_at,u.asset_count FROM scanner_state s JOIN universe_versions u ON s.universe_id=u.id WHERE s.id=1 AND u.status='ready'`),
  ]);
  const latest=decodeScan(last.results[0]), success=decodeScan(good.results[0]);
  const activeUniverse=universe.results[0]??null;
  const universeStale=!activeUniverse||now-Date.parse(activeUniverse.fetched_at)>UNIVERSE_MAX_AGE_MS;
  const latestStale=!latest||now-Date.parse(latest.finished_at??latest.started_at)>FRESH_MS;
  const successAge=success?now-Date.parse(success.finished_at):Infinity;
  const candidates=(success?.candidates??[]).map((c)=>{
    const age=now-Date.parse(c.source_timestamp);
    const stale=!Number.isFinite(age)||age>FRESH_MS||age< -60000;
    const quoteAge=now-Date.parse(c.quote_timestamp);
    const quoteFresh=Number.isFinite(quoteAge)&&quoteAge<=FRESH_MS&&quoteAge>= -60000;
    const missing=[...new Set([...c.quality.missing,...(quoteFresh?[]:['fresh_quote'])])];
    return {...c,stale,spread_pct:quoteFresh?c.spread_pct:null,extended_activity:c.extended_activity&&!stale,quality:{...c.quality,missing,price_status:stale?'stale':'fresh'},age_seconds:Number.isFinite(age)?Math.max(0,Math.floor(age/1000)):null};
  });
  let status;
  if(!enabled(env))status='disabled';
  else if(!configured(env))status='not_configured';
  else if(latest?.status==='error')status='error';
  else if(!success)status='never_run';
  else if(latestStale||universeStale)status='stale';
  else if(latest.session==='closed'&&successAge<=CLOSED_REFRESH_MS+FRESH_MS)status='idle';
  else if(successAge>FRESH_MS)status='stale';
  else if(!candidates.some((c)=>!c.stale))status='no_fresh_data';
  else status='healthy';
  return {status,enabled:enabled(env),credentials_configured:configured(env),feed:'iex',source:'alpaca',
    coverage:'IEX only; partial US market volume and quotes',session:latest?.session??null,
    universe:activeUniverse?{...activeUniverse,stale:universeStale}:null,
    sweep:{broad_symbols_per_scan:BROAD_LIMIT,hot_list_limit:HOT_LIMIT,interval_minutes:5,
      snapshot_interval_minutes:latest?.session==='closed'?60:5,
      active_full_sweep_minutes:activeUniverse?Math.ceil(activeUniverse.asset_count/BROAD_LIMIT)*5:null,
      estimated_full_sweep_minutes:activeUniverse?Math.ceil(activeUniverse.asset_count/BROAD_LIMIT)*(latest?.session==='closed'?60:5):null,
      next_cursor:success?.next_cursor??0},
    last_attempt:latest?{...latest,candidates:undefined}:null,
    last_success:success?{...success,candidates:undefined}:null,
    candidates,candidate_count:candidates.length,fresh_candidate_count:candidates.filter((c)=>!c.stale).length,
    trading_enabled:false,paper_only:true};
}

export async function runMarketScan(controller,env,client=createAlpaca(env)) {
  if(!enabled(env)||!configured(env))return {status:enabled(env)?'not_configured':'disabled'};
  const start=Date.now(), scheduledAt=new Date(controller.scheduledTime).toISOString();
  const id=`market:${scheduledAt}`;
  const existing=await env.DB.prepare('SELECT status FROM market_scans WHERE id=?').bind(id).first();
  if(existing&&['success','skipped'].includes(existing.status))return {status:'duplicate'};
  const state=await env.DB.prepare(`UPDATE scanner_state SET lease_owner=?,lease_until=?
    WHERE id=1 AND lease_until<=? AND retry_at<=? RETURNING *`).bind(id,start+4*60000,start,start).first();
  if(!state)return {status:'busy_or_backoff'};
  let context=null;
  try {
    await env.DB.prepare(`INSERT INTO market_scans(id,scheduled_at,started_at,status) VALUES(?,?,?,'running')
      ON CONFLICT(id) DO UPDATE SET status='running',started_at=excluded.started_at,error_code=NULL,finished_at=NULL`)
      .bind(id,scheduledAt,new Date(start).toISOString()).run();
    let universe=await readUniverse(env.DB);
    if(!universe || start-Date.parse(universe.fetched_at)>UNIVERSE_MAX_AGE_MS) {
      universe=await refreshUniverse(env.DB,client,start);
      await pruneUniverses(env.DB);
    }
    const clock=await client.clock();
    const clockTime=Date.parse(clock?.clocks?.[0]?.timestamp);
    if(!Number.isFinite(clockTime))throw new AlpacaError('INVALID_MARKET_CLOCK');
    context=marketContext(clock,await client.calendar(nyDate(clockTime)),Date.now());
    const previous=await env.DB.prepare("SELECT finished_at FROM market_scans WHERE status='success' ORDER BY scheduled_at DESC LIMIT 1").first();
    if(context.session==='closed'&&previous&&start-Date.parse(previous.finished_at)<CLOSED_REFRESH_MS) {
      await env.DB.batch([
        env.DB.prepare("UPDATE market_scans SET status='skipped',session='closed',source_asof=?,finished_at=?,duration_ms=? WHERE id=?")
          .bind(context.source_asof,new Date().toISOString(),Date.now()-start,id),
        env.DB.prepare('UPDATE scanner_state SET lease_owner=NULL,lease_until=0 WHERE id=1 AND lease_owner=?').bind(id),
      ]);
      return {status:'idle'};
    }
    const cursor=state.universe_id===universe.id&&state.cursor<universe.asset_count?state.cursor:0;
    const broad=await env.DB.prepare('SELECT symbol,name,exchange FROM universe_assets WHERE universe_id=? ORDER BY symbol LIMIT ? OFFSET ?')
      .bind(universe.id,BROAD_LIMIT,cursor).all();
    const hotSymbols=JSON.parse(state.hotlist_json).filter((s)=>typeof s==='string').slice(0,HOT_LIMIT);
    const hot=await env.DB.prepare(`SELECT symbol,name,exchange FROM universe_assets WHERE universe_id=? AND symbol IN (SELECT value FROM json_each(?))`)
      .bind(universe.id,JSON.stringify(hotSymbols)).all();
    const rows=new Map([...broad.results,...hot.results].map((a)=>[a.symbol,a]));
    const symbols=[...rows.keys()];
    if(!symbols.length)throw new AlpacaError('EMPTY_TRADABLE_UNIVERSE');
    const candidates=[];
    let returned=0, invalid=0;
    for(let i=0;i<symbols.length;i+=500) {
      const batch=symbols.slice(i,i+500),snapshots=await client.snapshots(batch);
      for(const symbol of batch) {
        if(!Object.hasOwn(snapshots,symbol)||!snapshots[symbol])continue;
        returned++;
        const feature=activityFeatures(symbol,snapshots[symbol],context,Date.now());
        if(feature)candidates.push({...feature,name:rows.get(symbol).name,exchange:rows.get(symbol).exchange});
        else invalid++;
      }
    }
    if(returned===0||!candidates.length)throw new AlpacaError('ALPACA_EMPTY_SNAPSHOTS');
    const ranked=rankActivity(candidates,HOT_LIMIT);
    const next=cursor+broad.results.length>=universe.asset_count?0:cursor+broad.results.length;
    const now=Date.now(), finishedAt=new Date(now).toISOString();
    const quality={missing_symbols:symbols.length-returned,invalid_price_records:invalid,
      coverage:'IEX single exchange; not consolidated volume',relative_volume:'unavailable: no historical time-of-day baseline',
      volatility:'daily range proxy only; realized volatility unavailable',
      extended_hours:'Only fresh IEX observations within provider pre/post phases count. Missing coverage is not no activity.',
      clock:{date:context.date,phase_until:context.phase_until,next_open:context.next_open,next_close:context.next_close}};
    const results=await env.DB.batch([
      env.DB.prepare(`UPDATE scanner_state SET cursor=?,hotlist_json=?,lease_owner=NULL,lease_until=0,retry_at=0 WHERE id=1 AND lease_owner=? AND lease_until>?`)
        .bind(next,JSON.stringify(ranked.map((c)=>c.symbol)),id,now),
      env.DB.prepare(`UPDATE market_scans SET status='success',finished_at=?,session=?,source_asof=?,universe_id=?,universe_count=?,
        broad_requested=?,hot_requested=?,returned_count=?,missing_count=?,next_cursor=?,duration_ms=?,candidates_json=?,quality_json=? WHERE id=?`)
        .bind(finishedAt,context.session,context.source_asof,universe.id,universe.asset_count,broad.results.length,symbols.length-broad.results.length,
          returned,symbols.length-returned,next,now-start,JSON.stringify(ranked),JSON.stringify(quality),id),
      env.DB.prepare('DELETE FROM market_scans WHERE scheduled_at<?').bind(new Date(now-RETENTION_MS).toISOString()),
    ]);
    if(results[0].meta.changes!==1)throw new AlpacaError('SCANNER_LEASE_EXPIRED');
    log('info','market_scan_succeeded',{run_id:id,requested_count:symbols.length,returned_count:returned,duration_ms:now-start});
    return {status:'success',candidate_count:ranked.length};
  } catch(error) {
    const code=error instanceof AlpacaError?error.code:'SCANNER_DATABASE_ERROR';
    log('error','market_scan_failed',{run_id:id,code});
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE market_scans SET status='error',error_code=?,finished_at=?,session=?,duration_ms=? WHERE id=?")
          .bind(code,new Date().toISOString(),context?.session??null,Date.now()-start,id),
        env.DB.prepare('UPDATE scanner_state SET lease_owner=NULL,lease_until=0,retry_at=? WHERE id=1 AND lease_owner=?')
          .bind(code==='ALPACA_RATE_LIMITED'?Date.now()+Math.max(error.retryAfterSeconds??300,300)*1000:0,id),
      ]);
    } catch { log('error','market_error_persistence_failed',{run_id:id,code:'ERROR_PERSISTENCE_FAILED'}); }
    throw new Error(code);
  }
}
