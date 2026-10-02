(async()=>{
 const U=RadarUI,A=RadarAnalysis,$=id=>document.getElementById(id);let base={},companyData=null,autoValues={},evidence={},autoPeriod='',lookupVersion=0;
 const groups={大型受注:['orderAmount','revenue','operatingProfit'],上方修正:['oldRevenue','newRevenue','oldOperatingProfit','newOperatingProfit','oldOrdinaryProfit','newOrdinaryProfit','oldNetProfit','newNetProfit','oldEps','newEps'],増配:['oldDividend','newDividend','dividendEps','oldEps','newEps'],自社株買い:['buybackAmount','marketCap','buybackShares','issuedShares','buybackReportedPct'],希薄化:['newShares','issuedShares','potentialShares','proceeds'],'M&A':['acquisitionPrice','targetRevenue','targetProfit','acquiredPercent','goodwill','cash','debt']};groups.下方修正=groups.赤字転落=groups.上方修正;groups.減配=groups.増配;groups['出資・投資']=groups['M&A'];
 U.types.forEach(c=>$('category').add(new Option(c,c)));$('date').value=U.today();
 let selected=[$('category').value];
 function keys(){return [...new Set(selected.flatMap(c=>groups[c]||[]))];}
 function extraInput(id,label,type='text',placeholder=''){return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" placeholder="${placeholder}"></div>`;}
 function check(id,label){return `<label class="check"><input type="checkbox" id="${id}" name="${id}"><span>${label}</span></label>`;}
 function render(facts={}){
 $('numeric-fields').innerHTML=keys().map(k=>`<div class="field"><label for="f-${k}">${U.esc(A.fields[k])}</label><input id="f-${k}" name="${k}" data-numeric="${k}" inputmode="decimal" placeholder="データなし" value="${facts[k]==null?'':U.esc(facts[k])}"></div>`).join('');
 let extras='';if(selected.includes('大型受注'))extras+=extraInput('contractPeriod','契約期間')+extraInput('contractYears','契約年数（明記されている場合）','number')+extraInput('recognitionPeriod','売上計上予定時期');
 if(selected.includes('自社株買い'))extras+=extraInput('marketCapAsOf','時価総額の基準日','date')+extraInput('buybackPeriod','取得期間');if(selected.includes('希薄化'))extras+=extraInput('fundUse','資金用途');
 if(selected.some(c=>['増配','減配','上方修正','下方修正','赤字転落'].includes(c)))extras+=check('perShareComparable','EPS・年間配当の新旧は、株式分割等を調整した同じ株数基準です。');
 if(selected.some(c=>['増配','減配'].includes(c)))extras+=check('dividendEpsSamePeriod','年間配当とEPSは同じ年度・同じ予想または実績の組み合わせです。');
 if(selected.some(c=>['M&A','出資・投資'].includes(c)))extras+=check('acquisitionBasisConfirmed','株式取得対価と持分に対応する年間純利益を入力しました（事業価値と株式価値を混在させていません）。');
 $('extra-fields').innerHTML='<div class="form-grid">'+extras+'</div>';
 for(const el of $('extra-fields').querySelectorAll('input')){if(el.type==='checkbox')el.checked=facts[el.name]===true;else el.value=facts[el.name]??'';}
 }
 function currentFacts(){return Object.fromEntries([...document.querySelectorAll('[data-numeric],#extra-fields input')].map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));}
 function invalidateFinance(){
  lookupVersion++;
  for(const [k,v] of Object.entries(autoValues)){const input=$('f-'+k);if(input&&A.parse(input.value,k)===v)input.value='';}
  if($('financialPeriod').value===autoPeriod)$('financialPeriod').value='';
  companyData=null;autoValues={};autoPeriod='';
 }
 function applyRecord(company,record){
  companyData=company;
  const basisKeys=['revenue','operatingProfit'];
  const manual=basisKeys.some(k=>{const el=$('f-'+k);return el?.value.trim()&&A.parse(el.value,k)!==autoValues[k];});
  if(!manual){
   for(const k of basisKeys){const el=$('f-'+k);if(el){el.value=A.num(record[k])===null?'':record[k];if(A.num(record[k])!==null)autoValues[k]=record[k];else delete autoValues[k];}}
   autoPeriod=record.periodEnd+' / '+(record.scope==='consolidated'?'連結':'単体');$('financialPeriod').value=autoPeriod;
  }
  const source=U.safeUrl(record.sourceUrl);
  $('finance-status').innerHTML=U.esc('取得：'+record.periodEnd+' / '+(record.scope==='consolidated'?'連結':'単体')+'。公表日時 '+new Date(record.publishedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+(manual?'。入力済みの比較値を優先し、自動入力は行いません。':'。売上高・営業利益がある開示種類では比較値に使います。'))+(source?` <a href="${U.esc(source)}" target="_blank" rel="noopener noreferrer" class="button secondary">出典を確認</a>`:'');
  $('confirmed').checked=false;
 }
 $('category').addEventListener('change',()=>{const existing=currentFacts();selected=[$('category').value];render(existing);const record=A.selectFinancials(companyData,{code:$('code').value,date:$('date').value,time:$('time').value});if(record)applyRecord(companyData,record);$('confirmed').checked=false;});render();
 const from=new URLSearchParams(location.search).get('from');
 if(from){try{base=await U.getDetail(from);companyData=base.companyFinancials||null;for(const k of ['company','code','title','time'])$(k).value=k==='code'?A.code(base[k]):base[k]||'';$('date').value=U.iso(base.date);$('sourceUrl').value=base.sourceUrl||base.originalUrl||(base.demo?'https://example.com/tdnet-demo':'');$('bodyText').value=base.bodyText||'';selected=base.categories||[$('category').value];$('category').value=selected[0];render(base.facts||{});$('financialPeriod').value=base.facts?.financialPeriod||'';$('guidance').value=base.facts?.guidance||'unknown';const record=A.selectFinancials(companyData,base);if(record)applyRecord(companyData,record);if(base.demo)$('form-status').textContent='架空サンプルの編集です。保存後もサンプルとして区別します。';}catch{$('form-status').textContent='元の分析を取得できません。原文を確認して入力してください。';}}
 $('analysis-form').addEventListener('input',e=>{if(e.target!==$('confirmed'))$('confirmed').checked=false;if(e.target===$('code')||e.target===$('date')||e.target===$('time')){invalidateFinance();$('finance-status').textContent='企業・開示日時を変更しました。比較業績を再取得してください。';}});
 $('lookup').addEventListener('click',async()=>{
  const requestedCode=A.code($('code').value),requestedDate=$('date').value,requestedTime=$('time').value;
  if(!/^[0-9A-Z]{4}$/.test(requestedCode)||!requestedDate||!requestedTime){$('finance-status').textContent='銘柄コード・開示日・時刻を先に入力してください。';return;}
  const version=++lookupVersion;$('lookup').disabled=true;$('finance-status').textContent='公表済みの決算を確認しています…';
  try{
   const data=await U.financials();
   if(version!==lookupVersion||requestedCode!==A.code($('code').value)||requestedDate!==$('date').value||requestedTime!==$('time').value)return;
   const company=data.companies?.[requestedCode];
   const record=A.selectFinancials(company,{code:requestedCode,date:requestedDate,time:requestedTime});
   if(!record){invalidateFinance();$('finance-status').textContent=U.financeMessage(data)+' 原文から比較値を入力できます。';return;}
   applyRecord(company,record);
  }catch{ $('finance-status').textContent='業績データを取得できませんでした。通信状態を確認して再試行してください。'; }
  finally{$('lookup').disabled=false;}
 });
 $('extract').addEventListener('click',()=>{const r=A.extract($('bodyText').value);let count=0;for(const [k,v]of Object.entries(r.values)){const input=$('f-'+k);if(input&&!input.value){input.value=v;evidence[k]=r.evidence[k];count++;}}$('extract-status').textContent=count+'項目の候補を入力しました。原文で確定してください。'+(r.conflicts.length?'値が競合する項目は除外：'+r.conflicts.map(k=>A.fields[k]).join('、'):'');$('confirmed').checked=false;});
 $('pdf').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10e6)throw Error('10MB以下のファイルを指定してください');$('extract-status').textContent='端末内で読み込み中…';let body;if(/\.pdf$/i.test(file.name)){const pdfjs=await U.withTimeout(import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.min.mjs'),15000,'PDF読込機能を取得できません。通信状態を確認してください');pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs';const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});let pdf;try{pdf=await U.withTimeout(task.promise,20000,'PDFを読み込めませんでした。テキストを貼り付けてください');}catch(error){await task.destroy();throw error;}const lines=[];try{for(let p=1;p<=Math.min(pdf.numPages,50);p++){const content=await(await pdf.getPage(p)).getTextContent();lines.push(content.items.map(t=>t.str+(t.hasEOL?'\n':' ')).join(''));if(lines.join('\n').length>30000)break;}}finally{await pdf.destroy();}body=lines.join('\n');}else body=await file.text();$('bodyText').value=body.slice(0,30000);$('extract-status').textContent=body.trim()?'テキストを読み込みました（最大50ページ・30,000文字）。内容を照合して候補を抽出してください。':'文字を取得できませんでした。画像PDFは手入力してください。';$('confirmed').checked=false;}catch(error){$('extract-status').textContent='読込できません：'+error.message;}});
 $('analysis-form').addEventListener('submit',e=>{e.preventDefault();try{
 if(!$('confirmed').checked)throw Error('原文との照合を確認してください');
 const facts={};for(const el of document.querySelectorAll('[data-numeric]')){if(!el.value.trim())continue;const key=el.dataset.numeric,value=A.parse(el.value,key);if(value===null)throw Error(A.fields[key]+'の単位や数値を確認してください');if(!/(Profit|Eps)/.test(key)&&value<0)throw Error(A.fields[key]+'には0以上を入力してください');if(A.percentages.has(key)&&value>100)throw Error(A.fields[key]+'は100%以下で入力してください');facts[key]=value;}
 const manualBasis=['revenue','operatingProfit'].some(k=>Object.hasOwn(facts,k));if(manualBasis&&!$('financialPeriod').value.trim())throw Error('比較業績の対象年度・連結区分を入力してください');
 for(const el of $('extra-fields').querySelectorAll('input')){if(el.type==='checkbox')facts[el.name]=el.checked;else if(el.value.trim()){if(el.name==='contractYears'){const n=Number(el.value);if(!(n>0&&n<=100))throw Error('契約年数は1〜100年で入力してください');facts[el.name]=n;}else facts[el.name]=el.value.trim();}}
 facts.financialPeriod=$('financialPeriod').value.trim();facts.guidance=$('guidance').value;
 if(companyData && $('financialPeriod').value===autoPeriod && ['revenue','operatingProfit'].every(k=>facts[k]===autoValues[k])){delete facts.revenue;delete facts.operatingProfit;}
 if(!/^[0-9A-Z]{4}$/.test(A.code($('code').value)))throw Error('銘柄コードは4桁（英字を含む）で入力してください');
 const sourceUrl=U.safeUrl($('sourceUrl').value);if(!sourceUrl)throw Error('原文のHTTPS URLを入力してください');
 const d={id:base.id?.startsWith('local-')?base.id:'local-'+crypto.randomUUID(),company:$('company').value.trim(),code:A.code($('code').value),date:$('date').value.replaceAll('-',''),time:$('time').value,title:$('title').value.trim(),categories:selected,facts,sourceKind:'manual',sourceUrl,originalUrl:sourceUrl,bodyText:$('bodyText').value,evidence,createdAt:base.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),demo:!!base.demo,...(companyData?{companyFinancials:companyData}:{})};
 U.save([d,...U.local().filter(r=>r.id!==d.id)]);location.href='detail.html?id='+encodeURIComponent(d.id);
 }catch(error){$('form-status').textContent=error.message;$('form-status').scrollIntoView({block:'center'});}});
})();
