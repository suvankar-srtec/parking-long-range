import unittest

from mm_protocol import Frames, read_command, tag_read


def response(command, result, payload):
    body = bytes([0xcc, 0xff, 0xff, command, result, len(payload)]) + payload
    return body + bytes([-sum(body) & 255])


class MMProtocolTests(unittest.TestCase):
    def test_matches_actual_demo_query(self):
        self.assertEqual(read_command(0x81).hex().upper(), "7CFFFF813200D3")

    def test_partial_and_coalesced_frames(self):
        frame = response(0x20, 2, bytes.fromhex("003000E2003411B802011383258566C9"))
        stream = Frames()
        self.assertEqual(stream.push(frame[:4]), [])
        frames = stream.push(frame[4:] + frame)
        self.assertEqual(len(frames), 2)
        self.assertEqual(tag_read(frames[0]), {"antenna": 0, "pc": "3000", "epc": "E2003411B802011383258566", "rssi": 201})

    def test_bad_checksum_is_not_a_tag(self):
        good = response(0x20, 5, bytes.fromhex("003000E2003411B802011383258566C9"))
        bad = good[:-1] + bytes([good[-1] ^ 1])
        self.assertEqual(len(Frames().push(b"noise" + bad + good)), 1)

    def test_inventory_completion_and_wrong_pc_length_are_not_tags(self):
        for data in [bytes.fromhex("000101"), bytes.fromhex("00300012345678C9")]:
            self.assertIsNone(tag_read(Frames().push(response(0x20, 2, data))[0]))

    def test_dangerous_commands_are_not_available(self):
        for command in (0x22, 0x26, 0x28, 0xd7):
            with self.assertRaises(ValueError):
                read_command(command)

    def test_iw4a_actual_demo_report_excludes_crc_from_epc(self):
        raw = bytes.fromhex("CCFFFF200512003000E20020292307014714807E1CC5899F17")
        frames = Frames().push(raw)
        self.assertEqual(len(frames), 1)
        tag = tag_read(frames[0])
        self.assertEqual(tag["epc"], "E20020292307014714807E1C")
        self.assertEqual(tag["crc"], "C589")
        self.assertEqual(tag["rssi"], 0x9f)


if __name__ == "__main__":
    unittest.main()
