/* Shared deterministic analysis; browser + Worker. No AI, no price targets. */
const RadarAnalysis = (() => {
  const num = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? v : null;
  const ratio = (a,b) => num(a) !== null && num(b) !== null && b > 0 ? a / b * 100 : null;
  const code = s => String(s || '').normalize('NFKC').toUpperCase().replace(/\s/g,'').replace(/^([0-9A-Z]{4})0$/, '$1');
  const rounded = n => new Intl.NumberFormat('ja-JP',{maximumFractionDigits:2}).format(n);
  const money = n => num(n) === null ? 'データなし' : Math.abs(n)>=1e8 ? rounded(n/1e8)+'億円' : Math.abs(n)>=1e4 ? rounded(n/1e4)+'万円' : rounded(n)+'円';
  const percent = n => num(n) === null ? 'データなし' : rounded(n)+'%';
  const fields = {
    orderAmount:'受注額',revenue:'前期売上高',operatingProfit:'前期営業利益',
    oldRevenue:'旧売上予想',newRevenue:'新売上予想',oldOperatingProfit:'旧営業利益予想',newOperatingProfit:'新営業利益予想',
    oldOrdinaryProfit:'旧経常利益予想',newOrdinaryProfit:'新経常利益予想',oldNetProfit:'旧純利益予想',newNetProfit:'新純利益予想',oldEps:'旧EPS',newEps:'新EPS',
    oldDividend:'旧年間配当',newDividend:'新年間配当',dividendEps:'配当と同年度のEPS',
    buybackAmount:'取得総額上限',buybackShares:'取得株数上限',buybackReportedPct:'開示記載の取得比率',marketCap:'時価総額',issuedShares:'現在の発行済株式数',
    newShares:'新規発行株式数',potentialShares:'新株予約権の潜在株式数',proceeds:'調達金額',
    acquisitionPrice:'買収金額',targetRevenue:'対象企業の売上高',targetProfit:'対象企業の年間純利益',acquiredPercent:'取得持分比率',goodwill:'のれん',cash:'現金及び現金同等物',debt:'有利子負債'
  };
  const perShare = new Set(['oldEps','newEps','oldDividend','newDividend','dividendEps']);
  const shares = new Set(['buybackShares','issuedShares','newShares','potentialShares']);
  const percentages = new Set(['buybackReportedPct','acquiredPercent']);
  function parse(value, key) {
    if (typeof value === 'number') return num(value);
    const s = String(value || '').normalize('NFKC').trim().replace(/[△▲]/g,'-');
    if (!s) return null;
    const m = s.match(/^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(億|百万|千万|万|千)?\s*(円|株|%)?$/);
    if (!m) return null;
    if (shares.has(key) && m[3] && m[3] !== '株') return null;
    if (percentages.has(key) && ((m[3] && m[3] !== '%') || m[2])) return null;
    if (!shares.has(key) && !percentages.has(key) && m[3] && m[3] !== '円') return null;
    if (perShare.has(key) && m[2]) return null;
    const result = Number(m[1].replaceAll(',','')) * ({億:1e8,百万:1e6,千万:1e7,万:1e4,千:1e3}[m[2]] || 1);
    return num(result) !== null && (!shares.has(key) || (Number.isInteger(result) && result >= 0)) ? result : null;
  }
  function extract(text) {
    const values = {}, evidence = {}, conflicts = [];
    for (const line of String(text || '').normalize('NFKC').split(/\r?\n/)) {
      const m = line.trim().match(/^(.{1,40}?)\s*[:：]\s*(.+)$/);
      if (!m) continue;
      const key = Object.keys(fields).find(k=>fields[k] === m[1].trim());
      if (!key) continue;
      const value = parse(m[2],key);
      if (value === null) continue;
      if (Object.hasOwn(values,key) && values[key] !== value) conflicts.push(key);
      values[key] = value; evidence[key] = line.trim();
    }
    for (const key of conflicts) { delete values[key]; delete evidence[key]; }
    return {values,evidence,conflicts:[...new Set(conflicts)]};
  }
  function change(a,b) {
    if (num(a) === null || num(b) === null) return {value:null,text:'データなし'};
    if (a === 0) return {value:null,text:'旧値が0のため率は算出不可'};
    if (a < 0) return {value:null,text:b>0?'黒字転換':b===0?'損益均衡':b>a?'赤字縮小':b<a?'赤字拡大':'赤字額は同じ'};
    const value = (b-a)/a*100;
    return {value,text:(value>0?'+':'')+percent(value)+(b<0?'（赤字転落）':'')};
  }
  function selectFinancials(company, detail) {
    if (!company || code(company.code) !== code(detail.code)) return null;
    const date = String(detail.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
    const cutoff = Date.parse(date+'T'+(detail.time || '23:59')+':59+09:00');
    if (!Number.isFinite(cutoff)) return null;
    return (company.records || []).filter(r=>r.sourceUrl && ['consolidated','standalone'].includes(r.scope) && Date.parse(r.publishedAt)<=cutoff && Date.parse(r.periodEnd)<=cutoff)
      .sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd)||b.publishedAt.localeCompare(a.publishedAt))[0] || null;
  }
  function analyze(detail, company = null) {
    const f = detail.facts || {}, categories = detail.categories || [];
    const a = {version:'3.0',impact:'判定できません',sustainability:'不明',scale:'データなし',financialBurden:'不明',guidance:f.guidance==='included'?'織り込み済み':f.guidance==='excluded'?'未織り込み':'不明',metrics:[],warnings:[],checkpoints:[],provenance:[],primary:null};
    const add = (key,label,value,unit='money',note='') => {
      value=num(value); const m={key,label,value,unit,text:value===null?'データなし':unit==='pct'?percent(value):unit==='shares'?rounded(value)+'株':unit==='multiple'?rounded(value)+'倍':money(value),note};
      a.metrics.push(m); return m;
    };
    const warn = s => { if(!a.warnings.includes(s))a.warnings.push(s); };
    const point = s => { if(!a.checkpoints.includes(s))a.checkpoints.push(s); };
    const basis = selectFinancials(company,detail);
    const manualBasis = Object.hasOwn(f,'revenue') || Object.hasOwn(f,'operatingProfit');
    const revenue = num(manualBasis?f.revenue:basis?.revenue), op = num(manualBasis?f.operatingProfit:basis?.operatingProfit);
    if (manualBasis) { a.provenance.push({label:'比較用業績：利用者の確認値',period:f.financialPeriod||'対象年度未指定',url:detail.sourceUrl||detail.originalUrl||''}); if(!f.financialPeriod)warn('比較業績の対象年度を確認してください。'); }
    else if (basis) {
      a.provenance.push({label:'EDINET 有価証券報告書（加工データ）',period:basis.periodEnd+' / '+(basis.scope==='consolidated'?'連結':'単体'),url:basis.sourceUrl,publishedAt:basis.publishedAt});
      if(Date.parse(String(detail.date).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'))-Date.parse(basis.periodEnd)>550*864e5)warn('比較対象の決算期末から550日以上経過しています。最新の決算と照合してください。');
    }
    if (detail.sourceKind==='manual')warn('数値は利用者が原文と照合した入力値です。自動抽出の候補だけでは確定しません。');
    function scale(value, large, medium) { return num(value)===null?'データなし':Math.abs(value)>=large?'大きい':Math.abs(value)>=medium?'中程度':'小さい'; }
    if(categories.includes('大型受注')) {
      add('orderAmount','受注額',f.orderAmount); add('revenue','前期売上高',revenue); add('operatingProfit','前期営業利益',op);
      const r=ratio(f.orderAmount,revenue); a.primary=add('orderRatio','年間売上高に対する受注額',r,'pct','案件全体と単年度売上高の比較');
      const margin=ratio(op,revenue);add('margin','過去営業利益率',margin,'pct');
      const estimate=num(f.orderAmount)!==null && f.orderAmount>=0 && margin>0 ? f.orderAmount*margin/100:null;
      add('estimatedProfit','営業利益への概算寄与（案件全体）',estimate,'money','従来と同じ採算を仮定');add('estimatedProfitRatio','前期営業利益に対する概算',ratio(estimate,op),'pct','単年度の増益率ではありません');
      a.scale=scale(r,20,5);a.impact=r===null?'判定できません':a.scale==='大きい'?'大きい可能性（売上規模）':a.scale==='中程度'?'中程度の可能性（売上規模）':'限定的な可能性（売上規模）';
      a.sustainability=f.contractYears>1?'複数年度の可能性':f.contractYears===1?'1年間の案件':'不明';
      warn('概算です。実際の利益率は不明。売上計上時期・費用・為替によって寄与は変わります。');
      if(op!==null && op<=0)warn('過去営業利益が0以下のため利益寄与の概算は行いません。');
      point('契約期間：'+(f.contractPeriod||'データなし'));point('売上計上予定：'+(f.recognitionPeriod||'データなし'));point('次回決算で受注残・売上計上・案件採算を確認。');
    }
    if(categories.some(c=>['上方修正','下方修正','赤字転落'].includes(c))) {
      let primary;
      for(const [key,label] of [['Revenue','売上高'],['OperatingProfit','営業利益'],['OrdinaryProfit','経常利益'],['NetProfit','純利益'],['Eps','EPS']]) {
        const before=num(f['old'+key]),after=num(f['new'+key]);
        const diff=key==='Eps' && f.perShareComparable!==true?{value:null,text:'株式分割等の基準を確認してください'}:change(before,after);
        const m=add('revision'+key,label+'予想修正率',diff.value,'pct',money(before)+' → '+money(after));m.text=diff.text;
        if(key==='OperatingProfit')primary=m;
      }
      if(!a.primary)a.primary=primary;
      a.scale=scale(primary.value,20,5);a.impact=primary.value===null?'判定できません':a.scale+'修正（営業利益）';a.sustainability='対象予想期間内';
      point('一時損益・為替・本業の数量や採算を分けて確認。');warn('修正前が0または赤字の場合、通常の修正率を表示せず損益の変化で示します。');
    }
    if(categories.some(c=>['増配','減配'].includes(c))) {
      add('oldDividend','旧年間配当',f.oldDividend);add('newDividend','新年間配当',f.newDividend);
      const diff=f.perShareComparable===true?change(f.oldDividend,f.newDividend):{value:null,text:'株式分割等の基準を確認してください'};
      const m=add('dividendChange','年間配当の増減率',diff.value,'pct');m.text=diff.text;if(!a.primary)a.primary=m;
      add('dividendEps','配当と同年度のEPS',f.dividendEps);
      const payout=f.dividendEpsSamePeriod===true && f.perShareComparable===true?ratio(f.newDividend,f.dividendEps):null;
      add('payout','配当性向',payout,'pct');if(payout>100)warn('配当性向が100%を超えています。利益以外の原資・継続性を確認してください。');
      if(num(f.newDividend)!==null && f.newDividend>f.oldDividend && num(f.newEps)!==null && num(f.oldEps)!==null && f.newEps<=f.oldEps)warn('増配に対してEPSが増えていません。配当原資を確認してください。');
      warn('配当とEPSは同年度・同じ株数基準で比較します。赤字・EPSが0の場合は配当性向を算出しません。');point('普通配当と記念・特別配当を区別し、次年度の方針を確認。');
    }
    if(categories.includes('自社株買い')) {
      add('buybackAmount','自社株買い金額上限',f.buybackAmount);add('marketCap','時価総額',f.marketCap,'money',f.marketCapAsOf?'基準日 '+f.marketCapAsOf:'基準日なし');
      const r=/^\d{4}-\d{2}-\d{2}$/.test(f.marketCapAsOf||'')?ratio(f.buybackAmount,f.marketCap):null;
      const m=add('buybackRatio','自社株買い金額 ÷ 時価総額',r,'pct');if(!a.primary)a.primary=m;a.scale=scale(r,5,1);
      add('buybackShares','取得株数上限',f.buybackShares,'shares');add('buybackShareRatio','発行済株式数に対する取得上限',ratio(f.buybackShares,f.issuedShares),'pct','入力した発行済株式数（自己株式を含む）が分母');add('reportedRatio','開示記載の取得比率',f.buybackReportedPct,'pct','自己株式を除く等、分母を原文で確認');
      a.sustainability='取得期間内';warn('取得枠は上限です。全額の実施や消却は確約されません。直接の営業増益ではありません。');point('取得期間：'+(f.buybackPeriod||'データなし'));point('取得実績・消却予定・手元資金の変化を確認。');
    }
    if(categories.includes('希薄化')) {
      add('newShares','新規発行株式数',f.newShares,'shares');add('issuedShares','現在の発行済株式数',f.issuedShares,'shares');
      const r=ratio(f.newShares,f.issuedShares);const m=add('dilution','新規発行株式数 ÷ 現在の発行済株式数',r,'pct');if(!a.primary)a.primary=m;
      add('ownershipLoss','既存持分の減少率',num(f.newShares)!==null&&num(f.issuedShares)!==null?ratio(f.newShares,f.issuedShares+f.newShares):null,'pct','新株 ÷ 発行後株式数');
      add('potentialDilution','新株予約権の潜在希薄化率',ratio(f.potentialShares,f.issuedShares),'pct','全行使を仮定。新株発行分とは合算しません');add('proceeds','調達金額',f.proceeds);
      a.scale=scale(r,20,5);a.sustainability='発行後も株数に影響';point('資金用途：'+(f.fundUse||'データなし'));point('調達資金が利益成長につながる時期と、追加行使の状況を確認。');warn('議決権ベースの公式希薄化率とは異なることがあります。');
    }
    if(categories.includes('M&A')||categories.includes('出資・投資')) {
      add('acquisitionPrice','買収金額',f.acquisitionPrice);add('targetRevenue','対象企業の売上高',f.targetRevenue);add('targetProfit','対象企業の年間純利益',f.targetProfit);add('acquiredPercent','取得持分比率',f.acquiredPercent,'pct');
      const profit=f.acquisitionBasisConfirmed===true && f.acquiredPercent>0 && f.acquiredPercent<=100 && num(f.targetProfit)!==null?f.targetProfit*f.acquiredPercent/100:null;
      const m=add('acquisitionMultiple','買収金額 ÷ 取得持分相当の年間純利益',num(f.acquisitionPrice)!==null&&profit>0?f.acquisitionPrice/profit:null,'multiple');if(!a.primary)a.primary=m;
      add('goodwill','のれん',f.goodwill);add('cash','現金及び現金同等物',f.cash);add('debt','有利子負債',f.debt);const burden=ratio(f.acquisitionPrice,f.cash);add('cashBurden','買収金額 ÷ 現金及び現金同等物',burden,'pct');a.financialBurden=burden===null?'不明':burden>=50?'現金に対して大きい':'現金との比率を確認';
      a.sustainability='複数年度の可能性';warn('利益倍率は回収年数の予測ではありません。株式取得対価と同じ持分・利益基準か確認してください。');point('資金調達、対象会社の負債、統合費用、のれんの減損リスクを確認。');
    }
    if(categories.includes('業務提携'))point('収益モデル、具体的な契約金額、事業化時期を次の開示で確認。');
    if(categories.includes('株式分割'))warn('株式分割だけで会社全体の利益や企業価値は増えません。1株指標の基準日を確認してください。');
    if(categories.includes('TOB'))point('買付主体・価格・期間・成立条件・上場維持方針を原文で確認。');
    point('会社の業績予想への織り込み：'+a.guidance+'。次回決算で確認。');
    if(!a.metrics.some(m=>m.value!==null))warn('定量データがないため、金額・割合・業績への影響を推測しません。原文から数値を追加できます。');
    if(detail.demo)warn('これは架空のサンプルです。実際の開示・銘柄ではありません。');
    a.provenance.push({label:detail.sourceKind==='manual'?'開示原文・確認入力':'TDnet（タイトルと原文リンク）',url:detail.sourceUrl||detail.originalUrl||'',period:detail.date||''});
    a.coverage={available:a.metrics.filter(m=>m.value!==null).length,total:a.metrics.length};
    return a;
  }
  return {num,ratio,code,money,percent,rounded,fields,perShare,shares,percentages,parse,extract,change,selectFinancials,analyze};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=RadarAnalysis;
