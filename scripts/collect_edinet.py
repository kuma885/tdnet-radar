"""EDINET API v2 collector. Standard library only; no website scraping.
Amounts are JPY (XBRL decimals is precision, never a scale). Unknown facts stay absent.
"""
import argparse, datetime as dt, io, json, os, re, time, urllib.parse, urllib.request, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS={'x':'http://www.xbrl.org/2003/instance','d':'http://xbrl.org/2006/xbrldi'}
TAGS={
 'revenue':['NetSales','RevenueIFRS','Revenue','NetSalesSummaryOfBusinessResults','RevenueIFRSSummaryOfBusinessResults'],
 'operatingProfit':['OperatingIncome','OperatingProfitLossIFRS','OperatingIncomeLossSummaryOfBusinessResults'],
 'ordinaryProfit':['OrdinaryIncome','OrdinaryIncomeLossSummaryOfBusinessResults'],
 'netProfit':['ProfitLossAttributableToOwnersOfParent','ProfitLossAttributableToOwnersOfParentIFRS','ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults'],
 'eps':['BasicEarningsLossPerShareIFRS','BasicEarningsLossPerShareSummaryOfBusinessResults','BasicEarningsLossPerShareIFRSSummaryOfBusinessResults'],
 'cash':['CashAndCashEquivalents','CashAndCashEquivalentsIFRS','CashAndCashEquivalentsSummaryOfBusinessResults'],
 'dividendPerShare':['DividendPaidPerShareSummaryOfBusinessResults']
}
def local_name(tag):return tag.rsplit('}',1)[-1]
def normalize_code(value):return re.sub(r'^([0-9A-Z]{4})0$',r'\1',str(value or '').upper())
def parse_xbrl(raw,document):
 if len(raw)>40_000_000 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ValueError('Unsafe or oversized XBRL')
 root=ET.fromstring(raw); contexts={};units={}
 for u in root.findall('x:unit',NS):
  measures=[e.text.rsplit(':',1)[-1] for e in u.findall('x:measure',NS) if e.text]
  if measures==['JPY']:units[u.get('id')]='JPY'
  if u.find('x:divide',NS) is not None:
   n=u.findtext('x:divide/x:unitNumerator/x:measure',default='',namespaces=NS).rsplit(':',1)[-1]
   d=u.findtext('x:divide/x:unitDenominator/x:measure',default='',namespaces=NS).rsplit(':',1)[-1]
   if n=='JPY' and d=='shares':units[u.get('id')]='JPY/share'
 for c in root.findall('x:context',NS):
  entity=c.findtext('x:entity/x:identifier',default='',namespaces=NS)
  if entity!=document.get('edinetCode'):continue
  members=c.findall('.//d:explicitMember',NS)
  if c.findall('.//d:typedMember',NS):continue
  if any((e.text or '').rsplit(':',1)[-1] not in ['NonConsolidatedMember','ConsolidatedMember'] for e in members):continue
  scope='standalone' if any((e.text or '').endswith(':NonConsolidatedMember') for e in members) or 'NonConsolidated' in c.get('id','') else 'consolidated'
  end=c.findtext('x:period/x:endDate',namespaces=NS);start=c.findtext('x:period/x:startDate',namespaces=NS);instant=c.findtext('x:period/x:instant',namespaces=NS)
  try:
   if end and start:
    length=(dt.date.fromisoformat(end)-dt.date.fromisoformat(start)).days
    if not 330<=length<=380:continue
    contexts[c.get('id')]={'periodEnd':end,'periodStart':start,'scope':scope,'instant':False}
   elif instant:dt.date.fromisoformat(instant);contexts[c.get('id')]={'periodEnd':instant,'scope':scope,'instant':True}
  except ValueError:continue
 values={}
 for e in root:
  tag=local_name(e.tag);key=next((k for k,t in TAGS.items() if tag in t),None)
  if not key or e.get('{http://www.w3.org/2001/XMLSchema-instance}nil')=='true':continue
  context=contexts.get(e.get('contextRef'));unit=units.get(e.get('unitRef'))
  if not context:continue
  if key=='eps' and unit!='JPY/share':continue
  if key=='dividendPerShare' and unit not in ['JPY','JPY/share']:continue
  if key not in ['eps','dividendPerShare'] and unit!='JPY':continue
  if context['instant']!=(key=='cash'):continue
  if not re.fullmatch(r'[+-]?\d+(?:\.\d+)?',e.text or ''):continue
  value=float(e.text)
  if abs(value)>2**53-1:continue
  group=(context['periodEnd'],context['scope'],key);rank=TAGS[key].index(tag)
  values.setdefault(group,[]).append((rank,value,tag,unit,context))
 resolved={}
 for group,candidates in values.items():
  rank=min(x[0] for x in candidates);best=[x for x in candidates if x[0]==rank]
  if len({x[1] for x in best})!=1:continue
  resolved[group]=best[0]
 records=[]
 for period in sorted({key[0] for key in resolved},reverse=True)[:6]:
  scope='consolidated' if (period,'consolidated','revenue') in resolved else 'standalone'
  rev=resolved.get((period,scope,'revenue'))
  if not rev:continue
  published=document.get('submitDateTime','').replace(' ','T')
  if len(published)==16:published+=':00'
  if not re.search(r'(Z|[+-]\d\d:\d\d)$',published):published+='+09:00'
  r={'periodEnd':period,'periodStart':rev[4]['periodStart'],'scope':scope,'publishedAt':published,'documentId':document['docID'],'sourceUrl':'https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?'+document['docID'],'factSources':{}}
  for key in TAGS:
   item=resolved.get((period,scope,key))
   # Dividends are the issuer's per-share payment, not a consolidated segment fact.
   if key=='dividendPerShare' and not item:item=resolved.get((period,'standalone',key))
   if item:r[key]=item[1];r['factSources'][key]={'tag':item[2],'unit':item[3],'scope':item[4]['scope']}
  records.append(r)
 return records

def parse_zip(raw,document):
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  files=[i for i in z.infolist() if '/PublicDoc/' in '/'+i.filename and i.filename.lower().endswith('.xbrl')]
  if sum(i.file_size for i in files)>60_000_000:raise ValueError('Expanded XBRL exceeds budget')
  records=[]
  for f in files:records.extend(parse_xbrl(z.read(f),document))
  # Multiple instances for a period are ambiguous; avoid overwriting silently.
  seen={}
  for r in records:
   key=(r['periodEnd'],r['scope'])
   if key in seen and seen[key]!=r:seen[key]=None
   else:seen[key]=r
  return [r for r in seen.values() if r]

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
class Client:
 def __init__(self,key):self.key=key;self.last=0;self.opener=urllib.request.build_opener(NoRedirect)
 def request(self,path,**params):
  time.sleep(max(0,1.1-(time.monotonic()-self.last)));self.last=time.monotonic()
  query=urllib.parse.urlencode({**params,'Subscription-Key':self.key})
  try:
   with self.opener.open('https://api.edinet-fsa.go.jp/api/v2/'+path+'?'+query,timeout=40) as r:
    content=r.read(25_000_001)
    if len(content)>25_000_000:raise ValueError('size limit')
    return content
  except Exception:raise RuntimeError('EDINET API request failed (credentials and response omitted)') from None

def atomic(path,value):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8');tmp.replace(path)
def collect(output,key):
 client=Client(key);today=dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date();statepath=output.parent/'edinet-state.json'
 state=json.loads(statepath.read_text()) if statepath.exists() else {'cursor':str(today-dt.timedelta(days=2)),'done':[],'pending':{}}
 data=json.loads(output.read_text()) if output.exists() else {'schemaVersion':1,'companies':{}}
 cursor=dt.date.fromisoformat(state['cursor']);days={today,today-dt.timedelta(days=1)}
 for _ in range(10):
  if (today-cursor).days<=400:days.add(cursor);cursor-=dt.timedelta(days=1)
 state['cursor']=str(cursor);done=set(state['done']);pending=state['pending']
 for day in sorted(days,reverse=True):
  result=json.loads(client.request('documents.json',date=str(day),type=2))
  if str(result.get('metadata',{}).get('status'))!='200':raise RuntimeError('EDINET list status was not 200')
  for doc in result.get('results',[]):
   docid=doc.get('docID');code=normalize_code(doc.get('secCode'))
   if not docid:continue
   if doc.get('withdrawalStatus')=='1' or doc.get('disclosureStatus')=='1':
    pending.pop(docid,None)
    for c in data['companies'].values():c['records']=[r for r in c['records'] if r.get('documentId')!=docid]
    continue
   if doc.get('docTypeCode') in ['120','130'] and doc.get('xbrlFlag')=='1' and re.fullmatch('[0-9A-Z]{4}',code) and docid not in done:pending[docid]=doc
 processed=0;skipped=0
 for docid,doc in list(pending.items())[:80]:
  raw=client.request('documents/'+urllib.parse.quote(docid,safe=''),type=1)
  try:records=parse_zip(raw,doc)
  except (ValueError,zipfile.BadZipFile,ET.ParseError):skipped+=1;continue
  code=normalize_code(doc['secCode']);c=data['companies'].setdefault(code,{'code':code,'company':doc.get('filerName',''),'records':[]})
  c['records']=[r for r in c['records'] if r.get('documentId')!=docid]+records
  c['records']=sorted(c['records'],key=lambda r:(r['periodEnd'],r['publishedAt']),reverse=True)[:18]
  done.add(docid);del pending[docid];processed+=1
 data.update(schemaVersion=1,status='warming_up' if (today-cursor).days<=400 or pending else 'ready',updatedAt=dt.datetime.now(dt.timezone.utc).isoformat(),attribution='金融庁EDINET APIを基にTDnetレーダーが加工。原書類の確認が必要。',termsUrl='https://disclosure2.edinet-fsa.go.jp/guide/static/disclosure/WZEK0110.html',coverage={'companies':len(data['companies']),'pendingDocuments':len(pending),'backfillCursor':str(cursor),'skippedThisRun':skipped})
 state['done']=sorted(done);atomic(output,data);atomic(statepath,state)
 print(f'EDINET: companies={len(data["companies"])}, processed={processed}, pending={len(pending)}, skipped={skipped}')
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path('data/financials.json'));args=parser.parse_args();key=os.environ.get('EDINET_API_KEY','')
 if not key:print('EDINET_API_KEY is not configured; no network requests made.')
 else:
  try:collect(args.output,key)
  except Exception:raise SystemExit('EDINET update failed; previous published dataset retained. No secrets logged.') from None
