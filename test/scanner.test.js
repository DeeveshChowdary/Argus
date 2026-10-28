import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {nyDate,dateBefore} from '../src/features.js';
import {runMarketScan,readMarketStatus} from '../src/scanner.js';
const nyParts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(Date.now()).map(p=>[p.type,p.value]));
const nyMinutes=Number(nyParts.hour)*60+Number(nyParts.minute);
const defaultPhase=nyMinutes<570?'pre':nyMinutes>=960?'post':'core';
let mf,db,mode='ok',phase=defaultPhase,calls=[],sequence=0;
const date=()=>nyDate(Date.now());
const assets=()=>Array.from({length:2105},(_,i)=>({id:`id-${i}`,symbol:`S${String(i).padStart(4,'0')}`,name:`Company ${i}`,exchange:'NASDAQ',class:'us_equity',status:'active',tradable:true}));
const snap=(symbol)=>{const price=symbol==='S0000'?.5:10;return {
  latestTrade:{t:new Date().toISOString(),p:price},latestQuote:{t:new Date().toISOString(),bp:price*.99,ap:price*1.01},
  dailyBar:{t:`${date()}T05:00:00Z`,o:price,h:price*1.1,l:price*.9,c:price*.95,v:1000},
  prevDailyBar:{t:`${dateBefore(date(),1)}T05:00:00Z`,o:price,h:price,l:price,c:symbol==='S0000'?.25:10,v:2000},
};};
async function upstream(request) {
  const url=new URL(request.url);calls.push({url,method:request.method});
  assert.equal(request.method,'GET');
  assert.ok(['paper-api.alpaca.markets','data.alpaca.markets'].includes(url.hostname));
  if(mode==='network')throw new Error('private-fixture-secret');
  if(mode==='auth')return new Response('private-fixture-secret',{status:401});
  if(mode==='rate')return new Response('private-fixture-secret',{status:429,headers:{'retry-after':'600'}});
  if(url.pathname==='/v2/assets')return Response.json(assets());
  if(url.pathname==='/v3/clock')return Response.json({clocks:[{market:{mic:'XNAS'},timestamp:new Date().toISOString(),is_market_day:true,phase}]});
  if(url.pathname==='/v2/calendar')return Response.json([{date:dateBefore(date(),1),open:'09:30',close:'16:00'},{date:date(),open:'09:30',close:'16:00'}]);
  if(url.pathname==='/v2/stocks/snapshots') {
    const symbols=url.searchParams.get('symbols').split(',');
    assert.ok(symbols.length<=500);assert.equal(url.searchParams.get('feed'),'iex');
    if(mode==='empty')return Response.json({});
    return Response.json(Object.fromEntries((mode==='partial'?symbols.slice(0,1):symbols).map(s=>[s,snap(s)])));
  }
  throw new Error('Unexpected upstream path');
}
before(async()=>{
  mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:fileURLToPath(new URL('../src/index.js',import.meta.url)),
    compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{MARKET_SCAN_ENABLED:'true',APCA_API_KEY_ID:'private-fixture-key',APCA_API_SECRET_KEY:'private-fixture-secret'},
    outboundService:upstream,log:new Log(LogLevel.NONE),serviceBindings:{ASSETS:async()=>new Response('asset')}});
  db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).sort()) {
    const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');
    await db.batch(sql.split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));
  }
});
after(async()=>{if(mf)await mf.dispose();});
beforeEach(async()=>{
  mode='ok';phase=defaultPhase;calls=[];
  await db.batch([db.prepare("UPDATE scanner_state SET universe_id=NULL,cursor=0,lease_owner=NULL,lease_until=0,retry_at=0,hotlist_json='[]'"),
    db.prepare('DELETE FROM universe_assets'),db.prepare('DELETE FROM universe_versions'),db.prepare('DELETE FROM market_scans'),db.prepare('DELETE FROM job_runs')]);
});
async function scheduled(at=Date.now()+sequence++) {
  return (await mf.getWorker()).scheduled({scheduledTime:at,cron:'*/5 * * * *'});
}
const market=async()=> (await mf.dispatchFetch('https://argus.test/api/market')).json();

test('actual Worker schedule retrieves universe, scans bounded batches, ranks penny stock and persists data for API',async()=>{
  assert.equal((await scheduled()).outcome,'ok');
  const data=await market();
  assert.equal(data.status,'healthy');assert.equal(data.universe.asset_count,2105);
  assert.equal(data.last_success.broad_requested,2000);assert.equal(data.last_success.returned_count,2000);
  assert.equal(data.candidates.length,20);assert.equal(data.candidates[0].symbol,'S0000');assert.equal(data.candidates[0].is_penny_stock,true);
  assert.equal(data.candidates[0].extended_activity,defaultPhase!=='core');
  assert.equal(data.trading_enabled,false);assert.equal(data.paper_only,true);
  assert.ok(!JSON.stringify(data).includes('private-fixture'));
  assert.equal(calls.filter(c=>c.url.pathname.includes('snapshots')).length,4);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM universe_assets').first()).n,2105);
});

test('rotation advances, refreshes previous hotlist, and avoids unnecessary universe refresh',async()=>{
  await scheduled();calls=[];
  await scheduled();
  const data=await market();
  assert.equal(data.last_success.broad_requested,105);assert.equal(data.last_success.hot_requested,20);
  assert.equal(data.last_success.next_cursor,0);assert.equal(data.candidates[0].symbol,'S0000');
  assert.equal(calls.filter(c=>c.url.pathname==='/v2/assets').length,0);
  const symbols=calls.filter(c=>c.url.pathname.includes('snapshots')).flatMap(c=>c.url.searchParams.get('symbols').split(','));
  assert.ok(symbols.includes('S0000'));assert.equal(symbols.length,125);
});

test('duplicate schedule IDs and an active lease prevent duplicate upstream work',async()=>{
  const at=Date.now();await scheduled(at);calls=[];await scheduled(at);assert.equal(calls.length,0);
  await db.prepare('UPDATE scanner_state SET lease_until=?,lease_owner=?').bind(Date.now()+60000,'other').run();
  await scheduled(at+1);assert.equal(calls.length,0);
});

test('provider auth failure is visible and safe while preserving previous data and foundation heartbeat',async()=>{
  await scheduled();mode='auth';
  assert.equal((await scheduled()).outcome,'exception');
  const data=await market();assert.equal(data.status,'error');assert.equal(data.last_attempt.error_code,'ALPACA_AUTH_FAILED');
  assert.equal(data.candidate_count,20);assert.ok(!JSON.stringify(data).includes('private-fixture-secret'));
  assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE status='success'").first()).n>=2);
});

test('rate-limit backoff persists and prevents retries until permitted',async()=>{
  mode='rate';assert.equal((await scheduled()).outcome,'exception');
  const state=await db.prepare('SELECT retry_at FROM scanner_state').first();assert.ok(state.retry_at>Date.now()+500000);
  calls=[];assert.equal((await scheduled()).outcome,'ok');assert.equal(calls.length,0);
  mode='ok';await db.prepare('UPDATE scanner_state SET retry_at=0').run();assert.equal((await scheduled()).outcome,'ok');
});

test('partial coverage is explicit and an empty result never becomes a successful scan',async()=>{
  mode='partial';await scheduled();let data=await market();
  assert.equal(data.last_success.returned_count,4);assert.equal(data.last_success.missing_count,1996);
  assert.equal(data.last_success.quality.missing_symbols,1996);
  mode='empty';assert.equal((await scheduled()).outcome,'exception');data=await market();
  assert.equal(data.last_attempt.error_code,'ALPACA_EMPTY_SNAPSHOTS');assert.equal(data.candidate_count,4);
});

test('closed sessions poll clock but refresh snapshots only hourly',async()=>{
  phase='closed';await scheduled();calls=[];await scheduled();
  const data=await market();assert.equal(data.status,'idle');assert.equal(data.last_attempt.status,'skipped');
  assert.equal(data.sweep.estimated_full_sweep_minutes,120);assert.equal(data.sweep.active_full_sweep_minutes,10);
  assert.equal(calls.filter(c=>c.url.pathname.includes('snapshots')).length,0);
});

test('disabled and missing-credential modes perform no DB or network work',async()=>{
  assert.equal((await runMarketScan({},{})).status,'disabled');
  assert.equal((await runMarketScan({},{MARKET_SCAN_ENABLED:'true'})).status,'not_configured');
});

test('previously fresh price/quote observations expire when read later',async()=>{
  await scheduled();
  const env={DB:db,MARKET_SCAN_ENABLED:'true',APCA_API_KEY_ID:'fixture',APCA_API_SECRET_KEY:'fixture'};
  const data=await readMarketStatus(env,Date.now()+13*60000);
  assert.equal(data.status,'stale');
  assert.equal(data.fresh_candidate_count,0);
  for(const c of data.candidates) {assert.equal(c.stale,true);assert.equal(c.extended_activity,false);assert.equal(c.spread_pct,null);assert.ok(c.quality.missing.includes('fresh_quote'));}
});
