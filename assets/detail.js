(async()=>{
 const U=RadarUI,$=id=>document.getElementById(id),q=new URLSearchParams(location.search);const fallback=U.safeTdnet(q.get('original'));
 if(fallback)$('original-link').href=fallback;
 $('print').addEventListener('click',()=>window.print());
 try{const d=await U.getDetail(q.get('id'));$('content').innerHTML=U.detail(d);$('detail-status').textContent='';const original=U.safeUrl(d.sourceUrl||d.originalUrl);if(original)$('original-link').href=original;$('original-link').hidden=!!d.demo;$('edit-link').hidden=false;$('edit-link').href='analyze.html?from='+encodeURIComponent(d.id);}
 catch{$('detail-status').innerHTML='<section class="panel"><h1>分析を取得できません</h1><p>通信状態、リンク、保存期間を確認してください。通知に原文リンクがある場合は下のボタンから原文を開けます。</p></section>';}
})();
