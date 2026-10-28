import test from 'node:test';
import assert from 'node:assert/strict';
import {marketContext,activityFeatures,rankActivity,nyDate} from '../src/features.js';
const calendar=[{date:'2026-10-26',open:'09:30',close:'16:00'},{date:'2026-10-27',open:'09:30',close:'16:00'}];
const clock=(timestamp,phase='core',is_market_day=true)=>({clocks:[{timestamp,phase,is_market_day,market:{mic:'XNAS'},phase_until:'2026-10-27T20:00:00Z'}]});
const snapshot=(t='2026-10-27T14:00:00Z',p=2)=>({latestTrade:{t,p},latestQuote:{t,bp:p-0.01,ap:p+0.01},dailyBar:{t:'2026-10-27T04:00:00Z',o:1.5,h:2.1,l:1.4,c:1.9,v:5000},prevDailyBar:{t:'2026-10-26T04:00:00Z',o:1,h:1.4,l:.8,c:1,v:10000}});

test('regular and extended sessions use provider phases/calendar and NY dates',()=>{
  for(const [time,phase,expected] of [['2026-10-27T12:00:00Z','pre','premarket'],['2026-10-27T14:00:00Z','core','regular'],['2026-10-27T21:00:00Z','post','after_hours'],['2026-10-28T03:00:00Z','closed','closed']]) {
    const now=Date.parse(time),context=marketContext(clock(time,phase),calendar,now);
    assert.equal(context.session,expected);
    assert.equal(context.date,'2026-10-27');
  }
  assert.equal(nyDate(Date.parse('2026-10-28T03:00:00Z')),'2026-10-27');
});

test('holiday/weekend and early-close sessions are explicitly represented',()=>{
  const weekend='2026-10-31T16:00:00Z';
  assert.equal(marketContext(clock(weekend,'closed',false),calendar,Date.parse(weekend)).session,'closed');
  const earlyCalendar=[{date:'2026-11-25',open:'09:30',close:'16:00'},{date:'2026-11-27',open:'09:30',close:'13:00'}];
  const time='2026-11-27T19:00:00Z',context=marketContext(clock(time,'post'),earlyCalendar,Date.parse(time));
  assert.equal(context.core_close,Date.parse('2026-11-27T18:00:00Z'));
});

test('DST transition uses different UTC regular opens without host timezone assumptions',()=>{
  const cases=[['2026-03-06','2026-03-05','2026-03-06T15:00:00Z','2026-03-06T14:30:00Z'],['2026-03-09','2026-03-06','2026-03-09T14:00:00Z','2026-03-09T13:30:00Z']];
  for(const [today,previous,time,open] of cases) {
    const c=marketContext(clock(time),[{date:previous,open:'09:30',close:'16:00'},{date:today,open:'09:30',close:'16:00'}],Date.parse(time));
    assert.equal(c.core_open,Date.parse(open));
  }
});

test('stale clocks, contradictory sessions and missing calendars fail safely',()=>{
  const now=Date.parse('2026-10-27T14:00:00Z');
  assert.throws(()=>marketContext(clock('2026-10-27T12:00:00Z'),calendar,now),{code:'INVALID_MARKET_CLOCK'});
  assert.throws(()=>marketContext(clock('2026-10-27T12:00:00Z'),calendar,Date.parse('2026-10-27T12:00:00Z')),{code:'INVALID_MARKET_CALENDAR'});
  assert.throws(()=>marketContext(clock('2026-10-27T14:00:00Z'),[],now),{code:'INVALID_MARKET_CALENDAR'});
});

test('features retain penny stocks with explicit volume, gap, range, spread and reproducible components',()=>{
  const now=Date.parse('2026-10-27T14:00:00Z'),context=marketContext(clock(new Date(now).toISOString()),calendar,now);
  const c=activityFeatures('PENNY',snapshot(),context,now);
  assert.equal(c.is_penny_stock,true);assert.equal(c.percent_move,100);assert.equal(c.gap_pct,50);
  assert.equal(c.volume_vs_previous_day,.5);assert.equal(c.relative_volume,null);assert.equal(c.volatility,null);
  assert.equal(c.daily_range_pct,70);assert.equal(c.spread_pct,1);
  assert.equal(c.score,Object.values(c.score_components).reduce((sum,n)=>sum+n,0));
  assert.ok(c.quality.missing.includes('historical_relative_volume_baseline'));
});

test('premarket daily-bar rollover uses the last session close, not the day before',()=>{
  const now=Date.parse('2026-10-27T12:00:00Z'),context=marketContext(clock(new Date(now).toISOString(),'pre'),calendar,now);
  const s=snapshot(new Date(now).toISOString(),2);
  s.dailyBar={...s.prevDailyBar,c:1.5};s.prevDailyBar={...s.prevDailyBar,t:'2026-10-23T04:00:00Z',c:1};
  const c=activityFeatures('PENNY',s,context,now);
  assert.equal(c.percent_move,33.3333);assert.equal(c.extended_move_pct,33.3333);assert.equal(c.extended_activity,true);
  assert.equal(c.gap_pct,null);assert.equal(c.volume,null);
});

test('after-hours requires a fresh trade after core close; old regular prints do not count',()=>{
  const now=Date.parse('2026-10-27T21:00:00Z'),context=marketContext(clock(new Date(now).toISOString(),'post'),calendar,now);
  assert.equal(activityFeatures('PENNY',snapshot('2026-10-27T20:59:00Z'),context,now).extended_activity,true);
  const old=activityFeatures('PENNY',snapshot('2026-10-27T19:59:00Z'),context,now);
  assert.equal(old.extended_activity,false);assert.equal(old.stale,true);
});

test('missing/zero prices and prior-close baselines never produce infinities or fake values',()=>{
  const now=Date.parse('2026-10-27T14:00:00Z'),context=marketContext(clock(new Date(now).toISOString()),calendar,now);
  assert.equal(activityFeatures('NO',snapshot(undefined,0),context,now),null);
  const s=snapshot();s.prevDailyBar.c=0;s.latestQuote.ap=.2;
  const c=activityFeatures('NO',s,context,now);
  assert.equal(c.percent_move,null);assert.equal(c.spread_pct,null);
  assert.ok(!JSON.stringify(c).includes('Infinity'));
});

test('fresh candidates outrank stale ones and ties have deterministic symbol order',()=>{
  const candidates=[{symbol:'OLD',stale:true,score:100},{symbol:'B',stale:false,score:5},{symbol:'A',stale:false,score:5}];
  assert.deepEqual(rankActivity(candidates).map(c=>c.symbol),['A','B','OLD']);
});
