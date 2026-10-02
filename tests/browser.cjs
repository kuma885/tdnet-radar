/* End-to-end tests use fixture APIs. They never poll TDnet or send a push. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const A=require('../lib/analysis.js');
const output=process.env.QA_OUTPUT||path.join(os.tmpdir(),'tdnet-ui-check');
const record={periodEnd:'2026-03-31',scope:'consolidated',publishedAt:'2026-06-20T15:00:00+09:00',sourceUrl:'https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S100TEST',revenue:20e9,operatingProfit:1.6e9};
const finance={schemaVersion:1,status:'ready',updatedAt:'2026-10-01T00:00:00Z',companies:{'1234':{code:'1234',records:[record,{...record,periodEnd:'2026-09-30',publishedAt:'2026-10-02T15:00:00+09:00',revenue:99e9}]}}};
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
let browser,server,passed=0;
function pass(name){passed++;console.log('PASS '+name);}
async function noOverflow(page,label){
 const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,font:parseFloat(getComputedStyle(document.body).fontSize),small:[...document.querySelectorAll('button,.button,.nav a,input:not([type=checkbox]),select')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<44).map(e=>e.id||e.textContent)}));
 assert.ok(size.scroll<=size.width,`${label}: horizontal overflow ${JSON.stringify(size)}`);assert.ok(size.font>=16);assert.deepEqual(size.small,[],label+' touch targets');
}
async function form(page,base){
 await page.goto(base+'analyze.html');await page.fill('#company','動作確認株式会社');await page.fill('#code','1234');await page.fill('#date','2026-10-01');await page.fill('#time','15:00');await page.fill('#sourceUrl','https://www.release.tdnet.info/inbs/test.pdf');await page.fill('#title','大型受注に関するお知らせ');
}
(async()=>{
 await fs.mkdir(output,{recursive:true});
 server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const target=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));if(!target.startsWith(root+path.sep))throw Error('path');const body=await fs.readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const width of [360,390,412,1440]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<700,hasTouch:width<700,serviceWorkers:'block'});
  const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let dataset=finance;
  await context.route('https://raw.githubusercontent.com/**',route=>route.fulfill({json:dataset}));
  await context.route('https://tdnet-monitor.sanndora388.workers.dev/**',route=>route.fulfill({status:404,json:{error:'not found'}}));
  await context.route('https://cdn.onesignal.com/**',route=>route.fulfill({contentType:'text/javascript',body:'/* Test: do not initialize push subscriptions. */'}));
  for(const route of ['index.html?demo=1','detail.html?id=demo-order','analyze.html','settings.html','about.html']){
   await page.goto(base+route);await page.locator('h1').waitFor();await noOverflow(page,width+' '+route);
   if(route.includes('demo=1')){assert.equal(await page.locator('.disclosure').count(),5);await page.fill('#search','サンプル精密');assert.equal(await page.locator('.disclosure').count(),1);await page.fill('#search','');}
   await page.screenshot({path:path.join(output,width+'-'+route.split('?')[0]+'.png'),fullPage:true});
  }
  pass(width+'px: all 5 pages, 16px text, 44px targets, no horizontal overflow');
  await form(page,base);await page.fill('#f-orderAmount','50億円');await page.click('#lookup');await page.waitForFunction(()=>document.getElementById('f-revenue').value==='20000000000');
  assert.equal(await page.inputValue('#f-operatingProfit'),'1600000000');
  await page.fill('#date','2026-01-01');assert.equal(await page.inputValue('#f-revenue'),'');assert.equal(await page.inputValue('#f-operatingProfit'),'');
  await page.click('#lookup');await page.waitForFunction(()=>!document.getElementById('lookup').disabled);assert.match(await page.textContent('#finance-status'),/まだありません/);
  await page.fill('#date','2026-10-01');await page.click('#lookup');await page.waitForFunction(()=>document.getElementById('f-revenue').value==='20000000000');
  await page.check('#confirmed');await page.click('button[type=submit]');await page.waitForURL('**/detail.html?id=local-*');
  assert.match(await page.textContent('#content'),/25%/);assert.match(await page.textContent('#content'),/EDINET 有価証券報告書/);await noOverflow(page,width+' result');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('tdnet-v3-analyses'))[0]);assert.equal(saved.facts.revenue,undefined);assert.equal(A.analyze(saved,saved.companyFinancials).primary.value,25);
  await page.click('#edit-link');await page.waitForFunction(()=>document.getElementById('f-revenue').value==='20000000000');
  await page.fill('#code','9999');assert.equal(await page.inputValue('#f-revenue'),'');assert.equal(await page.inputValue('#f-operatingProfit'),'');
  await page.fill('#code','1234');await page.fill('#f-revenue','300億円');await page.fill('#financialPeriod','確認した年度・単体');await page.click('#lookup');await page.waitForFunction(()=>!document.getElementById('lookup').disabled);assert.equal(await page.inputValue('#f-revenue'),'300億円');assert.equal(await page.inputValue('#f-operatingProfit'),'');assert.equal(await page.inputValue('#financialPeriod'),'確認した年度・単体');
  await page.check('#confirmed');await page.click('button[type=submit]');await page.waitForURL('**/detail.html?id=local-*');assert.match(await page.textContent('#content'),/16.67%/);
  pass(width+'px: EDINET cutoff, save/reopen, identity invalidation, manual precedence');
  await form(page,base);dataset={schemaVersion:1,status:'not_configured',companies:{}};await page.click('#lookup');await page.waitForFunction(()=>!document.getElementById('lookup').disabled);assert.match(await page.textContent('#finance-status'),/未設定/);
  await page.fill('#f-orderAmount','50億円');await page.check('#confirmed');await page.click('button[type=submit]');await page.waitForURL('**/detail.html?id=local-*');assert.match(await page.textContent('#content'),/データなし/);
  await page.goto(base+'detail.html?id='+('a'.repeat(24))+'&original='+encodeURIComponent('https://www.release.tdnet.info/inbs/test.pdf'));await page.waitForFunction(()=>document.getElementById('detail-status').textContent.includes('取得できません'));assert.equal(await page.getAttribute('#original-link','href'),'https://www.release.tdnet.info/inbs/test.pdf');
  assert.deepEqual(errors,[],width+' JavaScript errors');pass(width+'px: no-key manual save and original link on API failure');
  await context.close();
 }
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify({passed,widths:[360,390,412,1440],browser:browser.version()},null,2));
 console.log(`Browser checks: ${passed} passed; screenshots: ${output}`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
