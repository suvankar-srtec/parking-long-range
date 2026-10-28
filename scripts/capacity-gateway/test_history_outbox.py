import json, tempfile, threading, unittest, urllib.request
from pathlib import Path
from unittest.mock import Mock
from http.server import ThreadingHTTPServer
from gateway import Gateway, Ledger, utc

class HistoryOutboxTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.path=str(Path(self.tmp.name)/"ledger.sqlite")
  self.gateway=Gateway({"database":self.path,"serial":"test","controller_ip":"127.0.0.1","controller_token":"fixture","cloud_base":"https://example.invalid","gateway_token":"fixture"})
  self.packet={"Serial":"test","type":"100","IndexEvent":"42","EventType":"11","Card":"123"}
 def tearDown(self): self.tmp.cleanup()
 def test_history_commit_survives_restart_and_duplicate_upload(self):
  self.assertEqual(self.gateway.ledger.save_controller_history(self.packet),{"IndexEvent":"42"})
  self.gateway.ledger.save_controller_history(self.packet)
  restarted=Ledger(self.path)
  self.assertEqual(len(restarted.history_pending("test")),1)
 def test_background_retry_keeps_data_until_matching_cloud_ack(self):
  self.gateway.ledger.save_controller_history(self.packet)
  self.gateway.cloud=Mock(side_effect=OSError("WAN unavailable"))
  with self.assertRaises(OSError):self.gateway.upload_controller_history()
  self.assertEqual(len(self.gateway.ledger.history_pending("test")),1)
  self.gateway.cloud=Mock(return_value=b'DATA={"IndexEvent":"41"}')
  with self.assertRaises(ValueError):self.gateway.upload_controller_history()
  self.assertEqual(len(self.gateway.ledger.history_pending("test")),1)
  self.gateway.cloud=Mock(return_value=b'DATA={"IndexEvent":"42"}')
  self.gateway.upload_controller_history()
  self.assertEqual(self.gateway.ledger.history_pending("test"),[])
 def test_controller_history_and_scan_do_not_call_cloud_when_wan_is_down(self):
  self.gateway.ledger.snapshot({"serial":"test","buildingId":"b","directions":{"0":"ENTRY"},"limits":{"owner":2,"total":2,"company":0},"visitorInside":0,"companyVisitorInside":0,"companies":[],"leaseUntil":utc(4102444800000),"cards":[{"cardNo":"123","pool":"owner","category":"OWNER","allowed":True,"isInside":False}]})
  self.gateway.cloud=Mock(side_effect=AssertionError("Controller handler must not wait for WAN"))
  server=ThreadingHTTPServer(("127.0.0.1",0),self.gateway.handler())
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  def post(packet):
   request=urllib.request.Request("http://127.0.0.1:"+str(server.server_port)+"/api/AcsDataApi/RequestCardEvent?token=fixture",data=json.dumps(packet).encode(),headers={"Content-Type":"application/json"})
   with urllib.request.urlopen(request,timeout=2) as response:return json.loads(response.read().decode().removeprefix("DATA="))
  try:
   self.assertEqual(post(self.packet),{"IndexEvent":"42"})
   result=post({"Serial":"test","type":"0","Reader":"0","Card":"123"})
   self.assertEqual(result["AcsRes"],"1");self.assertEqual(result["ActIndex"],"0")
   self.gateway.cloud.assert_not_called()
   self.assertEqual(len(self.gateway.ledger.history_pending("test")),1)
  finally:server.shutdown();server.server_close();thread.join()
 def test_missing_index_is_never_acknowledged(self):
  with self.assertRaises(ValueError):self.gateway.ledger.save_controller_history({"Serial":"test","type":"100"})
  self.assertEqual(self.gateway.ledger.history_pending("test"),[])

if __name__=="__main__":unittest.main()
