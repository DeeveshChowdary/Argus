import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlpaca, normalizeAssets, configured } from '../src/alpaca.js';
const env = { APCA_API_KEY_ID: 'test-key', APCA_API_SECRET_KEY: 'test-secret' };
const asset = (symbol, fields = {}) => ({ id: `id-${symbol}`, symbol, name: `${symbol} company`, exchange: 'NASDAQ', class: 'us_equity', status: 'active', tradable: true, ...fields });

test('credentials are required without sending a request', async () => {
  let calls = 0;
  assert.equal(configured({}), false);
  await assert.rejects(createAlpaca({}, () => { calls++; }).assets(), { code: 'ALPACA_NOT_CONFIGURED' });
  assert.equal(calls, 0);
});

test('all adapter calls are GETs to fixed paper/data hosts with private header auth and no redirects', async () => {
  const calls = [];
  const api = createAlpaca(env, async (url, init) => { calls.push({ url: new URL(url), init }); return Response.json({}); });
  await api.assets();
  await api.clock();
  await api.calendar('2026-10-27');
  await api.snapshots(['AAPL', 'BRK.B']);
  assert.equal(calls.length, 4);
  for (const {url, init} of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.equal(url.searchParams.has('APCA-API-KEY-ID'), false);
    assert.ok(['paper-api.alpaca.markets', 'data.alpaca.markets'].includes(url.hostname));
    assert.ok(!url.pathname.includes('orders'));
    assert.equal(init.headers['APCA-API-SECRET-KEY'], 'test-secret');
  }
  assert.equal(calls[0].url.searchParams.get('asset_class'), 'us_equity');
  assert.equal(calls[3].url.searchParams.get('feed'), 'iex');
});

test('bad status, rate limits and raw network errors become stable safe errors; never auto retry', async () => {
  for (const [status, code] of [[401,'ALPACA_AUTH_FAILED'],[403,'ALPACA_FORBIDDEN'],[429,'ALPACA_RATE_LIMITED'],[500,'ALPACA_HTTP_ERROR'],[302,'ALPACA_HTTP_ERROR']]) {
    let calls=0;
    const api=createAlpaca(env, async()=>{calls++; return new Response('test-secret', {status,headers:{'retry-after':'30'}});});
    await assert.rejects(api.assets(), (err)=>err.code===code && !JSON.stringify(err).includes('test-secret'));
    assert.equal(calls,1);
  }
  await assert.rejects(createAlpaca(env, async()=>{throw new Error('test-secret');}).assets(), {message:'ALPACA_NETWORK_ERROR'});
  await assert.rejects(createAlpaca(env, async()=>new Response('bad json')).assets(), {code:'ALPACA_INVALID_RESPONSE'});
});

test('snapshot batches reject invalid symbols and oversized requests', async () => {
  const api=createAlpaca(env, async()=>Response.json({}));
  for(const batch of [[],['AAPL?key=test'],['https://evil.test'],Array(501).fill('AAPL')]) await assert.rejects(api.snapshots(batch),{code:'INVALID_SYMBOL_BATCH'});
});

test('universe includes low priced and nonfractionable stocks and removes inactive/nontradable/crypto', () => {
  const result=normalizeAssets([asset('PENNY',{price:0.15,fractionable:false}),asset('AAPL'),asset('OLD',{status:'inactive'}),asset('NO',{tradable:false}),asset('BTCUSD',{class:'crypto'})]);
  assert.deepEqual(result.map(x=>x.symbol),['AAPL','PENNY']);
  assert.equal(result[1].fractionable,false);
});

test('malformed/duplicate/empty universe invalidates the full refresh', () => {
  for(const input of [[],{},[asset('AAPL'),{}],[asset('AAPL'),asset('AAPL')],[asset('NO',{tradable:false})]]) assert.throws(()=>normalizeAssets(input));
});
