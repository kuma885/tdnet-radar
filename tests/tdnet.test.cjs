const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
function worker(file='cloudflare/worker.js', fetchImpl=()=>{throw Error('Unexpected network')}) {
 const context=vm.createContext({URL,URLSearchParams,TextEncoder,Response,crypto:webcrypto,fetch:fetchImpl,console:{log(){},error(){}}});
 vm.runInContext(read(file).replace('export default {','globalThis.worker = {'),context);
 return context;
}
const normal=worker(), old=worker('tests/fixtures/v2/worker.js');
const titles=['上方修正','配当予想の引き上げ','自己株式の取得に係る事項の決定','大型受注','資本業務提携','株式取得による子会社化','公開買付けの開始','株式分割','下方修正','減配','赤字転落','第三者割当増資','米国NASDAQ市場上場のSunPower Incが発行する第三者割当増資を当社が引き受けることに関するお知らせ'];
const exclusions=['取得状況','取得結果','取得終了','取得実績','月間行使状況','行使状況','行使結果','大量行使','発行状況','払込完了'];
test('v2の通知判定ルール・分類関数は一字も変更しない',()=>{
 for(const [start,end] of [['const RULES = [','export default'],['function classifyTitle','// 複数材料']]) {
  const before=read('tests/fixtures/v2/worker.js'); const after=read('cloudflare/worker.js');
  const a=before.slice(before.indexOf(start),start.includes('classify')?before.indexOf('function buildExplanation'):before.indexOf(end)).trim();
  const b=after.slice(after.indexOf(start),after.indexOf(end)).trim();assert.equal(b,a);
 }
});
test('分類の回帰：全13分類・除外語・複合材料・無関係タイトル',()=>{
 const cases=['決算短信','業績予想の修正に関するお知らせ',...titles];
 for(const t of titles){for(const suffix of ['',...titles,...exclusions])cases.push(t+suffix+'に関するお知らせ');}
 for(const t of cases)assert.equal(JSON.stringify(normal.classifyTitle(t)),JSON.stringify(old.classifyTitle(t)),t);
 assert.equal(JSON.stringify(normal.classifyTitle(titles.at(-1))),JSON.stringify(['出資・投資']));
});
test('複合材料は増配も下方修正も説明する',()=>{
 const c=normal.classifyTitle('業績予想の下方修正および増配');const ex=normal.buildExplanations('業績予想の下方修正および増配',c);
 assert.equal(ex.length,2);assert.equal(ex.some(x=>x.category==='減配'),false);
 assert.match(ex.find(x=>x.category==='増配').summary,/増やす/);assert.match(ex.find(x=>x.category==='下方修正').summary,/低い/);
});
test('出資と業務提携をそれぞれ説明',()=>{
 const title=titles.at(-1)+'及び資本業務提携';const ex=normal.buildExplanations(title,normal.classifyTitle(title));
 assert.equal(ex.length,2);assert.match(ex[0].headline,/出資/);assert.match(ex[1].headline,/提携/);
});
test('原文リンクの相対URL・HTMLエンティティ・危険URL',()=>{
 assert.equal(normal.getLink('<td class="kjTitle"><a href="140120260909123456.pdf?a=1&amp;b=2">開示</a></td>','kjTitle'),'https://www.release.tdnet.info/inbs/140120260909123456.pdf?a=1&b=2');
 for(const u of ['javascript:alert(1)','https://evil.test/inbs/file.pdf','http://www.release.tdnet.info/inbs/a.pdf','https://evil@www.release.tdnet.info/inbs/a.pdf','https://www.release.tdnet.info:99/inbs/a.pdf'])assert.equal(normal.safeTdnetUrl(u),'');
});
const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-','');
const pdf='https://www.release.tdnet.info/inbs/140120260909123456.pdf';
const item={time:'15:00',code:'12340',company:'テスト株式会社',title:'業績予想の上方修正および増配',originalUrl:pdf};
function row(i){return `<tr><td class="kjTime">${i.time}</td><td class="kjCode">${i.code}</td><td class="kjName">${i.company}</td><td class="kjTitle"><a href="${i.originalUrl}">${i.title}</a></td></tr>`;}
function setup({failDetail=false,failPush=false,initial=false}={}) {
 const db=new Map(initial?[]:[['seen:'+date,{ids:[]}]]);const sent=[];
 const env={TDNET_STATE:{async get(k){return db.get(k)||null},async put(k,v){if(failDetail&&k.startsWith('detail:'))throw Error('KV unavailable');db.set(k,JSON.parse(v));}},ONESIGNAL_APP_ID:'test-app',ONESIGNAL_SUBSCRIPTION_ID:'test-device',ONESIGNAL_API_KEY:'test-key'};
 const w=worker(undefined,async(url,options)=>{
  if(url.startsWith('https://www.release.tdnet.info/'))return new Response('<table>'+row(item)+'</table>');
  assert.equal(url,'https://api.onesignal.com/notifications');sent.push(JSON.parse(options.body));
  return Response.json(failPush?{errors:['failure']}:{id:'test-notification'},{status:failPush?503:200});
 });return {w,env,db,sent};
}
test('新着→KV→OneSignalの原文URLと説明ボタン、次回重複しない',async()=>{
 const {w,env,db,sent}=setup();await w.worker.scheduled({},env,{});
 assert.equal(sent.length,1);assert.equal(sent[0].url,pdf);assert.deepEqual(sent[0].include_subscription_ids,['test-device']);
 const button=new URL(sent[0].web_buttons[0].url);assert.equal(button.pathname,'/tdnet-radar/detail.html');assert.equal(button.searchParams.get('original'),pdf);
 const detail=db.get('detail:'+button.searchParams.get('id'));assert.equal(detail.explanations.length,2);
 await w.worker.scheduled({},env,{});assert.equal(sent.length,1);
});
test('KVの詳細保存失敗でも原文通知を送る',async()=>{
 const {w,env,sent}=setup({failDetail:true});await w.worker.scheduled({},env,{});assert.equal(sent.length,1);assert.equal(sent[0].url,pdf);
});
test('初回全件既読・通知失敗の連打防止はv2と同じ',async()=>{
 const first=setup({initial:true});await first.w.worker.scheduled({},first.env,{});assert.equal(first.sent.length,0);
 const failure=setup({failPush:true});await failure.w.worker.scheduled({},failure.env,{});await failure.w.worker.scheduled({},failure.env,{});assert.equal(failure.sent.length,1);
});
test('詳細API：成功・期限切れ・不正ID・CORS・キャッシュ抑止',async()=>{
 const {w,env,db}=setup();await w.worker.scheduled({},env,{});const id=[...db.keys()].find(k=>k.startsWith('detail:')).slice(7);
 for(const [suffix,status] of [[id,200],['0'.repeat(24),404],['bad',400]]) {
  const r=await w.worker.fetch(new Request('https://worker.test/api/detail?id='+suffix),env,{});assert.equal(r.status,status);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://kuma885.github.io');
 }
 assert.equal((await w.worker.fetch(new Request('https://worker.test/api/detail',{method:'OPTIONS'}),env,{})).status,204);
});
function serviceWorker({windows=[],offline=false,cached=false}={}) {
 const handlers={},opened=[],deleted=[],written=[];let focused=0;
 const base='https://kuma885.github.io/tdnet-radar/';
 const cache={async addAll(){},async put(k){written.push(k)},async match(){return cached?new Response('offline shell'):undefined}};
 const c=vm.createContext({URL,Response,fetch:async()=>{if(offline)throw Error('offline');return new Response('live')},caches:{async open(){return cache},async keys(){return ['tdnet-radar-v3','onesignal-cache','another-app']},async delete(k){deleted.push(k)}} ,self:{location:{href:base+'sw.js'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting(){},clients:{async claim(){},async matchAll(){return windows.map(url=>({url,async focus(){focused++}}))},async openWindow(url){opened.push(url)}}}});
 vm.runInContext(read('sw.js'),c);
 async function emit(name,props={}){const pending=[];let result;handlers[name]({...props,waitUntil:p=>pending.push(p),respondWith:p=>{result=p}});const response=await result;await Promise.all(pending);return response;}
 return {emit,opened,deleted,written,base,focused:()=>focused};
}
test('端末内通知：アプリ終了・別画面・既存同一画面・不正URL',async()=>{
 for(const windows of [[],['https://kuma885.github.io/tdnet-radar/']]){
  const s=serviceWorker({windows});await s.emit('notificationclick',{notification:{close(){},data:{url:pdf}}});assert.deepEqual(s.opened,[pdf]);
 }
 const same=serviceWorker({windows:[pdf]});await same.emit('notificationclick',{notification:{close(){},data:{url:pdf}}});assert.equal(same.focused(),1);
 const bad=serviceWorker();await bad.emit('notificationclick',{notification:{close(){},data:{url:'javascript:alert(1)'}}});assert.deepEqual(bad.opened,[bad.base]);
});
test('SWはOneSignal等のキャッシュを削除せずAPIも保存しない',async()=>{
 const s=serviceWorker();await s.emit('activate');assert.deepEqual(s.deleted,['tdnet-radar-v3']);
 assert.equal(await s.emit('fetch',{request:new Request('https://worker.test/api/detail?id=abc')}),undefined);
 await s.emit('fetch',{request:new Request(s.base+'detail.html?id=abc')});assert.deepEqual(s.written,[s.base+'detail.html']);
});
test('説明ページはクエリ付きでもオフライン時に共通HTMLへ戻る',async()=>{
 const s=serviceWorker({offline:true,cached:true});const r=await s.emit('fetch',{request:new Request(s.base+'detail.html?id=abc')});assert.equal(await r.text(),'offline shell');
 const empty=serviceWorker({offline:true});assert.equal((await empty.emit('fetch',{request:new Request(empty.base+'detail.html?id=abc')})).status,503);
});
function page(fetchImpl,query='?id='+'a'.repeat(24)+'&original='+encodeURIComponent(pdf)) {
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:true,addEventListener(){}});return nodes.get(id)};
 const c=vm.createContext({URL,URLSearchParams,AbortController,setTimeout,clearTimeout,location:{search:query},document:{getElementById:get},fetch:fetchImpl});
 const source=read('detail.html').match(/<script>([\s\S]*)<\/script>/)[1].replace(/loadDetail\(\);\s*$/,'');vm.runInContext(source,c);
 return {c,get};
}
test('説明表示：複合材料とHTMLエスケープ、旧v2データ互換',async()=>{
 for(const modern of [true,false]){
 const data={id:'a'.repeat(24),company:'<img onerror=alert(1)>',code:'1234',title:'<script>alert(1)</script>',date,originalUrl:pdf,categories:['増配','上方修正'],explanation:{headline:'旧v2説明'},...(modern?{explanations:[{headline:'増配の説明'},{headline:'上方修正の説明'}]}:{})};
 const {c,get}=page(async()=>Response.json(data));await c.loadDetail();const html=get('content').innerHTML;
 assert.ok(html.includes(modern?'上方修正の説明':'旧v2説明'));assert.ok(!html.includes('<script>'));assert.equal(get('original-link').href,pdf);
 }
});
test('404・通信エラーでも通知に含めた原文URLを維持',async()=>{
 for(const fetcher of [async()=>new Response('',{status:404}),async()=>{throw Error('offline')}]){
  const {c,get}=page(fetcher);await c.loadDetail();assert.equal(get('original-link').href,pdf);assert.match(get('company').textContent,/取得できません/);
 }
});
test('IDなし・危険なoriginal・別IDの応答を安全に処理',async()=>{
 const missing=page(()=>{throw Error('must not fetch')},'?original=javascript:alert(1)');await missing.c.loadDetail();assert.match(missing.get('original-link').href,/I_main_00/);
 const wrong=page(async()=>Response.json({id:'b'.repeat(24)}));await wrong.c.loadDetail();assert.match(wrong.get('company').textContent,/取得できません/);
});

test('2ページ目の原文リンク欠落は同じ2ページ目へ戻す',async()=>{
 let calls=0;
 const w=worker(undefined,async()=>{calls++;return new Response(calls===1?row(item).repeat(100):row(item).replace(/<a[^>]*>(.*?)<\/a>/,'$1'));});
 const result=await w.readTdnetAll();assert.equal(result.items.length,101);
 assert.equal(result.items[100].originalUrl,`https://www.release.tdnet.info/inbs/I_list_002_${date}.html`);
});
