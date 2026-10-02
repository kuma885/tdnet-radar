import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('edinet',Path(__file__).parents[1]/'scripts/collect_edinet.py');E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
DOC={'edinetCode':'E12345','docID':'S100TEST','submitDateTime':'2026-06-20 15:00','secCode':'12340'}
def xml(facts,extra='',currency='JPY',entity='E12345',start='2025-04-01'):
 return f'''<x:xbrl xmlns:x="http://www.xbrl.org/2003/instance" xmlns:j="http://example.test" xmlns:d="http://xbrl.org/2006/xbrldi"><x:unit id="JPY"><x:measure>iso4217:{currency}</x:measure></x:unit><x:context id="annual"><x:entity><x:identifier>{entity}</x:identifier></x:entity><x:period><x:startDate>{start}</x:startDate><x:endDate>2026-03-31</x:endDate></x:period></x:context>{extra}{facts}</x:xbrl>'''.encode()
def fact(name,v,context='annual',unit='JPY'):return f'<j:{name} contextRef="{context}" unitRef="{unit}" decimals="-6">{v}</j:{name}>'
class EdinetTests(unittest.TestCase):
 def test_official_entity_identifier_suffix(self):
  self.assertEqual(E.parse_xbrl(xml(fact('NetSales',100),entity='E12345-000'),DOC)[0]['revenue'],100)
  self.assertEqual(E.parse_xbrl(xml(fact('NetSales',100),entity='E99999-000'),DOC),[])
 def test_yen_precision_not_multiplier(self):
  r=E.parse_xbrl(xml(fact('NetSales',2e10)+fact('OperatingIncome',1.6e9)),DOC)[0];self.assertEqual(r['revenue'],2e10);self.assertEqual(r['operatingProfit'],1.6e9)
 def test_zero_distinct_from_missing(self):
  r=E.parse_xbrl(xml(fact('NetSales',100)+fact('OperatingIncome',0)),DOC)[0];self.assertEqual(r['operatingProfit'],0);self.assertNotIn('cash',r)
 def test_wrong_currency_entity_quarter_rejected(self):
  for args in [{'currency':'USD'},{'entity':'E99999'},{'start':'2026-01-01'}]:self.assertEqual(E.parse_xbrl(xml(fact('NetSales',100),**args),DOC),[])
 def test_conflicting_same_rank_omitted(self):
  r=E.parse_xbrl(xml(fact('NetSales',100)+fact('OperatingIncome',10)+fact('OperatingIncome',20)),DOC)[0];self.assertNotIn('operatingProfit',r)
 def test_standalone_not_mixed_with_consolidated(self):
  extra='<x:context id="annualNonConsolidated"><x:entity><x:identifier>E12345</x:identifier></x:entity><x:period><x:startDate>2025-04-01</x:startDate><x:endDate>2026-03-31</x:endDate></x:period></x:context>'
  r=E.parse_xbrl(xml(fact('NetSales',100)+fact('OperatingIncome',40,'annualNonConsolidated'),extra),DOC)[0];self.assertEqual(r['scope'],'consolidated');self.assertNotIn('operatingProfit',r)
 def test_entities_rejected(self):
  with self.assertRaises(ValueError):E.parse_xbrl(b'<!DOCTYPE x [<!ENTITY a "xx">]><x/>',DOC)
if __name__=='__main__':unittest.main()
