import { AlpacaError } from './alpaca.js';

const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export const PRICE_MAX_AGE_MS = 12 * 60_000;
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
const nonnegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const round = (n) => Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
const pct = (a,b) => a !== null && b !== null && b > 0 ? round((a/b-1)*100) : null;
const timestamp = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
function parts(ms) { return Object.fromEntries(NY.formatToParts(ms).map((p)=>[p.type,p.value])); }
export function nyDate(ms) { const p=parts(ms); return `${p.year}-${p.month}-${p.day}`; }
export function dateBefore(date, days) { return new Date(Date.parse(`${date}T12:00:00Z`) - days*86400000).toISOString().slice(0,10); }
function dayStart(date) {
  const noon=Date.parse(`${date}T16:00:00Z`), p=parts(noon);
  const wall=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
  return Date.parse(`${date}T00:00:00Z`) - (wall-noon);
}
function minuteOfDay(s) {
  if(typeof s!=='string'||!/^\d{2}:\d{2}$/.test(s))throw new AlpacaError('INVALID_MARKET_CALENDAR');
  const [hour,minute]=s.split(':').map(Number);
  if(hour>23||minute>59)throw new AlpacaError('INVALID_MARKET_CALENDAR');
  return hour*60+minute;
}

export function marketContext(clockResponse, calendar, now=Date.now()) {
  const clock=clockResponse?.clocks?.[0];
  const clockTime=timestamp(clock?.timestamp);
  if(!clock || clockResponse.clocks.length!==1 || clockTime===null || Math.abs(now-clockTime)>120000
    || !['pre','core','post','closed'].includes(clock.phase) || typeof clock.is_market_day!=='boolean'
    || !['XNAS','NASDAQ'].includes(clock.market?.mic ?? clock.market?.acronym)) throw new AlpacaError('INVALID_MARKET_CLOCK');
  if(!Array.isArray(calendar))throw new AlpacaError('INVALID_MARKET_CALENDAR');
  const date=nyDate(clockTime);
  const today=calendar.find((c)=>c.date===date);
  const previous=calendar.filter((c)=>typeof c.date==='string'&&c.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const start=dayStart(date), end=dayStart(dateBefore(date,-1));
  let open=null,close=null;
  if(clock.is_market_day) {
    if(!today||!previous)throw new AlpacaError('INVALID_MARKET_CALENDAR');
    open=start+minuteOfDay(today.open)*60000;
    close=start+minuteOfDay(today.close)*60000;
    if(open>=close || (clock.phase==='core' && (clockTime<open||clockTime>=close)))throw new AlpacaError('INVALID_MARKET_CALENDAR');
  } else if(clock.phase!=='closed')throw new AlpacaError('INVALID_MARKET_CLOCK');
  return { date, session: ({pre:'premarket',core:'regular',post:'after_hours',closed:'closed'})[clock.phase],
    is_market_day:clock.is_market_day, source_asof:new Date(clockTime).toISOString(), phase_until:clock.phase_until??null,
    next_open:clock.next_market_open??null, next_close:clock.next_market_close??null,
    day_start:start,day_end:end,core_open:open,core_close:close,
    previous_date:previous?.date??null,previous_start:previous?dayStart(previous.date):null,
    previous_end:previous?dayStart(dateBefore(previous.date,-1)):null,
  };
}

function barInside(bar,start,end) {
  const time=timestamp(bar?.t);
  return time!==null&&start!==null&&time>=start&&time<end;
}

export function activityFeatures(symbol, snapshot, context, now=Date.now()) {
  if(!snapshot || typeof snapshot!=='object')return null;
  const trade=snapshot.latestTrade;
  const price=positive(trade?.p), tradeTime=timestamp(trade?.t);
  if(price===null || tradeTime===null || tradeTime>now+60000)return null;
  const today=barInside(snapshot.dailyBar,context.day_start,context.day_end)?snapshot.dailyBar:null;
  const previous=[snapshot.dailyBar,snapshot.prevDailyBar].find((b)=>barInside(b,context.previous_start,context.previous_end));
  const previousClose=positive(previous?.c);
  const volume=today?nonnegative(today.v):null;
  const previousVolume=nonnegative(previous?.v);
  const move=pct(price,previousClose);
  const gap=pct(positive(today?.o),previousClose);
  const high=positive(today?.h), low=positive(today?.l);
  const range=high!==null&&low!==null&&high>=low&&previousClose!==null?round((high-low)/previousClose*100):null;
  const age=Math.max(0,now-tradeTime);
  const stale=age>PRICE_MAX_AGE_MS;
  const currentDay=tradeTime>=context.day_start&&tradeTime<context.day_end;
  const extended=(context.session==='premarket'&&currentDay&&context.core_open!==null&&tradeTime<context.core_open)
    ||(context.session==='after_hours'&&currentDay&&context.core_close!==null&&tradeTime>=context.core_close);
  const quote=snapshot.latestQuote, quoteTime=timestamp(quote?.t);
  const bid=positive(quote?.bp), ask=positive(quote?.ap);
  const validQuote=quoteTime!==null&&quoteTime<=now+60000&&now-quoteTime<=PRICE_MAX_AGE_MS&&bid!==null&&ask!==null&&ask>=bid;
  const spread=validQuote?round((ask-bid)/((ask+bid)/2)*100):null;
  const volumeRatio=volume!==null&&previousVolume>0?round(volume/previousVolume):null;
  const missing=[];
  if(previousClose===null)missing.push('previous_session_close');
  if(!today)missing.push('current_daily_bar');
  if(!validQuote)missing.push('fresh_quote');
  missing.push('historical_relative_volume_baseline','realized_volatility');
  const scoreComponents={ price_move:round(Math.min(Math.abs(move??0),100)*0.6),
    gap:round(Math.min(Math.abs(gap??0),50)*0.2),
    daily_range:round(Math.min(range??0,50)*0.2),
    volume_vs_previous_day:round(Math.min(volumeRatio??0,3)*5) };
  const score=round(Object.values(scoreComponents).reduce((sum,n)=>sum+n,0));
  const reasons=[];
  if(move!==null)reasons.push(`${move>=0?'+':''}${move.toFixed(2)}% vs previous session close`);
  if(volumeRatio!==null)reasons.push(`${volumeRatio.toFixed(2)}× previous full-session IEX volume (not RVOL)`);
  if(extended)reasons.push(`${context.session.replace('_',' ')} trade observed`);
  if(stale)reasons.push('stale latest trade; observation only');
  return { symbol, price, source:'alpaca',feed:'iex',source_timestamp:new Date(tradeTime).toISOString(),
    ingested_at:new Date(now).toISOString(),age_seconds:Math.floor(age/1000),stale,
    session:context.session,extended_activity:extended&&!stale,
    is_penny_stock:price<5, percent_move:move,gap_pct:gap,volume,
    volume_vs_previous_day:volumeRatio,relative_volume:null,volatility:null,daily_range_pct:range,
    dollar_volume:volume!==null?round(volume*price):null,
    spread_pct:spread,quote_timestamp:quoteTime!==null?new Date(quoteTime).toISOString():null,
    extended_move_pct:extended?pct(price,context.session==='premarket'?previousClose:positive(today?.c)):null,
    extended_reference:extended?(context.session==='premarket'?'previous_session_close':'reported_daily_bar_close'):null,
    score,score_version:'activity-v1',score_components:scoreComponents,reasons,
    quality:{ coverage:'IEX single-exchange; partial market volume/quotes',missing,price_status:stale?'stale':'fresh' },
  };
}

export function rankActivity(candidates,limit=20) {
  return candidates.filter(Boolean).sort((a,b)=>Number(a.stale)-Number(b.stale)||b.score-a.score||a.symbol.localeCompare(b.symbol)).slice(0,limit);
}
