import asyncio
import importlib.util
import importlib
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gateway", Path(__file__).parents[1] / "scripts/cloudc-gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


def packet(payload=b"hello", command=0xE7):
    frame = bytearray([2, 0, command, 0, 0])
    frame.extend(len(payload).to_bytes(2, "little"))
    frame.extend(payload)
    checksum = 0
    for value in frame:
        checksum ^= value
    frame.extend([checksum, 3])
    return bytes(frame)


class FrameTests(unittest.IsolatedAsyncioTestCase):
    async def test_split_and_combined_packets(self):
        first, second = packet(), packet(b"second")
        for split in range(1, len(first)):
            stream = asyncio.StreamReader()
            stream.feed_data(first[:split])
            task = asyncio.create_task(gateway.read_frame(stream))
            await asyncio.sleep(0)
            stream.feed_data(first[split:] + second)
            self.assertEqual(await task, first)
            self.assertEqual(await gateway.read_frame(stream), second)

    async def test_invalid_checksum_and_oversize(self):
        invalid = bytearray(packet())
        invalid[-2] ^= 1
        for data in (invalid, bytes([2, 0, 0, 0, 0, 1, 32])):
            stream = asyncio.StreamReader()
            stream.feed_data(data)
            with self.assertRaises(ValueError):
                await gateway.read_frame(stream)

    async def test_unknown_ip_never_calls_backend(self):
        class Writer:
            closed = False
            def get_extra_info(self, _): return ("192.168.1.99", 123)
            def close(self): self.closed = True
            async def wait_closed(self): pass
        writer = Writer()
        instance = gateway.Gateway(None, [], "http://localhost", "secret")
        with patch.object(instance, "post", side_effect=AssertionError("Unexpected backend call")):
            await instance.handle(None, writer)
        self.assertTrue(writer.closed)

    @unittest.skipUnless(os.environ.get("CLOUDC_SDK_PATH"), "Set CLOUDC_SDK_PATH for vendor SDK integration tests")
    async def test_vendor_allow_deny_outage_serial_and_unsupported_type(self):
        sys.path.insert(0, os.environ["CLOUDC_SDK_PATH"])
        sdk = importlib.import_module("CloudC.CloudC")
        for decision, serial, kind, expected in (
            ({"code": "0000"}, b"123456", 1, 1),
            ({"code": "0001"}, b"123456", 1, 0),
            (OSError("Backend offline"), b"123456", 1, 0),
            ({"code": "0000"}, b"654321", 1, None),
            ({"code": "0000"}, b"123456", 6, 0),
            ({"code": "0000"}, b"123456", 9, 1),
        ):
            payload = bytearray(43)
            payload[:6] = serial
            payload[16] = 1
            payload[22] = kind
            scan = "SRTEC-VISITOR|ID:visitor1|TOKEN:token1"
            import base64
            payload.extend(base64.b64encode(scan.encode()) if kind == 9 else scan.encode())
            stream = asyncio.StreamReader()
            stream.feed_data(packet(payload))
            stream.feed_eof()

            class Writer:
                replies = []
                def get_extra_info(self, _): return ("192.168.1.50", 123)
                def write(self, value): self.replies.append(value)
                async def drain(self): pass
                def close(self): pass
                async def wait_closed(self): pass

            writer = Writer()
            writer.replies = []
            instance = gateway.Gateway(sdk, [{"deviceNumber": "app-reader", "readerIp": "192.168.1.50", "serial": "123456"}], "http://localhost", "secret")
            scans = []
            async def post(path, body):
                if path == "/api/rfid/cloudc":
                    scans.append(body)
                    if isinstance(decision, Exception): raise decision
                    return decision
                return {"ok": True}
            instance.post = post
            await instance.handle(stream, writer)
            if expected is None:
                self.assertEqual(writer.replies, [])
                self.assertEqual(scans, [])
            else:
                self.assertEqual(len(writer.replies), 1)
                reply = writer.replies[0]
                self.assertTrue(gateway.valid_frame(reply))
                self.assertEqual(reply[2], 0x57)
                self.assertEqual(reply[7], expected)
                self.assertEqual(reply[8], 1)
                if kind in (1, 9):
                    self.assertEqual(scans[0]["decodedResult"], scan)
                else:
                    self.assertEqual(scans, [])


if __name__ == "__main__":
    unittest.main()
