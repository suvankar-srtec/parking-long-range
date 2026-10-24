import datetime as dt
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from gateway import Gateway, utc


def frame(command, payload=b''):
    data = bytes([2, 0, command, 0, 0]) + len(payload).to_bytes(2, 'little') + payload
    checksum = 0
    for byte in data:
        checksum ^= byte
    return (data + bytes([checksum, 3])).hex().upper()


class NativeFallbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.gateway = Gateway({'database': str(Path(self.tmp.name) / 'ledger.sqlite'),
                                'serial': '80M236', 'controller_token': 'synthetic',
                                'native_fallback': True})
        self.now = int(time.time() * 1000)
        self.gateway.ledger.snapshot({
            'serial': '80M236', 'buildingId': 'building',
            'directions': {'0': 'ENTRY', '1': 'EXIT'},
            'limits': {'total': 10, 'owner': 3, 'company': 7}, 'companies': [],
            'leaseUntil': utc(self.now + 86400000),
            'cards': [{'cardNo': '1', 'pool': 'owner', 'category': 'OWNER',
                       'allowed': True, 'isInside': False, 'lastAccessAt': None}],
        })

    def tearDown(self):
        self.tmp.cleanup()

    def test_memory_commands_are_cached_without_echoing_old_keys_or_reexecuting_acknowledgements(self):
        gateway = self.gateway
        command = frame(0x0d, bytes(12))
        calls = []

        def cloud(path, packet, controller):
            calls.append((path, packet, controller))
            return ('DATA=' + json.dumps({'Key': 'old-key', 'IndexCmd': '12',
                                         'CmdValue': command, 'AcsRes': '1'})).encode()

        gateway.cloud = cloud
        self.assertEqual(gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '1'}), {})
        self.assertEqual(calls, [])
        gateway.sync_native_memory_once()
        self.assertEqual(gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '2'}),
                         {'IndexCmd': '12', 'CmdValue': command})
        self.assertEqual(gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '3',
                                                        'IndexCmd': '12', 'CmdOK': '1'}), {})
        gateway.sync_native_memory_once()
        self.assertEqual(calls[-1][1]['IndexCmd'], '12')
        self.assertEqual(calls[-1][1]['CmdOK'], '1')
        self.assertTrue(calls[-1][2])

    def test_memory_bridge_rejects_relay_commands_and_invalid_checksums(self):
        gateway = self.gateway
        gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '1'})
        for command in [frame(0x2c), frame(0x0d, bytes(12))[:-4] + '0003']:
            gateway.cloud = lambda *args: json.dumps({'IndexCmd': '1', 'CmdValue': command}).encode()
            with self.assertRaises(ValueError):
                gateway.sync_native_memory_once()

    def test_native_apb_override_preserves_gateway_apb_and_valid_memory_frame(self):
        gateway = self.gateway
        gateway.config['native_anti_passback'] = False
        payload = bytes([1, 0, 0, 23, 59, 255, 0x81, 26, 10, 25, 0, 0])
        gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '1'})
        gateway.cloud = lambda *args: json.dumps({'IndexCmd': '12', 'CmdValue': frame(0x0d, payload)}).encode()
        gateway.sync_native_memory_once()
        reply = gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '2'})
        self.assertEqual(reply['CmdValue'], frame(0x0d, payload[:6] + b'\x01' + payload[7:]))
        self.assertTrue(gateway.ledger.scan('80M236', '0', '1', self.now)['allowed'])
        self.assertFalse(gateway.ledger.scan('80M236', '0', '1', self.now + 2000)['allowed'])
        self.assertTrue(gateway.ledger.scan('80M236', '1', '1', self.now + 4000)['allowed'])
        self.assertTrue(gateway.ledger.scan('80M236', '0', '1', self.now + 6000)['allowed'])

    def test_slow_cloud_memory_sync_never_blocks_local_heartbeat_or_capacity_decision(self):
        gateway = self.gateway
        entered = threading.Event()
        release = threading.Event()

        def slow_cloud(*args):
            entered.set()
            release.wait(2)
            return b'DATA={}'

        gateway.cloud = slow_cloud
        gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '1'})
        worker = threading.Thread(target=gateway.sync_native_memory_once)
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            start = time.monotonic()
            self.assertEqual(gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '2'}), {})
            self.assertTrue(gateway.ledger.scan('80M236', '0', '1')['allowed'])
            self.assertLess(time.monotonic() - start, 0.5)
        finally:
            release.set()
            worker.join(3)

    def test_successful_native_history_reconciles_local_occupancy_without_duplicate_gateway_events(self):
        gateway = self.gateway

        def packet(code, offset):
            return {'Serial': '80M236', 'type': '100', 'Card': '1', 'EventType': code,
                    'EventTime': dt.datetime.fromtimestamp((self.now + offset) / 1000,
                                                          dt.timezone.utc).strftime('%Y%m%d%H%M%S')}

        def inside():
            with gateway.ledger.db() as connection:
                return connection.execute('SELECT inside FROM cards WHERE card=?', ('1',)).fetchone()[0]

        gateway.ledger.reconcile_native_history(packet('11', 2000))
        self.assertEqual(inside(), 1)
        gateway.ledger.reconcile_native_history(packet('10', -5000))
        gateway.ledger.reconcile_native_history(packet('6', 3000))
        self.assertEqual(inside(), 1)
        gateway.ledger.reconcile_native_history(packet('10', 4000))
        self.assertEqual(inside(), 0)
        self.assertEqual(gateway.ledger.pending_count('80M236'), 0)

    def test_strict_default_does_not_schedule_native_permission_commands(self):
        self.gateway.config['native_fallback'] = False
        self.assertEqual(self.gateway.native_heartbeat_fields({'Serial': '80M236', 'Key': '1'}), {})
        self.assertIsNone(self.gateway.native_packet)


if __name__ == '__main__':
    unittest.main()
