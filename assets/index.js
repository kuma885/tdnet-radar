(()=>{
 const U=RadarUI,$=id=>document.getElementById(id),demo=new URLSearchParams(location.search).get('demo')==='1';
 let remote=[],next=null,legacyCursor=null,legacyLoaded=false,requestVersion=0;
 $('date').value=demo?'2026-10-01':U.today();$('demo-banner').hidden=!demo;
 U.types.forEach(t=>$('category').add(new Option(t,t)));
 function render(){
  const query=$('search').value.normalize('NFKC').toLowerCase(),category=$('category').value;
  const all=demo?remote:[...U.local().filter(d=>U.iso(d.date)===$('date').value),...remote];
  const rows=all.filter(d=>(!category||d.categories.includes(category))&&(!query||(d.company+' '+RadarAnalysis.code(d.code)).normalize('NFKC').toLowerCase().includes(query))&&d.categories.some(c=>localStorage.getItem('tdnet_'+c)!=='false'));
  $('count').textContent=rows.length+'件'+(demo?'（架空サンプル）':'');
  $('list').innerHTML=rows.map(U.card).join('')||'<div class="panel empty"><h3>表示する開示はありません</h3><p>日付・絞り込み条件を確認してください。自分で入力した分析もここに表示されます。</p></div>';
  $('more').hidden=next===null;
 }
 function busy(value){$('refresh').disabled=value;$('more').disabled=value;$('legacy').disabled=value||demo;}
 async function load(append=false){
  if(demo){remote=U.samples;next=null;$('status').textContent='操作確認用の架空サンプルを表示しています。';busy(false);render();return;}
  const version=++requestVersion,date=$('date').value,offset=next;
  if(!append){remote=[];next=null;legacyCursor=null;legacyLoaded=false;$('legacy').textContent='更新前の通知履歴を表示';render();}
  busy(true);$('status').textContent='開示を読み込んでいます…';
  try{
   const data=await U.json(U.API+'/api/history?date='+date.replaceAll('-','')+(append?'&offset='+offset:''));
   if(version!==requestVersion)return;
   if(!Array.isArray(data.items))throw Error('invalid history');
   remote=append?[...remote,...data.items]:data.items;next=data.nextOffset??null;
   $('status').textContent=data.updatedAt?'履歴更新 '+new Date(data.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+(data.pending?' ・ 次の巡回で処理する開示 '+data.pending+'件':''):'この日の新しい履歴はまだありません。更新前の通知は下の履歴ボタンから確認できます。';
  }catch{if(version===requestVersion)$('status').textContent='サーバーの履歴を取得できません。端末に保存した分析は利用できます。';}
  finally{if(version===requestVersion){busy(false);render();}}
 }
 $('search').addEventListener('input',render);$('category').addEventListener('change',render);$('date').addEventListener('change',()=>load());$('refresh').addEventListener('click',()=>load());$('more').addEventListener('click',()=>load(true));
 $('previous').addEventListener('click',()=>{if(!$('date').value)return;const d=new Date($('date').value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);$('date').value=d.toISOString().slice(0,10);load();});
 $('legacy').addEventListener('click',async()=>{
  if(demo)return;const version=++requestVersion,append=legacyLoaded&&!!legacyCursor;busy(true);$('status').textContent='更新前の通知履歴を読み込んでいます…';
  try{
   const data=await U.json(U.API+'/api/legacy-history'+(append?'?cursor='+encodeURIComponent(legacyCursor):''));
   if(version!==requestVersion)return;if(!Array.isArray(data.items))throw Error('invalid history');
   remote=append?[...remote,...data.items]:data.items;legacyCursor=data.next;legacyLoaded=true;next=null;
   $('status').textContent='更新前の通知履歴（保存期間35日・開示日フィルター対象外）';$('legacy').textContent=legacyCursor?'更新前の履歴をさらに表示':'更新前の履歴を再表示';
  }catch{if(version===requestVersion)$('status').textContent='更新前の履歴を取得できませんでした。';}
  finally{if(version===requestVersion){busy(false);render();}}
 });
 load();
})();
