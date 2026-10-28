import unittest
import tempfile
import time
from unittest.mock import patch, MagicMock

from bridge import Bridge, Presence, validate_config


class BridgeTests(unittest.TestCase):
    def test_only_fresh_authorized_event_pulses_once(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = Bridge({"app_url": "http://localhost:3000", "reader_token": "synthetic", "device_number": "UHF-001122334455", "relay_claims": directory + "/claims.sqlite", "controller": {"host": "192.168.0.236", "serial": "80M236", "username": "test", "password": "test"}})
            result = {"gateAllowed": True, "requestId": "nonce", "expiresAt": time.time()*1000+2000, "eventId": "event-1", "relay": {"serial": "80M236", "index": 0}, "action": "ENTRY"}
            with patch("bridge.urllib.request.urlopen", return_value=MagicMock()) as command:
                self.assertFalse(bridge.operate({"gateAllowed": False}, "nonce"))
                with self.assertRaises(ValueError):
                    bridge.operate(result, "wrong")
                self.assertTrue(bridge.operate(result, "nonce"))
                self.assertFalse(bridge.operate(result, "nonce"))
                self.assertEqual(command.call_count, 1)
                self.assertIn("open=1&door=0", command.call_args.args[0].full_url)

    def test_continuous_access_reports_stay_one_presentation_during_slow_request(self):
        presence = Presence()
        self.assertTrue(presence.observe("E20001", "ACCESS", 0))
        # Reception continues while a fifteen-second HTTP request is outstanding.
        for second in range(1, 16):
            self.assertFalse(presence.observe("E20001", "ACCESS", second))
        self.assertTrue(presence.observe("E20001", "ACCESS", 19))

    def test_reversed_physical_outputs_map_entry_and_exit_correctly(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = Bridge({"app_url": "http://localhost:3000", "reader_token": "synthetic", "device_number": "UHF-001122334455", "relay_claims": directory + "/claims.sqlite", "controller": {"host": "192.168.0.236", "serial": "80M236", "username": "test", "password": "test", "relay_map": [1, 0]}})
            with patch("bridge.urllib.request.urlopen", return_value=MagicMock()) as command:
                for index, action in enumerate(("ENTRY", "EXIT")):
                    result = {"gateAllowed": True, "requestId": "nonce", "expiresAt": time.time()*1000+2000, "eventId": "event-"+action, "relay": {"serial": "80M236", "index": index}, "action": action}
                    self.assertTrue(bridge.operate(result, "nonce"))
                    self.assertIn("door="+str(1-index), command.call_args.args[0].full_url)

    def test_verified_action_outputs_override_reversed_logical_gate_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            bridge = Bridge({"app_url": "http://localhost:3000", "reader_token": "synthetic", "device_number": "UHF-001122334455", "relay_claims": directory + "/claims.sqlite", "controller": {"host": "192.168.0.236", "serial": "80M236", "username": "test", "password": "test", "action_outputs": {"ENTRY": 0, "EXIT": 1}}})
            with patch("bridge.urllib.request.urlopen", return_value=MagicMock()) as command:
                for expected, action in enumerate(("ENTRY", "EXIT")):
                    result = {"gateAllowed": True, "requestId": "nonce", "expiresAt": time.time()*1000+2000, "eventId": "event-"+action, "relay": {"serial": "80M236", "index": 1-expected}, "action": action}
                    self.assertTrue(bridge.operate(result, "nonce"))
                    self.assertIn("door="+str(expected), command.call_args.args[0].full_url)

    def test_entry_role_refuses_exit_authorization(self):
        bridge = Bridge({"app_url": "http://localhost:3000", "reader_token": "synthetic", "device_number": "UHF-001122334455"})
        with patch.object(bridge, "post", return_value={"gateAllowed": True, "action": "EXIT"}), patch.object(bridge, "operate") as operate:
            bridge.submit_tag("E20001", "ENTRY", None)
            operate.assert_not_called()

    def test_combined_purpose_accepts_only_server_authorized_gate_direction(self):
        bridge = Bridge({"app_url": "http://localhost:3000", "reader_token": "synthetic", "device_number": "UHF-001122334455"})
        with patch.object(bridge, "post", return_value={"gateAllowed": True, "action": "EXIT"}), patch.object(bridge, "operate") as operate:
            bridge.submit_tag("E20001", "ENTRY_EXIT", None)
            operate.assert_called_once()

    def test_held_tag_submits_only_once_per_capture(self):
        p = Presence()
        self.assertTrue(p.observe("E20001", "capture-1", 0))
        for now in (1, 2, 3, 4, 5, 6):
            self.assertFalse(p.observe("E20001", "capture-1", now))
        self.assertTrue(p.observe("E20001", "capture-2", 7))

    def test_absent_tag_can_be_presented_again(self):
        p = Presence()
        self.assertTrue(p.observe("AABB", "capture", 0))
        self.assertTrue(p.observe("AABB", "capture", 4))

    def test_reading_does_not_register_without_session(self):
        p = Presence()
        self.assertFalse(p.observe("AABB", None, 0))
        self.assertFalse(p.observe("AABB", None, 1))
        self.assertTrue(p.observe("AABB", "capture", 2))

    def test_credentials_require_https_except_localhost(self):
        config = {"app_url": "http://example.com", "reader_token": "synthetic", "device_number": "UHF-E04E7A3A8D8A"}
        with self.assertRaises(ValueError):
            validate_config(config)
        config["app_url"] = "http://localhost:3000"
        validate_config(config)


if __name__ == "__main__":
    unittest.main()
