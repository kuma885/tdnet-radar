import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploy, credentials, uploadBody, readModule } from '../scripts/deploy-worker.mjs';
const old = 'export default { async fetch() { return new Response("old"); } };';
const source = 'export default { async fetch() { return new Response("new"); } };';
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-token', GITHUB_SHA: 'b'.repeat(40), GITHUB_REPOSITORY: 'kuma885/tdnet-radar', GITHUB_REF: 'refs/heads/main', GITHUB_TOKEN: 'github-only' };
const bindings = [{name:'TDNET_STATE',type:'kv_namespace',namespace_id:'existing-kv'}, ...['ONESIGNAL_APP_ID','ONESIGNAL_API_KEY','ONESIGNAL_SUBSCRIPTION_ID'].map(name=>({name,type:'secret_text'}))];
function fixture(options={}) {
 let code=options.same?source:old, writes=0, gets=0;
 const calls=[],logs=[];
 const json=result=>Response.json({success:true,result});
 const fetchImpl=async(url, init={})=>{
  calls.push({url,method:init.method||'GET',headers:init.headers});
  if(url.startsWith('https://api.github.com/')) {
   assert.equal(init.headers.Authorization,'Bearer github-only');
   return Response.json({object:{sha:options.stale?'c'.repeat(40):env.GITHUB_SHA}});
  }
  if(url.startsWith('https://tdnet-monitor.')) {
   assert.equal(init.headers.Authorization,undefined);
   if(options.healthFailure)return new Response('Unavailable',{status:503});
   return Response.json({version:'2.1',totalCount:0,matches:[]});
  }
  assert.equal(init.headers.Authorization,'Bearer private-token');
  if(options.apiError)return new Response('Secret response should not be logged',{status:403});
  if(url.endsWith('/content/v2')) {
   gets++;
   if(options.concurrent && gets>=2)code='export default { fetch(){} }; // manual';
   if(options.externalAfter && writes && gets>=4)code='export default { fetch(){} }; // external';
   if(options.multi){const body=uploadBody(code);body.set('extra.js',new Blob(['export const x=1']),'extra.js');return new Response(body);}
   return new Response(uploadBody(code));
  }
  if(url.endsWith('/settings'))return json({bindings:options.noKV?[]:bindings,compatibility_date:'2026-09-03',usage_model:'standard',observability:{enabled:true},annotations:{'workers/message':String(writes)}});
  if(url.endsWith('/schedules'))return json({schedules:options.noCron?[]:[{cron:'*/2 * * * *'}]});
  assert.ok(url.endsWith('/content'));assert.equal(init.method,'PUT');
  assert.deepEqual(JSON.parse(init.body.get('metadata')),{main_module:'worker.js'});
  code=await init.body.get('worker.js').text();writes++;
  return json({id:'tdnet-monitor'});
 };
 return {run:()=>deploy({env,source,fetchImpl,wait:async()=>{},log:x=>logs.push(x)}),calls,logs,get writes(){return writes},get code(){return code}};
}
test('認証情報不足では通信・書込しない',async()=>{
 assert.throws(()=>credentials({}),/Secrets/);
 let calls=0;await assert.rejects(deploy({env:{},source,fetchImpl:async()=>{calls++}}),/Secrets/);assert.equal(calls,0);
});
test('コード専用APIだけに書込み、設定・KV・Secrets・Cronへの書込みなし',async()=>{
 const f=fixture();assert.equal(await f.run(),'deployed');assert.equal(f.code,source);assert.equal(f.writes,1);
 assert.ok(f.calls.filter(x=>x.method!=='GET').every(x=>x.url.endsWith('/tdnet-monitor/content')));
 assert.ok(!f.logs.join('').includes(env.CLOUDFLARE_API_TOKEN));
});
test('同じコードのpushは読取検証のみ',async()=>{const f=fixture({same:true});assert.equal(await f.run(),'unchanged');assert.equal(f.writes,0)});
test('古いコミットは本番に触れない',async()=>{const f=fixture({stale:true});assert.equal(await f.run(),'stale');assert.equal(f.writes,0);assert.equal(f.calls.length,1)});
test('権限不足の応答本文をログへ出さず停止',async()=>{const f=fixture({apiError:true});await assert.rejects(f.run(),e=>e.message.includes('403')&&!e.message.includes('Secret response'));assert.equal(f.writes,0)});
test('公開後の障害では旧コードへ復元',async()=>{const f=fixture({healthFailure:true});await assert.rejects(f.run(),/直前のコードへ戻しました/);assert.equal(f.writes,2);assert.equal(f.code,old)});
test('人が途中で変更した本番を上書きしない',async()=>{const f=fixture({concurrent:true});await assert.rejects(f.run(),/本番が変更/);assert.equal(f.writes,0)});
test('失敗後に別更新があればロールバックで上書きしない',async()=>{const f=fixture({healthFailure:true,externalAfter:true});await assert.rejects(f.run(),/別の更新/);assert.equal(f.writes,1)});
test('既存KV・Cron欠落、複数モジュールはデプロイ前に停止',async()=>{
 for(const options of [{noKV:true},{noCron:true},{multi:true}]){const f=fixture(options);await assert.rejects(f.run());assert.equal(f.writes,0)}
});
test('multipartのコードを欠落・文字化けなく読み戻す',async()=>{
 const japanese=old+' // 日本語通知';assert.deepEqual(await readModule(new Response(uploadBody(japanese))),{filename:'worker.js',source:japanese});
 await assert.rejects(readModule(new Response('no multipart')),/形式が想定外/);
});
