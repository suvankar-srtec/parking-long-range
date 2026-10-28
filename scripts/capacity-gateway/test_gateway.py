import tempfile,unittest,concurrent.futures
from pathlib import Path
from gateway import Ledger,utc,scan_reply
class CapacityTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=Path(self.tmp.name)/"ledger.sqlite";self.ledger=Ledger(self.db);self.now=1800000000000
  self.manifest={"serial":"test","buildingId":"building","directions":{"0":"ENTRY","1":"EXIT"},"limits":{"owner":4,"total":10,"company":6},"visitorInside":0,"companyVisitorInside":0,"companies":[],"leaseUntil":utc(self.now+86400000),"cards":[{"cardNo":str(i),"pool":"owner","category":"OWNER","companyId":None,"allowed":True,"isInside":False,"lastAccessAt":None} for i in range(1,6)]}
  self.ledger.snapshot(self.manifest)
 def tearDown(self):self.tmp.cleanup()
 def entry(self,card,offset=0):return self.ledger.scan("test","0",str(card),self.now+offset)
 def test_four_spaces_reject_fifth_and_release_space_after_exit(self):
  for i in range(1,5):self.assertTrue(self.entry(i,i*2000)['allowed'])
  self.assertFalse(self.entry(5,10000)['allowed']);self.assertIn('Allocation full',self.entry(5,12000)['message'])
  self.assertTrue(self.ledger.scan('test','1','1',self.now+14000)['allowed']);self.assertTrue(self.entry(5,16000)['allowed'])
 def test_concurrent_entries_cannot_overbook(self):
  self.manifest['directions']['1']='ENTRY';self.ledger.snapshot(self.manifest)
  for i in range(1,4):self.entry(i,i*2000)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda pair:self.ledger.scan('test',pair[0],pair[1],self.now+10000),[('0','4'),('1','5')]))
  self.assertTrue(any('Allocation full' in r['message'] for r in results))
  self.assertEqual(sum(r['allowed'] for r in results),1)
 def test_state_and_unsent_events_survive_restart(self):
  self.entry(1,2000);restarted=Ledger(self.db);self.assertEqual(restarted.scan('test','0','1',self.now+5000)['action'],'DUPLICATE');self.assertEqual(len(restarted.pending('test')),2)
 def test_unsent_events_prevent_stale_cloud_snapshot_overwrite(self):
  self.entry(1,2000);self.assertFalse(self.ledger.snapshot(self.manifest));self.assertEqual(self.entry(1,5000)['action'],'DUPLICATE')
 def test_expired_permissions_deny_entry_but_allow_exit(self):
  self.entry(1,2000);self.assertFalse(self.entry(2,86400001)['allowed']);self.assertTrue(self.ledger.scan('test','1','1',self.now+86400002)['allowed'])
 def test_one_second_pause_and_repeat_entry(self):
  self.assertTrue(self.entry(1,0)['allowed']);self.assertEqual(self.entry(2,500)['action'],'DUPLICATE');self.assertEqual(self.entry(1,1500)['action'],'DUPLICATE')
 def test_blocked_card_cannot_enter_but_can_exit_if_inside(self):
  self.manifest['cards'][0].update(allowed=False,isInside=True);self.manifest['cards'][1]['allowed']=False;self.ledger.snapshot(self.manifest)
  self.assertFalse(self.entry(2,2000)['allowed']);self.assertTrue(self.ledger.scan('test','1','1',self.now+4000)['allowed'])
 def test_company_category_allocation_is_enforced(self):
  self.manifest['companies']=[{'id':'c','enabled':True,'ownerParkingAllocation':1,'employeeParkingAllocation':1}]
  for card in self.manifest['cards'][:2]:card.update(pool='company',companyId='c')
  self.ledger.snapshot(self.manifest);self.assertTrue(self.entry(1,2000)['allowed']);self.assertFalse(self.entry(2,4000)['allowed'])
 def test_disabled_limits_allow_fifth_but_keep_card_validation(self):
  self.manifest['parkingLimitsEnabled']=False
  self.manifest['cards'].append({**self.manifest['cards'][0],'cardNo':'6','allowed':False})
  self.ledger.snapshot(self.manifest)
  for i in range(1,6):self.assertTrue(self.entry(i,i*2000)['allowed'])
  self.assertFalse(self.entry(6,12000)['allowed'])
  self.assertFalse(self.entry(99,14000)['allowed'])
 def test_disabled_apb_allows_repeat_without_counting_an_extra_space(self):
  self.manifest['antiPassbackEnabled']=False;self.ledger.snapshot(self.manifest)
  for i in range(1,5):self.assertTrue(self.entry(i,i*2000)['allowed'])
  self.assertTrue(self.entry(1,12000)['allowed'])
  self.assertFalse(self.entry(5,14000)['allowed'])
  self.assertTrue(self.ledger.scan('test','1','1',self.now+16000)['allowed'])
  self.assertTrue(self.ledger.scan('test','1','1',self.now+18000)['allowed'])
  self.assertTrue(self.entry(5,20000)['allowed'])
if __name__=='__main__':unittest.main()

class GatewayReplyTests(unittest.TestCase):
 setUp=CapacityTests.setUp
 tearDown=CapacityTests.tearDown
 def test_allowed_entry_exit_and_heartbeat_have_complete_http_framing(self):
  import json,threading,http.client
  from http.server import ThreadingHTTPServer
  from gateway import Gateway
  gateway=Gateway({'database':str(self.db),'serial':'test','controller_ip':'127.0.0.1','controller_token':'synthetic-token'})
  server=ThreadingHTTPServer(('127.0.0.1',0),gateway.handler());thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   def send(path,packet):
    conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
    conn.request('POST',path+'?token=synthetic-token',json.dumps(packet),{'Content-Type':'application/json'})
    response=conn.getresponse();raw=response.read();self.assertEqual(response.status,200);self.assertEqual(response.version,11);self.assertEqual(int(response.getheader('Content-Length')),len(raw));conn.close();return json.loads(raw.decode().removeprefix('DATA='))
   for reader in ['0','1']:
    result=send('/api/AcsDataApi/RequestCardEvent',{'Serial':'test','type':'0','Reader':reader,'Card':'1'})
    self.assertEqual(result['AcsRes'],'1');self.assertEqual(result['ActIndex'],reader);self.assertEqual(result['Time'],'1')
   self.assertEqual(send('/api/AcsDataApi/RequestStatus',{'Serial':'test','Key':'123'})['Key'],'123')
  finally:server.shutdown();server.server_close();thread.join()

 def test_slow_tls_negotiation_does_not_block_another_connection(self):
  import threading,socket,http.client
  from gateway import ConcurrentTLSServer,Gateway
  first=threading.Event();release=threading.Event();lock=threading.Lock()
  class SlowFirstTLS:
   def __init__(self):self.calls=0
   def wrap_socket(self,request,server_side):
    with lock:self.calls+=1;number=self.calls
    if number==1:first.set();release.wait(3)
    return request
  gateway=Gateway({'database':str(self.db),'serial':'test'})
  server=ConcurrentTLSServer(('127.0.0.1',0),gateway.handler());server.tls_context=SlowFirstTLS()
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  stalled=socket.create_connection(server.server_address,timeout=1)
  try:
   self.assertTrue(first.wait(1));client=http.client.HTTPConnection(*server.server_address,timeout=1)
   client.request('GET','/health');response=client.getresponse();self.assertEqual(response.status,200);response.read();client.close()
  finally:stalled.close();release.set();server.shutdown();server.server_close();thread.join()

 def test_scan_wakes_uploader_without_waiting_for_poll_or_configuration(self):
  import threading,json
  from gateway import Gateway
  gateway=Gateway({'database':str(self.db),'serial':'test'});sent=threading.Event();paths=[]
  def cloud(path,data):
   paths.append(path);sent.set();return json.dumps({'ok':True,'acknowledged':[record['id'] for record in data['events']]}).encode()
  gateway.cloud=cloud;worker=threading.Thread(target=gateway.sync,daemon=True);worker.start()
  try:
   self.ledger.scan('test','0','1',self.now);gateway.scan_ready.set();self.assertTrue(sent.wait(1))
  finally:gateway.stop.set();gateway.scan_ready.set();worker.join(1)
  self.assertEqual(paths,['/api/rfid/local-gateway/events']);self.assertEqual(self.ledger.pending('test'),[])
 def test_http_connection_can_be_reused_for_entry_and_exit(self):
  import threading,http.client,json
  from http.server import ThreadingHTTPServer
  from gateway import Gateway
  gateway=Gateway({'database':str(self.db),'serial':'test','controller_ip':'127.0.0.1','controller_token':'test-token'})
  server=ThreadingHTTPServer(('127.0.0.1',0),gateway.handler());worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start();client=http.client.HTTPConnection(*server.server_address,timeout=2)
  try:
   saved_socket=None
   for reader in ['0','1']:
    client.request('POST','/api/AcsDataApi/RequestCardEvent?token=test-token',json.dumps({'Serial':'test','type':'0','Reader':reader,'Card':'1'}),{'Content-Type':'application/json'})
    response=client.getresponse();result=json.loads(response.read().decode().removeprefix('DATA='));self.assertEqual(result['AcsRes'],'1');self.assertEqual(response.getheader('Connection'),'keep-alive')
    if saved_socket is None:saved_socket=client.sock
    else:self.assertIs(client.sock,saved_socket)
  finally:client.close();server.shutdown();server.server_close();worker.join()

class SharedReaderTests(unittest.TestCase):
 setUp=CapacityTests.setUp
 tearDown=CapacityTests.tearDown
 entry=CapacityTests.entry
 def test_shared_reader_does_not_toggle_while_tag_remains_present(self):
  self.manifest['directions']['0']='ENTRY_EXIT';self.ledger.snapshot(self.manifest)
  self.assertEqual(self.entry(1)['action'],'ENTRY')
  for offset in (500,1500,2500,3500,4500):self.assertEqual(self.entry(1,offset)['action'],'DUPLICATE')
  self.assertEqual(self.entry(1,8000)['action'],'EXIT')

 def test_relay_tracks_authorized_action_not_reader_input(self):
  self.assertEqual(scan_reply({'Reader':'1'},{'allowed':True,'action':'ENTRY','message':'Allowed'})['ActIndex'],'0')
  self.assertEqual(scan_reply({'Reader':'0'},{'allowed':True,'action':'EXIT','message':'Allowed'})['ActIndex'],'1')
  self.assertEqual(scan_reply({'Reader':'1'},{'allowed':False,'action':'DENIED','message':'Denied'})['AcsRes'],'0')
