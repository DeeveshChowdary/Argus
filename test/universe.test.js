import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {refreshUniverse, readUniverse, pruneUniverses} from '../src/universe.js';
let mf,db;
const asset=(symbol)=>({id:`id-${symbol}`,symbol,name:symbol,exchange:'NASDAQ',class:'us_equity',status:'active',tradable:true});
before(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-07-30',d1Databases:['DB'],log:new Log(LogLevel.NONE)});
  db=await mf.getD1Database('DB');
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).sort()) {
    const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');
    await db.batch(sql.split(';').filter(x=>x.trim()).map(x=>db.prepare(x)));
  }
});
after(async()=>{if(mf)await mf.dispose();});

test('large universe bulk persistence is complete, price-agnostic and atomically published',async()=>{
  const input=Array.from({length:2101},(_,i)=>asset(`S${i.toString().padStart(4,'0')}`));
  const result=await refreshUniverse(db,{assets:async()=>input});
  assert.equal(result.asset_count,2101);
  assert.equal((await readUniverse(db)).id,result.id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM universe_assets WHERE universe_id = ?').bind(result.id).first()).n,2101);
});

test('invalid upstream leaves the previous universe active',async()=>{
  const previous=await readUniverse(db);
  await assert.rejects(refreshUniverse(db,{assets:async()=>[asset('GOOD'),{}]}),{code:'INVALID_ASSET_UNIVERSE'});
  assert.equal((await readUniverse(db)).id,previous.id);
});

test('interrupted bulk persistence keeps the old version active; later success and pruning recover',async()=>{
  const previous=await readUniverse(db);
  let inserts=0;
  const broken={
    prepare(sql){
      if(sql.startsWith('INSERT INTO universe_assets') && ++inserts===2)throw new Error('simulated disk failure');
      return db.prepare(sql);
    },batch:db.batch.bind(db),
  };
  const input=Array.from({length:1100},(_,i)=>asset(`T${i}`));
  await assert.rejects(refreshUniverse(broken,{assets:async()=>input}),{code:'UNIVERSE_PERSIST_FAILED'});
  assert.equal((await readUniverse(db)).id,previous.id);
  assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM universe_versions WHERE status='building'").first()).n>0);
  const result=await refreshUniverse(db,{assets:async()=>[asset('PENNY')]});
  await pruneUniverses(db);
  assert.equal((await readUniverse(db)).id,result.id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM universe_versions').first()).n,1);
  assert.equal((await db.prepare('SELECT symbol FROM universe_assets').first()).symbol,'PENNY');
});
