import tempfile,unittest,concurrent.futures
from pathlib import Path
from gateway import Ledger,utc
class CapacityTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=Path(self.tmp.name)/"ledger.sqlite";self.ledger=Ledger(self.db);self.now=1800000000000
  self.manifest={"serial":"test","buildingId":"building","directions":{"0":"ENTRY","1":"EXIT"},"limits":{"owner":4,"total":10,"company":6},"visitorInside":0,"companyVisitorInside":0,"companies":[],"leaseUntil":utc(self.now+86400000),"cards":[{"cardNo":str(i),"pool":"owner","category":"OWNER","companyId":None,"allowed":True,"isInside":False,"lastAccessAt":None} for i in range(1,6)]}
  self.ledger.snapshot(self.manifest)
 def tearDown(self):self.tmp.cleanup()
 def entry(self,card,offset=0):return self.ledger.scan("test","0",str(card),self.now+offset)
 def test_four_spaces_reject_fifth_and_release_space_after_exit(self):
  for i in range(1,5):self.assertTrue(self.entry(i,i*2000)['allowed'])
  self.assertFalse(self.entry(5,10000)['allowed']);self.assertIn('allocation is full',self.entry(5,12000)['message'])
  self.assertTrue(self.ledger.scan('test','1','1',self.now+14000)['allowed']);self.assertTrue(self.entry(5,16000)['allowed'])
 def test_concurrent_entries_cannot_overbook(self):
  for i in range(1,4):self.entry(i,i*2000)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda card:self.entry(card,10000),[4,5]))
  self.assertEqual(sum(r['allowed'] for r in results),1)
 def test_state_and_unsent_events_survive_restart(self):
  self.entry(1,2000);restarted=Ledger(self.db);self.assertEqual(restarted.scan('test','0','1',self.now+5000)['action'],'DUPLICATE');self.assertEqual(len(restarted.pending('test')),2)
 def test_unsent_events_prevent_stale_cloud_snapshot_overwrite(self):
  self.entry(1,2000);self.assertFalse(self.ledger.snapshot(self.manifest));self.assertEqual(self.entry(1,5000)['action'],'DUPLICATE')
 def test_expired_permissions_deny_entry_but_allow_exit(self):
  self.entry(1,2000);self.assertFalse(self.entry(2,86400001)['allowed']);self.assertTrue(self.ledger.scan('test','1','1',self.now+86400002)['allowed'])
 def test_one_second_pause_and_repeat_entry(self):
  self.assertTrue(self.entry(1,0)['allowed']);self.assertEqual(self.entry(2,500)['action'],'DUPLICATE');self.assertEqual(self.entry(1,1500)['action'],'DUPLICATE')
if __name__=='__main__':unittest.main()
