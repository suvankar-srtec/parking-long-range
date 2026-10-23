"""Exercise LAN replies and durable uploads without contacting real gates or servers."""
import http.client
import json
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from pathlib import Path

from gateway import Gateway, Ledger, utc


class OutageRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.database = str(Path(self.tmp.name) / 'ledger.sqlite')
        self.config = {'database': self.database, 'serial': 'test',
                       'controller_ip': '127.0.0.1', 'controller_token': 'test-only'}
        self.now = 1800000000000
        self.gateway = Gateway(self.config)
        self.gateway.ledger.snapshot({
            'serial': 'test', 'buildingId': 'building',
            'directions': {'0': 'ENTRY', '1': 'EXIT'},
            'limits': {'total': 10, 'owner': 4, 'company': 6},
            'companies': [], 'visitorInside': 0, 'companyVisitorInside': 0,
            'leaseUntil': utc(self.now + 86400000),
            'cards': [{'cardNo': str(i), 'pool': 'owner', 'category': 'OWNER',
                       'companyId': None, 'allowed': True, 'isInside': False,
                       'lastAccessAt': None} for i in range(1, 6)],
        })
        scan = self.gateway.ledger.scan

        def timed_scan(serial, reader, card):
            self.now += 2000
            return scan(serial, reader, card, self.now)

        self.gateway.ledger.scan = timed_scan

    def tearDown(self):
        self.tmp.cleanup()

    def wait_for(self, predicate):
        deadline = time.monotonic() + 3
        while not predicate() and time.monotonic() < deadline:
            threading.Event().wait(0.01)
        self.assertTrue(predicate())

    def test_outage_keeps_relay_replies_limits_and_disk_events_then_recovers_after_restart(self):
        failed = threading.Event()

        def unavailable(*args, **kwargs):
            failed.set()
            raise OSError('Simulated internet outage')

        self.gateway.cloud = unavailable
        uploader = threading.Thread(target=self.gateway.sync, daemon=True)
        uploader.start()
        server = ThreadingHTTPServer(('127.0.0.1', 0), self.gateway.handler())
        listener = threading.Thread(target=server.serve_forever, daemon=True)
        listener.start()

        def request(reader, card):
            client = http.client.HTTPConnection(*server.server_address, timeout=2)
            try:
                client.request('POST', '/api/AcsDataApi/RequestCardEvent?token=test-only',
                               json.dumps({'Serial': 'test', 'type': '0',
                                           'Reader': reader, 'Card': card}),
                               {'Content-Type': 'application/json'})
                response = client.getresponse()
                self.assertEqual(response.status, 200)
                return json.loads(response.read().decode().removeprefix('DATA='))
            finally:
                client.close()

        try:
            for i in range(1, 5):
                reply = request('0', str(i))
                self.assertEqual((reply['AcsRes'], reply['ActIndex'], reply['Time']),
                                 ('1', '0', '1'))
            self.assertEqual(request('0', '5')['AcsRes'], '0')
            self.assertTrue(failed.wait(2))
            self.assertEqual(Ledger(self.database).pending_count('test'), 5)
            reply = request('1', '1')
            self.assertEqual((reply['AcsRes'], reply['ActIndex']), ('1', '1'))
            self.assertEqual(request('0', '5')['AcsRes'], '1')
            pending = self.gateway.ledger.pending('test')
            self.assertEqual(len(pending), 7)
        finally:
            self.gateway.stop.set()
            self.gateway.scan_ready.set()
            uploader.join(3)
            server.shutdown()
            server.server_close()
            listener.join(3)

        restarted = Gateway(self.config)
        with restarted.ledger.db() as connection:
            self.assertEqual(connection.execute('SELECT SUM(inside) FROM cards').fetchone()[0], 4)
            self.assertEqual(connection.execute('PRAGMA synchronous').fetchone()[0], 2)
        self.assertEqual(restarted.ledger.pending('test'), pending)
        received = []

        def recovered(path, body):
            self.assertEqual(path, '/api/rfid/local-gateway/events')
            received.extend(body['events'])
            return json.dumps({'ok': True, 'acknowledged':
                               [record['id'] for record in body['events']]}).encode()

        restarted.cloud = recovered
        uploader = threading.Thread(target=restarted.sync, daemon=True)
        uploader.start()
        try:
            self.wait_for(lambda: restarted.ledger.pending_count('test') == 0)
        finally:
            restarted.stop.set()
            restarted.scan_ready.set()
            uploader.join(3)
        self.assertEqual(received, pending)

    def test_partial_ack_and_failed_response_retain_unacknowledged_events(self):
        for i in range(1, 4):
            self.gateway.ledger.scan('test', '0', str(i))
        original = self.gateway.ledger.pending('test')
        network_restored = threading.Event()
        lost_response = threading.Event()
        calls = []

        def cloud(path, body):
            ids = [record['id'] for record in body['events']]
            calls.append(ids)
            if len(calls) == 1:
                return json.dumps({'ok': True, 'acknowledged':
                                   [original[0]['id'], 'unknown-event']}).encode()
            if not network_restored.is_set():
                lost_response.set()
                raise OSError('Response lost after server received events')
            return json.dumps({'ok': True, 'acknowledged': ids}).encode()

        self.gateway.cloud = cloud
        worker = threading.Thread(target=self.gateway.sync, daemon=True)
        worker.start()
        try:
            self.assertTrue(lost_response.wait(2))
            self.assertEqual(self.gateway.ledger.pending('test'), original[1:])
            network_restored.set()
            self.gateway.scan_ready.set()
            self.wait_for(lambda: self.gateway.ledger.pending_count('test') == 0)
        finally:
            self.gateway.stop.set()
            self.gateway.scan_ready.set()
            worker.join(3)
        self.assertEqual(calls[-1], [record['id'] for record in original[1:]])

    def test_queue_count_includes_every_disk_record_beyond_upload_batch_size(self):
        for i in range(25):
            self.gateway.ledger.scan('test', '0', 'unknown-card')
        self.assertEqual(len(self.gateway.ledger.pending('test')), 20)
        self.assertEqual(self.gateway.ledger.pending_count('test'), 25)

    def test_temporary_cloud_pause_blocks_outbound_only_then_expires_automatically(self):
        self.gateway.config.update(cloud_base='https://synthetic.invalid', gateway_token='test-only')
        with patch('gateway.time.monotonic', return_value=100):
            self.gateway.pause_cloud_for_test(180)
            self.assertEqual(self.gateway.offline_test_remaining(), 180)
        with patch('gateway.urllib.request.urlopen') as outbound:
            with patch('gateway.time.monotonic', return_value=101):
                with self.assertRaises(OSError):
                    self.gateway.cloud('/api/rfid/local-gateway/config')
                outbound.assert_not_called()
                # The disk-backed capacity check does not depend on cloud availability.
                self.assertTrue(self.gateway.ledger.scan('test', '0', '1')['allowed'])
            outbound.return_value.__enter__.return_value.read.return_value = b'{"ok":true}'
            with patch('gateway.time.monotonic', return_value=281):
                self.assertEqual(self.gateway.offline_test_remaining(), 0)
                self.assertEqual(self.gateway.cloud('/api/rfid/local-gateway/config'), b'{"ok":true}')
                outbound.assert_called_once()

    def test_temporary_cloud_pause_rejects_unbounded_or_invalid_durations(self):
        for duration in [-1, 301, 1.5, True]:
            with self.assertRaises(ValueError):
                self.gateway.pause_cloud_for_test(duration)


if __name__ == '__main__':
    unittest.main()
